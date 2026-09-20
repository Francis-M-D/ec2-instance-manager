from __future__ import annotations

from typing import Any


class GcpCloudProvider:
    def list_instances(self, account_key, region, statuses, search) -> list[dict[str, Any]]:
        raise NotImplementedError("GCP support is not implemented yet")

    def start_instances(self, account_key, region, instance_ids, dry_run=False) -> dict[str, Any]:
        raise NotImplementedError("GCP support is not implemented yet")

    def stop_instances(self, account_key, region, instance_ids, dry_run=False) -> dict[str, Any]:
        raise NotImplementedError("GCP support is not implemented yet")

    def get_regions(self, account_key) -> list[str]:
        raise NotImplementedError("GCP support is not implemented yet")
