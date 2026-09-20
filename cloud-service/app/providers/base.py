"""
Cloud provider interface.

Every cloud (AWS now; GCP/Azure/Oracle later) implements CloudProvider.
Instances are represented as plain dicts on the wire (FastAPI response models
live in main.py); this module defines the *behavioral* contract only.

DNS tag policy (enforced by callers, and re-checked by each provider at
execution time):
  - Tag key "DNS", value "Yes" (case-insensitive) => this instance is
    PROTECTED — it is DNS-critical and must never be started/stopped
    through this tool.
  - Only instances WITHOUT DNS=Yes may be started/stopped.
"""
from __future__ import annotations

from typing import Any, Protocol


class CloudProvider(Protocol):
    def list_instances(
        self,
        account_key: str,
        region: str | None,
        statuses: list[str] | None,
        search: str | None,
    ) -> list[dict[str, Any]]:
        ...

    def start_instances(
        self,
        account_key: str,
        region: str,
        instance_ids: list[str],
        dry_run: bool = False,
    ) -> dict[str, Any]:
        ...

    def stop_instances(
        self,
        account_key: str,
        region: str,
        instance_ids: list[str],
        dry_run: bool = False,
    ) -> dict[str, Any]:
        ...

    def get_regions(self, account_key: str) -> list[str]:
        ...


def is_dns_protected(tags: list[dict[str, str]] | None) -> bool:
    """DNS=Yes (case-insensitive) => protected, must NOT be started/stopped."""
    tag_map = {t["Key"]: t["Value"] for t in (tags or [])}
    return tag_map.get("DNS", "").strip().lower() == "yes"
