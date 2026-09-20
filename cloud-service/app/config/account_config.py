"""
IAccountConfigProvider equivalent for Python.

Reads EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED (Fernet-encrypted JSON) and
EC2MANAGER_DECRYPTION_KEY, decrypts once, caches in memory.

Never log or return raw credentials. Designed so a future vault-backed
provider can be swapped in without changing callers (they only use
get_accounts() / get_account(key)).
"""
from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


@dataclass(frozen=True)
class AccountCredentials:
    access_key_id: str | None = None
    secret_access_key: str | None = None


@dataclass(frozen=True)
class Account:
    key: str
    name: str
    account_id: str
    role_arn: str | None = None
    credentials: AccountCredentials | None = None  # legacy static-key mode

    def __repr__(self) -> str:  # never leak secrets even in stack traces
        return f"Account(key={self.key!r}, name={self.name!r}, account_id={self.account_id!r})"


class AccountConfigError(RuntimeError):
    pass


class EnvAccountConfigProvider:
    """Phase 1 implementation: encrypted JSON via env var."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._accounts: dict[str, Account] | None = None

    def _decrypt(self) -> list[dict]:
        enc_payload_raw = os.environ.get("EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED")
        key = os.environ.get("EC2MANAGER_DECRYPTION_KEY")
        if not enc_payload_raw or not key:
            raise AccountConfigError(
                "EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED and EC2MANAGER_DECRYPTION_KEY must be set"
            )
        try:
            enc_payload = json.loads(enc_payload_raw)
            token = enc_payload["encryptedPayload"]
        except (json.JSONDecodeError, KeyError) as exc:
            raise AccountConfigError("Malformed EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED") from exc

        try:
            fernet = Fernet(key.encode())
            plaintext = fernet.decrypt(token.encode())
        except InvalidToken as exc:
            raise AccountConfigError("Failed to decrypt account config (bad key/token)") from exc

        return json.loads(plaintext)

    def _load(self) -> dict[str, Account]:
        raw_accounts = self._decrypt()
        accounts: dict[str, Account] = {}
        for entry in raw_accounts:
            creds = None
            if "credentials" in entry and entry["credentials"]:
                creds = AccountCredentials(
                    access_key_id=entry["credentials"].get("accessKeyId"),
                    secret_access_key=entry["credentials"].get("secretAccessKey"),
                )
            accounts[entry["key"]] = Account(
                key=entry["key"],
                name=entry.get("name", entry["key"]),
                account_id=entry["accountId"],
                role_arn=entry.get("roleArn"),
                credentials=creds,
            )
        return accounts

    def get_accounts(self) -> dict[str, Account]:
        with self._lock:
            if self._accounts is None:
                self._accounts = self._load()
            return self._accounts

    def get_account(self, key: str) -> Account:
        accounts = self.get_accounts()
        if key not in accounts:
            raise AccountConfigError(f"Unknown account key: {key}")
        return accounts[key]

    def reload(self) -> None:
        with self._lock:
            self._accounts = None


@lru_cache
def get_provider() -> EnvAccountConfigProvider:
    return EnvAccountConfigProvider()
