# Authentication & user identity architecture

## Status

| Piece | Status |
|---|---|
| Local admin-managed accounts (login, JWT sessions) | **Implemented, needs your own verification pass — see "Verification" below** |
| Admin-only user management (create/edit/activate/deactivate/delete/reset password) | **Implemented** |
| Public self-registration | **Removed by design** — there is no `/auth/register` endpoint |
| One-time admin bootstrap | **Implemented** (env-var driven, see below) |
| Provider-independent identity model (`User` / `Credential` / `ExternalIdentity`) | **Implemented** |
| Microsoft Entra ID / Entra External ID / Microsoft personal / Google login | **NOT implemented** — architecture is prepared for it (see "Adding an OIDC provider" below), but no provider is wired up, configured, or tested. Do not tell users these work until you've actually done this integration. |

This backend could not be compiled in the environment that produced it (no `dotnet` SDK available) — you must run `dotnet build` yourself and treat any compiler errors as real bugs to fix, not just take this on faith. Everything here was written and reasoned through carefully, and the frontend half of this same change was type-checked and build-verified, but the C# has not been.

## Why three tables instead of one `Users` table with a password column

- **`User`** — the permanent application identity. Everything else (schedules' `CreatedBy`, audit log `UserId`, role/permission checks) points at `User.Id`, which never changes regardless of how someone logs in.
- **`Credential`** — the local password, one-to-one with `User`. A user created for SSO-only access in the future simply has no row here.
- **`ExternalIdentity`** — zero or more rows per `User`, one per external login the person has linked. The identity key is `(Provider, ProviderUserId)` — `ProviderUserId` is the provider's own stable subject identifier (the OIDC `sub` claim), **never the email address**. Email is stored for display only and is never used to look up, merge, or auto-link accounts.

This means: adding Entra ID next year means adding rows to `ExternalIdentity` that point at existing `User.Id`s (or creating new `User` rows for new people) — it does not mean touching the `Credential` table, renumbering anyone, or rewriting `Schedule`/`AuditLog` foreign keys.

## How login works today (local only)

1. `POST /auth/login` with `{ username, password }`.
2. `AuthController` looks up the `User` by username, loads its `Credential`, verifies the password with BCrypt (work factor 12), and checks `IsActive`.
3. On success, `JwtService` issues a JWT whose `sub`/`NameIdentifier` claim is `User.Id` (not username, not anything provider-specific) and whose `role` claim is `User.Role` ("Admin" or "User").
4. The frontend stores the token in `sessionStorage` and attaches it as `Authorization: Bearer <token>` to every API call.
5. `[Authorize]` protects all endpoints; `[Authorize(Roles = "Admin")]` protects `UsersController`.

There is no refresh-token flow — sessions are the JWT's lifetime (`Jwt:ExpiryMinutes` in `appsettings.json`, default 60 minutes). When it expires, the frontend's 401 interceptor logs the user out and redirects to `/login`. This is a real limitation: a user mid-task loses their session with no silent renewal. If that's a problem in practice, the next step is a refresh-token table (one more `Credential`-shaped table, not a rearchitecture) — not implemented here because it wasn't asked for and adds real complexity (rotation, revocation).

## Initial admin bootstrap

There is no default admin account and no hardcoded password anywhere in this codebase. The **only** way an admin account is created is:

1. Set `EC2MANAGER_INITIAL_ADMIN_USERNAME`, `EC2MANAGER_INITIAL_ADMIN_PASSWORD` (and optionally `EC2MANAGER_INITIAL_ADMIN_EMAIL`) in `backend/.env`.
2. Start the backend. `AdminBootstrapService` (a `IHostedService`) checks at startup: if the `Users` table has zero rows, it creates exactly one admin from those env vars, validated against the same password policy (12+ chars, upper, lower, digit) as every other password in the system, and writes an `AdminBootstrap` audit log entry.
3. If the `Users` table already has any row — including from a previous bootstrap — this does **nothing**, forever. It is genuinely one-time.
4. If the env vars aren't set and no users exist, the backend logs a clear warning on every startup and no one can log in (fail-closed — there's no public registration to fall back to).

**After the first successful bootstrap, remove `EC2MANAGER_INITIAL_ADMIN_PASSWORD` from your `.env` file.** It's no longer read for anything.

## Managing users

Logged in as an admin, use the **Users** page (only visible/reachable to Admins — `RequireAdmin` in `App.tsx` redirects anyone else) to:

- Create a user (username, display name, email, role, initial password)
- Edit display name / email / role
- Activate / deactivate (deactivated users fail login immediately; their historical data is untouched)
- Delete (blocked for your own account, to prevent lockout)
- Reset a password — either type a new one, or leave it blank to have the server generate a random one meeting policy, shown to the admin exactly once

All of these write an audit log entry (`UserCreated`, `UserUpdated`, `UserActivated`, `UserDeactivated`, `UserDeleted`, `PasswordReset`), visible on the Logs page.

Self-protections built in: an admin cannot demote themselves out of the Admin role, deactivate themselves, or delete themselves — this prevents accidentally locking out the only admin.

## Adding an OIDC provider later (Entra ID, Entra External ID, Microsoft personal, Google)

None of this is implemented yet. This section is a plan, not a feature list — don't claim these work until you've done them and tested them end to end.

### Before you start: who are your users?

- **Employees / internal tool** → Microsoft Entra ID (work/school accounts), single tenant or multi-tenant depending on org structure.
- **External business customers** → Microsoft Entra External ID (CIAM), which supports both organizational and social/email identities.
- **Individual consumers** → Google login and/or Microsoft personal accounts (MSA), often alongside Entra External ID as the CIAM layer rather than as separate ad-hoc integrations.
- **Mixed** → Entra External ID as the front door, federating to Entra ID (work accounts), Google, and Microsoft personal accounts underneath it, is usually the least fragmented option — investigate this first rather than wiring up 3 separate SDKs.

Document your actual answer here before implementing anything; it changes which Azure/Entra app registration type you create.

### Implementation shape (once you've decided)

1. **Backend**: add `Microsoft.Identity.Web` (for Entra ID / Entra External ID) and/or a generic OIDC handler (`Microsoft.AspNetCore.Authentication.OpenIdConnect`) for Google. Register a second authentication scheme alongside the existing JWT bearer scheme — don't replace it, since local admin login should keep working during and after migration unless you deliberately retire it.
2. Add a callback endpoint, e.g. `POST /auth/oidc/callback` (or use the standard OIDC redirect flow if the frontend calls the IdP directly): validate the incoming ID token's signature and claims using the library's built-in validation (never hand-roll JWT validation), extract the `iss` + `sub` claims.
3. Look up `ExternalIdentity` by `(Provider, ProviderUserId=sub)`.
   - **Found** → resolve to that `ExternalIdentity.UserId`, issue your own app JWT via the existing `JwtService.GenerateToken(user)` exactly as local login does. Everything downstream (authorization, audit logs) is unchanged.
   - **Not found** → this is a new external identity. Either:
     - **Auto-provision** a new `User` (if that's your intended UX for this provider — e.g. any verified Entra ID user in your tenant is allowed in), or
     - **Require linking** to an existing account (see next section) if you don't want arbitrary external accounts auto-creating app access.
4. Update `AccountConfigProvider`/authorization as needed — role assignment for auto-provisioned users should have a sane default (`"User"`, never `"Admin"`) and rely on your own `UsersController`-equivalent to promote them, exactly as local accounts do today. Never trust an external IdP's group/role claims to directly set the app's Admin role unless you've deliberately decided to and documented why.
5. **Frontend**: add a "Sign in with Microsoft" / "Sign in with Google" button on the Login page that redirects to the IdP; keep the local login form for the admin (and any local-only users) unless/until you decide to retire local auth entirely.

### Linking an external identity to an existing account

For a user who already has a local password and wants to also (or instead) sign in via Entra ID/Google:

1. They log in normally (local password) first.
2. A new endpoint, e.g. `POST /auth/link-external`, authenticated with their existing session, initiates the OIDC flow and, on successful callback, inserts an `ExternalIdentity` row pointing at their **existing** `User.Id` — never creates a new `User`.
3. From then on, either login method resolves to the same `User.Id`, so their schedules, audit history, and role are untouched.

### Handling duplicate identities / changed emails / conflicts

- Two different `ExternalIdentity` rows (different providers, or the same provider with different `sub`s) are never merged automatically just because their `ProviderEmail` matches — that's the whole point of keying on `sub` instead of email. If you want to offer "these look like the same person, link them?" as a UX affordance, that must be an explicit, authenticated action (see linking flow above), never automatic.
- If a provider's `sub` claim reappears attached to a different email (the person changed their email at the IdP), nothing breaks — you never looked email up in the first place.
- If someone create a new local account (`Username`) with the same email as an existing user, both simply coexist as separate `User` rows unless an admin (or the person themselves, via the linking flow) explicitly connects them.

### Retiring local passwords later

Because `Credential` is a separate table, "local login" can be turned off per-user (or globally) by simply not creating/allowing new `Credential` rows and rejecting `/auth/login` for users with none — no schema change needed. Existing local accounts can be migrated by having each user complete the linking flow above, then an admin (or a scheduled task) deletes their `Credential` row once linking is confirmed. Keep at least one admin's local credential (or a documented emergency-access plan) until you're fully confident in the external provider's availability — you don't want an Entra ID/Google outage to be your organization's single point of total lockout.

## Verification checklist (do this yourself — not run in this environment)

- [ ] `dotnet build` succeeds with no errors
- [ ] `dotnet ef migrations add AddUserAuthArchitecture && dotnet ef database update` runs cleanly against a fresh database (see `docs/env-vars.md` / README for the exact commands and networking notes from earlier in this project)
- [ ] With an empty `Users` table and bootstrap env vars set, starting the backend creates exactly one admin (check `SELECT * FROM Users;`, check the `AdminBootstrap` audit log row)
- [ ] Restarting the backend again does **not** create a second admin or touch the existing one
- [ ] `POST /auth/register` does not exist (should 404)
- [ ] Logging in as the admin works; logging in as a non-existent or deactivated user fails with a generic "Invalid credentials" message
- [ ] A non-admin user gets `403 Forbidden` from every `/users/*` endpoint
- [ ] The Users page is unreachable (redirects to `/`) for a non-admin, and doesn't even appear in the nav
- [ ] Create / edit / deactivate / reactivate / delete / reset-password all work from the UI and each produces the expected audit log row
- [ ] An admin cannot deactivate, delete, or demote their own account
- [ ] The Refresh button on the Dashboard shows a spinner while fetching, and shows a toast on both success and failure (test failure by temporarily stopping `cloud-service` and clicking Refresh)
