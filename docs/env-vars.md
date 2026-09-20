# Environment Variables

## cloud-service/.env

| Variable | Required | Description |
|---|---|---|
| `EC2MANAGER_DECRYPTION_KEY` | Yes | Fernet symmetric key used to decrypt the accounts blob. |
| `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED` | Yes | `{"encryptedPayload": "..."}` — Fernet-encrypted JSON array of accounts. Generate with `python generate_encrypted_config.py`. |
| `EC2MANAGER_INTERNAL_API_KEY` | Yes | Shared secret the .NET backend sends as `Authorization: Bearer <this>`. Must match backend's copy. |
| `EC2MANAGER_ASSUME_ROLE_DURATION` | No (default `3600`) | Seconds each assumed STS session is valid for; auto-refreshed. |

## backend/.env

| Variable | Required | Description |
|---|---|---|
| `EC2MANAGER_DB_CONNECTION` | Yes | MySQL connection string (EF Core / Pomelo format). |
| `EC2MANAGER_JWT_SECRET` | Yes | HMAC signing key for JWTs. Use 32+ random bytes in production. |
| `EC2MANAGER_CLOUD_SERVICE_URL` | Yes | Base URL of the Python cloud-service, e.g. `http://cloud-service:8001`. |
| `EC2MANAGER_INTERNAL_API_KEY` | Yes | Must match cloud-service's value. |
| `EC2MANAGER_FRONTEND_ORIGIN` | No (default `http://localhost:5173`) | CORS-allowed origin for the frontend. |
| `EC2MANAGER_DECRYPTION_KEY` / `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED` | Yes | Same values as cloud-service — used to read account **metadata only** (key/name/accountId); the backend never decrypts or forwards credentials. |
| `EC2MANAGER_INITIAL_ADMIN_USERNAME` | Only for first run | Creates the one and only initial admin if the `Users` table is empty. See `docs/authentication.md`. |
| `EC2MANAGER_INITIAL_ADMIN_PASSWORD` | Only for first run | Must meet policy: 12+ chars, upper, lower, digit. **Remove from `.env` after the first successful startup** — it is not read again once any user exists. |
| `EC2MANAGER_INITIAL_ADMIN_EMAIL` | No | Optional display email for the bootstrap admin. |

## frontend/.env

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | No (default `http://localhost:8000`) | Base URL of the .NET backend. |

## Generating the encrypted account config

```bash
cd cloud-service
python generate_encrypted_config.py
```

You'll be prompted for one or more accounts (key, display name, AWS account ID, IAM role ARN).
The script prints `EC2MANAGER_DECRYPTION_KEY` and `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED` — paste
both, unchanged, into **both** `cloud-service/.env` and `backend/.env` (they must match exactly,
since both services decrypt the same blob).

Each target AWS account needs a role (e.g. `Ec2ManagerRole`) that trusts the principal ARN of
the cloud-service host's own identity (its EC2 instance profile role, typically), with a policy
granting at least `ec2:DescribeInstances`, `ec2:DescribeRegions`, `ec2:StartInstances`,
`ec2:StopInstances`.
