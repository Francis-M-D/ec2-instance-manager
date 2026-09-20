# EC2 Manager

Multi-cloud instance manager — AWS supported today, architected for GCP/Azure/Oracle later.
Admin-managed user accounts (no public sign-up); local login today, architected for Microsoft
Entra ID / Google / Microsoft personal account login later without a rewrite.

- `cloud-service/` — Python 3.11 FastAPI + boto3. All direct AWS operations.
- `backend/` — .NET 8 Web API. Auth, user management, schedules, audit logs. Calls `cloud-service` over HTTP.
- `frontend/` — React 18 + Vite + TypeScript + Tailwind. Dashboard, Users, schedules, logs UI.
- `infra/` — Dockerfiles + docker-compose.
- `docs/` — architecture, authentication & identity, env vars, encryption helper.

Read before running anything:
- `docs/architecture.md` — overall system design
- `docs/authentication.md` — **user/identity model, admin bootstrap, and the plan for adding Entra ID / Google login later — read this before creating any users**
- `docs/env-vars.md` — every environment variable, what it's for

---

## 1. Required software

| Tool | Version | Used for |
|---|---|---|
| Docker + Docker Compose | recent | running everything (recommended path) |
| .NET SDK | 8.0 | backend, only needed for local (non-Docker) dev or running EF Core migrations |
| Python | 3.11+ | cloud-service, only needed for local dev or the config-encryption helper script |
| Node.js | 20+ | frontend, only needed for local (non-Docker) dev |
| AWS account(s) | — | with an IAM role set up per the encryption-helper doc |
| MySQL | 8.0 | via Docker Compose, or your own instance for local dev |

## 2. Get the project

Extract the provided archive (or clone your repo) so you have this structure on disk:

```
ec2-manager/
  backend/        .NET 8 Web API
  cloud-service/  Python FastAPI (talks to AWS)
  frontend/       React app
  infra/          Dockerfiles + docker-compose.yml
  docs/           all documentation referenced above
  README.md       this file
```

## 3. Configure environment variables

Copy each `.env.example` to `.env` and fill in real values — never commit `.env` files.

```bash
cd cloud-service && cp .env.example .env
cd ../backend && cp .env.example .env
cd ../frontend && cp .env.example .env
```

See `docs/env-vars.md` for what every variable means. The two you cannot skip before first
login: `EC2MANAGER_INITIAL_ADMIN_USERNAME` and `EC2MANAGER_INITIAL_ADMIN_PASSWORD` in
`backend/.env` (password: 12+ chars, upper, lower, digit) — there is no other way to get an
account into this system. Remove `EC2MANAGER_INITIAL_ADMIN_PASSWORD` again once bootstrap
has run once (see step 7).

## 4. Generate the encrypted AWS account config

```bash
cd cloud-service
pip install -r requirements.txt --break-system-packages   # or use a venv
python generate_encrypted_config.py
```

Paste the two printed values (`EC2MANAGER_DECRYPTION_KEY`, `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED`)
into **both** `cloud-service/.env` and `backend/.env` — they must match exactly. Full detail in
`docs/encryption-helper.md`.

## 5. Install dependencies (only needed for local/non-Docker dev — Docker does this itself)

```bash
# cloud-service
cd cloud-service && pip install -r requirements.txt --break-system-packages

# backend
cd ../backend && dotnet restore

# frontend
cd ../frontend && npm install
```

## 6. Create and migrate the database

**Docker path:** MySQL is created automatically by `docker-compose.yml`; you still need to run
migrations once (they don't run themselves):

```bash
cd backend
dotnet tool install --global dotnet-ef   # first time only
export PATH="$PATH:$HOME/.dotnet/tools"
export EC2MANAGER_DB_CONNECTION="Server=localhost;Port=3306;Database=ec2manager;User=root;Password=root;"
dotnet ef migrations add InitialCreate
dotnet ef database update
```

If you're running the backend itself inside Docker but running this command from the host, use
`Server=localhost` (MySQL's container port is published to the host); if you run this same
command from inside another container on the compose network, use `Server=mysql` instead.

**Local (non-Docker) path:** point `EC2MANAGER_DB_CONNECTION` at your own MySQL instance and run
the same `dotnet ef` commands above.

## 7. Initialize the administrator account (one-time, secure)

There is **no public registration page or endpoint**. The only account bootstrap path is:

1. Confirm `EC2MANAGER_INITIAL_ADMIN_USERNAME` and `EC2MANAGER_INITIAL_ADMIN_PASSWORD` are set in
   `backend/.env` (see step 3).
2. Start the backend (step 8). On its very first startup with an empty `Users` table, it creates
   exactly one admin from those two variables and logs a confirmation message.
3. Check the backend logs for that confirmation before trying to log in.
4. **Remove `EC2MANAGER_INITIAL_ADMIN_PASSWORD` from `backend/.env` now.** It is never read again
   once any user exists — leaving it in place is an unnecessary standing secret.

Full detail, including what happens if you forget to set these, in `docs/authentication.md`.

## 8. Start everything

### Docker (recommended)

```bash
cd infra
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend Swagger: http://localhost:8000/swagger
- cloud-service docs: http://localhost:8001/docs

### Local dev (three terminals, no Docker)

```bash
# Terminal 1 — cloud-service
cd cloud-service
uvicorn app.main:app --reload --port 8001

# Terminal 2 — backend
cd backend
dotnet run

# Terminal 3 — frontend
cd frontend
npm run dev
```

## 9. Log in as the administrator

Open the frontend URL, enter the username/password from step 7. You'll land on the Dashboard;
a **Users** link appears in the nav bar because you're an admin (it's hidden for non-admins).

## 10. Create and manage ordinary user accounts

From the **Users** page (admin only):
- **+ New user** — username, display name, email, role (`User` or `Admin`), initial password.
- **Edit** — display name, email, role.
- **Reset password** — type one, or leave blank to get a server-generated one shown once.
- **Activate / Deactivate** — deactivated users can't log in; their history is preserved.
- **Delete** — permanent; blocked for your own account.

Every action here writes an audit log entry, visible on the **Logs** page.

## 11. Verify signup is disabled and access is restricted

```bash
curl -i -X POST http://localhost:8000/auth/register   # expect 404 — endpoint does not exist
```

Log in as a non-admin user and confirm: no **Users** link in the nav, and:
```bash
curl -i http://localhost:8000/users -H "Authorization: Bearer <that user's token>"
# expect 403 Forbidden
```

## 12. Test the Refresh button

The Dashboard's Refresh button now shows a spinner while it's working and a toast on completion
or failure (previously it did neither, which is why it looked broken). To verify the fix:
1. Click Refresh — you should see "Refreshing…" briefly, then a "Instances refreshed" toast.
2. Stop `cloud-service` (`docker compose stop cloud-service`) and click Refresh again — you
   should see a red error toast and an inline error banner, not silence. Restart cloud-service
   (`docker compose start cloud-service`) and click Refresh once more to confirm recovery.

## 13. Run automated tests / troubleshoot

No automated test suite is included in this deliverable (none was present in the prior state of
the project, and adding one was outside the scope of these changes — flagging this rather than
claiming coverage that doesn't exist). If you add tests, `dotnet test` (backend) and a frontend
test runner (e.g. Vitest) are the natural next additions.

For runtime troubleshooting (Docker build failures, disk space, CORS, credential/region errors,
etc.), see the specific fixes already captured in this project's history — most issues that come
up when standing this up for the first time (clock skew, opt-in AWS regions, CORS origin
mismatches, EF Core migration ordering) have concrete, tested fixes already applied in the code.

## 14. Stop / restart

```bash
cd infra
docker compose down          # stop everything, keep data (mysql volume persists)
docker compose up --build    # restart
docker compose down -v       # stop AND wipe the database volume — irreversible
```

## 15–17. Future identity providers, and migration

Covered in full in `docs/authentication.md`:
- **§ "Adding an OIDC provider later"** — what Entra ID / Entra External ID / Microsoft personal
  account / Google login integration actually requires, and how to decide which ones you need
  based on who your users are.
- **§ "Linking an external identity to an existing account"** and **"Handling duplicate
  identities / changed emails / conflicts"** — the migration plan that preserves existing
  `User.Id`s, roles, schedules, and audit history when external auth is introduced later.
- **§ "Retiring local passwords later"** — how to safely phase out local auth once external
  providers are trusted, without losing emergency admin access.

---

## Status / known limitations

- GCP, Azure, and Oracle cloud providers are stubs (`NotImplementedError`) — only the interface
  and factory wiring exist.
- The `.NET` backend changes in this update were hand-written without a `dotnet` SDK available in
  the environment that produced them — **you must run `dotnet build` and the verification
  checklist in `docs/authentication.md` yourself**. The Python service and React frontend were
  both installed, type-checked, and build-verified successfully as part of this change.
- No refresh-token / silent session renewal — JWT sessions simply expire after
  `Jwt:ExpiryMinutes` (default 60) and the user is logged out. See `docs/authentication.md` for
  what adding this would involve.
- No self-service "forgot password" flow (no email provider is integrated) — password resets are
  admin-assisted only, via the Users page.
- No external identity providers (Entra ID, Google, Microsoft personal accounts) are configured
  or tested — only the architecture to add them without a rewrite is in place.
