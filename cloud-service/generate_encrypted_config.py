#!/usr/bin/env python3
"""
Generates the EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED and EC2MANAGER_DECRYPTION_KEY
env values from one or more accounts, each authenticated via cross-account
STS AssumeRole (roleArn) — no static access keys.

Usage:
    python generate_encrypted_config.py

Prompts for accounts one at a time (enter blank key to finish), then prints
the two env var lines to paste into your .env file. Existing key can be
reused by setting EC2MANAGER_DECRYPTION_KEY in the environment before running.
"""
from __future__ import annotations

import json
import os

from cryptography.fernet import Fernet


def prompt_account() -> dict | None:
    key = input("Account key (short id, e.g. 'prod') [blank to finish]: ").strip()
    if not key:
        return None
    name = input("Display name (e.g. 'Production'): ").strip()
    account_id = input("AWS account ID (12 digits): ").strip()
    role_arn = input("Role ARN (e.g. arn:aws:iam::111111111111:role/Ec2ManagerRole): ").strip()
    return {"key": key, "name": name, "accountId": account_id, "roleArn": role_arn}


def main() -> None:
    accounts: list[dict] = []
    print("Enter accounts one at a time. Leave the key blank to finish.\n")
    while True:
        acct = prompt_account()
        if acct is None:
            break
        accounts.append(acct)
        print(f"  Added '{acct['key']}'. ({len(accounts)} account(s) so far)\n")

    if not accounts:
        print("No accounts entered, nothing to do.")
        return

    existing_key = os.environ.get("EC2MANAGER_DECRYPTION_KEY")
    if existing_key:
        print("Reusing EC2MANAGER_DECRYPTION_KEY from environment.")
        key = existing_key.encode()
    else:
        key = Fernet.generate_key()
        print("Generated a NEW Fernet key (no EC2MANAGER_DECRYPTION_KEY was set in env).")

    fernet = Fernet(key)
    plaintext = json.dumps(accounts).encode()
    token = fernet.encrypt(plaintext).decode()
    encrypted_env = json.dumps({"encryptedPayload": token})

    print("\n--- Paste these into your .env (do NOT commit them) ---\n")
    print(f"EC2MANAGER_DECRYPTION_KEY={key.decode()}")
    print(f"EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED={encrypted_env}")
    print("\n--------------------------------------------------------")
    print(f"\n{len(accounts)} account(s) encoded: {', '.join(a['key'] for a in accounts)}")


if __name__ == "__main__":
    main()
