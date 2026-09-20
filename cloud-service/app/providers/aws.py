from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.credentials import DeferredRefreshableCredentials
from botocore.exceptions import ClientError
from botocore.session import get_session as botocore_get_session

from app.config.account_config import Account, get_provider
from app.providers.base import is_dns_protected

logger = logging.getLogger(__name__)

VALID_STATES = {
    "pending",
    "running",
    "shutting-down",
    "terminated",
    "stopping",
    "stopped",
}

ASSUME_ROLE_DURATION_SECONDS = int(os.environ.get("EC2MANAGER_ASSUME_ROLE_DURATION", "3600"))


class AwsCloudProvider:
    """boto3-backed implementation of CloudProvider for AWS."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._session_cache: dict[str, boto3.Session] = {}
        self._region_cache: dict[str, list[str]] = {}

    # ---------- session management ----------

    def _hub_sts_client(self):
        """STS client using the host's own credentials (EC2 instance profile,
        env vars, or local AWS config) — the 'hub' identity that assumes
        into each target account."""
        return boto3.client("sts")

    def _build_refreshable_session(self, account: Account) -> boto3.Session:
        role_arn = account.role_arn
        sts = self._hub_sts_client()

        def refresh() -> dict:
            resp = sts.assume_role(
                RoleArn=role_arn,
                RoleSessionName=f"ec2manager-{account.key}",
                DurationSeconds=ASSUME_ROLE_DURATION_SECONDS,
            )
            creds = resp["Credentials"]
            return {
                "access_key": creds["AccessKeyId"],
                "secret_key": creds["SecretAccessKey"],
                "token": creds["SessionToken"],
                "expiry_time": creds["Expiration"].isoformat(),
            }

        # DeferredRefreshableCredentials lazily calls `refresh_using` on first
        # use (and again on expiry) rather than requiring a pre-fetched
        # metadata dict — this is the same pattern botocore's own
        # AssumeRoleProvider uses internally, and is reliably picked up by
        # every client created from this session (unlike hand-assigning a
        # RefreshableCredentials.create_from_metadata() instance, which can
        # silently fail to propagate depending on botocore version/session
        # component wiring).
        refreshable_creds = DeferredRefreshableCredentials(
            refresh_using=refresh,
            method="sts-assume-role",
        )

        botocore_session = botocore_get_session()
        botocore_session._credentials = refreshable_creds  # noqa: SLF001 - documented botocore pattern
        return boto3.Session(botocore_session=botocore_session)

    def _build_static_session(self, account: Account) -> boto3.Session:
        creds = account.credentials
        return boto3.Session(
            aws_access_key_id=creds.access_key_id,
            aws_secret_access_key=creds.secret_access_key,
        )

    def _get_session(self, account_key: str) -> boto3.Session:
        with self._lock:
            if account_key in self._session_cache:
                return self._session_cache[account_key]

            account = get_provider().get_account(account_key)
            if account.role_arn:
                session = self._build_refreshable_session(account)
            elif account.credentials and account.credentials.access_key_id:
                session = self._build_static_session(account)
            else:
                raise ValueError(
                    f"Account '{account_key}' has neither roleArn nor static credentials configured"
                )
            self._session_cache[account_key] = session
            return session

    # ---------- regions ----------

    def get_regions(self, account_key: str) -> list[str]:
        with self._lock:
            if account_key in self._region_cache:
                return self._region_cache[account_key]
        session = self._get_session(account_key)
        ec2 = session.client("ec2", region_name="us-east-1")
        resp = ec2.describe_regions(AllRegions=False)
        regions = sorted(r["RegionName"] for r in resp["Regions"])
        with self._lock:
            self._region_cache[account_key] = regions
        return regions

    # ---------- instances ----------

    @staticmethod
    def _serialize_instance(inst: dict, account_key: str, region: str) -> dict[str, Any]:
        tags = inst.get("Tags", [])
        name = next((t["Value"] for t in tags if t["Key"] == "Name"), inst["InstanceId"])
        return {
            "instanceId": inst["InstanceId"],
            "name": name,
            "state": inst["State"]["Name"],
            "tags": tags,
            "dnsEnabled": is_dns_protected(tags),
            "publicIp": inst.get("PublicIpAddress"),
            "privateIp": inst.get("PrivateIpAddress"),
            "region": region,
            "accountKey": account_key,
            "launchTime": inst["LaunchTime"].isoformat() if inst.get("LaunchTime") else None,
            "instanceType": inst.get("InstanceType"),
        }

    def _list_region(
        self,
        session: boto3.Session,
        account_key: str,
        region: str,
        filters: list[dict[str, Any]],
        search: str | None,
    ) -> list[dict[str, Any]]:
        """Fetch+serialize instances for a single region. Runs inside a
        thread pool worker — client creation is guarded by self._lock since
        boto3 Session objects aren't guaranteed thread-safe for concurrent
        client construction, but the actual network call (paginate) happens
        outside the lock so regions are queried in parallel."""
        with self._lock:
            ec2 = session.client("ec2", region_name=region)
        paginator = ec2.get_paginator("describe_instances")
        out: list[dict[str, Any]] = []
        try:
            pages = list(paginator.paginate(Filters=filters))
        except ClientError as exc:
            # A region can be listed by describe_regions() but still be
            # unusable (e.g. a newer opt-in region — "AuthFailure" is
            # AWS's actual error for this, not a real credential problem).
            # Skip it rather than failing the whole multi-region request.
            logger.warning("Skipping region %s for account %s: %s", region, account_key, exc)
            return out
        for page in pages:
            for reservation in page["Reservations"]:
                for inst in reservation["Instances"]:
                    serialized = self._serialize_instance(inst, account_key, region)
                    if search:
                        haystack = " ".join(
                            filter(
                                None,
                                [
                                    serialized["instanceId"],
                                    serialized["name"],
                                    serialized["publicIp"],
                                    serialized["privateIp"],
                                ],
                            )
                        ).lower()
                        if search.lower() not in haystack:
                            continue
                    out.append(serialized)
        return out

    def list_instances(
        self,
        account_key: str,
        region: str | None,
        statuses: list[str] | None,
        search: str | None,
    ) -> list[dict[str, Any]]:
        session = self._get_session(account_key)
        regions = [region] if region else self.get_regions(account_key)

        filters = []
        if statuses:
            bad = set(statuses) - VALID_STATES
            if bad:
                raise ValueError(f"Invalid instance state(s): {sorted(bad)}")
            filters.append({"Name": "instance-state-name", "Values": statuses})

        # Querying regions sequentially (one network round-trip at a time)
        # is the dominant cost when no region filter is given — with ~18
        # AWS regions that's 18x the per-call latency. Fan the per-region
        # calls out across a thread pool instead; each is an independent,
        # read-only network call, so this is safe and typically turns an
        # 18x-latency wait into roughly 1x.
        results: list[dict[str, Any]] = []
        if len(regions) == 1:
            results.extend(self._list_region(session, account_key, regions[0], filters, search))
        else:
            with ThreadPoolExecutor(max_workers=min(10, len(regions))) as executor:
                futures = {
                    executor.submit(self._list_region, session, account_key, r, filters, search): r
                    for r in regions
                }
                for future in as_completed(futures):
                    results.extend(future.result())
        return results

    def _split_by_dns_policy(
        self, session: boto3.Session, region: str, instance_ids: list[str]
    ) -> tuple[list[str], list[dict[str, str]]]:
        """Returns (actionable_ids, skipped=[{instanceId, reason}]).

        Policy: instances tagged DNS=Yes are DNS-critical and PROTECTED —
        they must never be started/stopped through this tool. Everything
        else (tag missing, or DNS set to anything other than "Yes") is
        actionable.
        """
        ec2 = session.client("ec2", region_name=region)
        resp = ec2.describe_instances(InstanceIds=instance_ids)
        actionable: list[str] = []
        skipped: list[dict[str, str]] = []
        found_ids = set()
        for reservation in resp["Reservations"]:
            for inst in reservation["Instances"]:
                found_ids.add(inst["InstanceId"])
                if is_dns_protected(inst.get("Tags", [])):
                    skipped.append(
                        {"instanceId": inst["InstanceId"], "reason": "Protected: DNS tag is set to Yes"}
                    )
                else:
                    actionable.append(inst["InstanceId"])
        for missing in set(instance_ids) - found_ids:
            skipped.append({"instanceId": missing, "reason": "Instance not found"})
        return actionable, skipped

    def _do_action(
        self,
        account_key: str,
        region: str,
        instance_ids: list[str],
        dry_run: bool,
        action: str,
    ) -> dict[str, Any]:
        session = self._get_session(account_key)
        actionable, skipped = self._split_by_dns_policy(session, region, instance_ids)

        result_key = "wouldStart" if action == "start" else "wouldStop"
        result: dict[str, Any] = {"wouldStart": [], "wouldStop": [], "wouldSkip": skipped, "errors": []}
        result[result_key] = actionable

        if dry_run or not actionable:
            return result

        ec2 = session.client("ec2", region_name=region)
        try:
            if action == "start":
                ec2.start_instances(InstanceIds=actionable)
            else:
                ec2.stop_instances(InstanceIds=actionable)
        except Exception as exc:  # noqa: BLE001 - surfaced to caller as structured error
            result["errors"].append({"instanceIds": actionable, "message": str(exc)})
        return result

    def start_instances(
        self, account_key: str, region: str, instance_ids: list[str], dry_run: bool = False
    ) -> dict[str, Any]:
        return self._do_action(account_key, region, instance_ids, dry_run, "start")

    def stop_instances(
        self, account_key: str, region: str, instance_ids: list[str], dry_run: bool = False
    ) -> dict[str, Any]:
        return self._do_action(account_key, region, instance_ids, dry_run, "stop")
