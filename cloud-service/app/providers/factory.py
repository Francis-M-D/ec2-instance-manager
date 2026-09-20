from __future__ import annotations

from functools import lru_cache

from app.providers.aws import AwsCloudProvider
from app.providers.azure import AzureCloudProvider
from app.providers.base import CloudProvider
from app.providers.gcp import GcpCloudProvider
from app.providers.oracle import OracleCloudProvider


@lru_cache
def get_provider(cloud: str = "aws") -> CloudProvider:
    if cloud == "aws":
        return AwsCloudProvider()
    elif cloud == "gcp":
        return GcpCloudProvider()
    elif cloud == "azure":
        return AzureCloudProvider()
    elif cloud == "oracle":
        return OracleCloudProvider()
    else:
        raise ValueError(f"Unsupported cloud: {cloud}")
