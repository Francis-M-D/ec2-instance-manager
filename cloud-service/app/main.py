from __future__ import annotations

import os
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config.account_config import AccountConfigError, get_provider as get_account_provider
from app.providers.factory import get_provider as get_cloud_provider

app = FastAPI(
    title="EC2 Manager Cloud Service",
    description="Internal service performing direct cloud operations (AWS first).",
    version="1.0.0",
)

security = HTTPBearer(auto_error=False)


def require_internal_api_key(
    creds: HTTPAuthorizationCredentials | None = Security(security),
) -> None:
    expected = os.environ.get("EC2MANAGER_INTERNAL_API_KEY")
    if not expected:
        raise HTTPException(500, "EC2MANAGER_INTERNAL_API_KEY not configured on server")
    if creds is None or creds.credentials != expected:
        raise HTTPException(401, "Invalid or missing internal API key")


# ---------- models ----------

class Tag(BaseModel):
    Key: str
    Value: str


class Instance(BaseModel):
    instanceId: str
    name: str
    state: str
    tags: list[Tag]
    dnsEnabled: bool
    publicIp: str | None = None
    privateIp: str | None = None
    region: str
    accountKey: str
    launchTime: str | None = None
    instanceType: str | None = None


class ListInstancesRequest(BaseModel):
    accountKey: str
    region: str | None = None
    statuses: list[str] | None = None
    search: str | None = None
    cloud: str = "aws"


class ActionRequest(BaseModel):
    accountKey: str
    region: str
    instanceIds: list[str]
    dryRun: bool = False
    cloud: str = "aws"


class ActionSkip(BaseModel):
    instanceId: str
    reason: str


class ActionResponse(BaseModel):
    wouldStart: list[str] = []
    wouldStop: list[str] = []
    wouldSkip: list[ActionSkip] = []
    errors: list[dict[str, Any]] = []


# ---------- routes ----------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/instances/list", response_model=list[Instance], dependencies=[Depends(require_internal_api_key)])
def list_instances(req: ListInstancesRequest) -> list[dict[str, Any]]:
    provider = get_cloud_provider(req.cloud)
    try:
        return provider.list_instances(req.accountKey, req.region, req.statuses, req.search)
    except AccountConfigError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/instances/start", response_model=ActionResponse, dependencies=[Depends(require_internal_api_key)])
def start_instances(req: ActionRequest) -> dict[str, Any]:
    provider = get_cloud_provider(req.cloud)
    try:
        return provider.start_instances(req.accountKey, req.region, req.instanceIds, req.dryRun)
    except AccountConfigError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/instances/stop", response_model=ActionResponse, dependencies=[Depends(require_internal_api_key)])
def stop_instances(req: ActionRequest) -> dict[str, Any]:
    provider = get_cloud_provider(req.cloud)
    try:
        return provider.stop_instances(req.accountKey, req.region, req.instanceIds, req.dryRun)
    except AccountConfigError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get(
    "/accounts/{account_key}/regions",
    response_model=list[str],
    dependencies=[Depends(require_internal_api_key)],
)
def get_regions(account_key: str, cloud: str = "aws") -> list[str]:
    provider = get_cloud_provider(cloud)
    try:
        return provider.get_regions(account_key)
    except AccountConfigError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/accounts", dependencies=[Depends(require_internal_api_key)])
def list_accounts() -> list[dict[str, Any]]:
    """Metadata only — never returns credentials."""
    accounts = get_account_provider().get_accounts()
    return [
        {"key": a.key, "name": a.name, "accountId": a.account_id, "authMode": "roleArn" if a.role_arn else "staticKeys"}
        for a in accounts.values()
    ]
