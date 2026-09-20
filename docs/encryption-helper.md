# Encryption helper

Account credentials (or, in the current STS-based design, role ARNs) are never stored in plain
text or in the database. They live only as a Fernet-encrypted JSON blob passed via environment
variables, decrypted once into memory by each service at startup.

## Format

```json
[
  {
    "key": "prod",
    "name": "Production",
    "accountId": "111111111111",
    "roleArn": "arn:aws:iam::111111111111:role/Ec2ManagerRole"
  }
]
```

(Legacy static-key format, still supported by `cloud-service` as a fallback, replaces `roleArn`
with `credentials: { accessKeyId, secretAccessKey }` — avoid this in new setups.)

## Regenerating

```bash
cd cloud-service
python generate_encrypted_config.py
```

This prompts for each account and prints the two env values to paste into `.env` files. Re-run
it whenever you add, remove, or change an account. See `docs/env-vars.md` for where the output
goes.

## Rotating the decryption key

1. Run the generator **without** setting `EC2MANAGER_DECRYPTION_KEY` in your shell — it will
   mint a brand-new Fernet key.
2. Update `EC2MANAGER_DECRYPTION_KEY` and `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED` in both
   `cloud-service/.env` and `backend/.env`.
3. Restart both services.

## Security notes

- Never commit `.env` files.
- Neither service logs the decrypted payload or individual credentials.
- The `/accounts` endpoints (both the internal Python one and the public .NET one) only ever
  return `key`, `name`, `accountId` — never `roleArn` or static keys.
- Phase 2 plan: replace `EnvAccountConfigProvider` (both the .NET and Python versions) with a
  vault-backed implementation (e.g. HashiCorp Vault, AWS Secrets Manager) behind the same
  `IAccountConfigProvider` / `get_provider()` interface, so no controller or provider code needs
  to change.
