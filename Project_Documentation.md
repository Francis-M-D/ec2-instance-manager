# EC2 Manager — Project Reference & Study Guide

This document reverse-engineers the actual codebase in this repository. Every claim below is
based on reading the real source files — file paths and function names are exact, not
paraphrased. Where something in the code is unused, incomplete, or a stub, that is called out
explicitly rather than glossed over.

---

## 1. Project Overview

**What it is:** A web application for managing AWS EC2 instances across one or more AWS
accounts — viewing them, starting/stopping them (manually or on a schedule), and auditing every
action. It has three cloud provider stubs (GCP, Azure, Oracle) that are **not implemented** —
only AWS actually works.

**Problem it solves:** Lets a team start/stop EC2 instances through a web UI instead of the AWS
Console or CLI, while enforcing one hard safety rule — instances tagged `DNS=Yes` can never be
started or stopped through this tool, because they're DNS-critical — and keeping a full audit
trail of who did what.

**Who uses it:** Internal ops/engineering users. There is no public sign-up; an administrator
creates every account (see §10 Authentication).

**Main features actually implemented:**
- List/filter/search EC2 instances across accounts, regions, and states
- Manual start/stop (single or bulk) with a dry-run preview before acting
- Scheduled start/stop, either cron-based or "every day/week at time X", with dry-run preview
- Full audit log of every action (manual, scheduled, and admin/user-management actions)
- Admin-only user management (create/edit/deactivate/delete/reset password) — no public
  registration
- A background job that polls schedules every 15 seconds and fires due ones

**High-level architecture:**

```text
Browser (React app, port 5173)
  |
  | HTTP + JWT bearer token
  v
.NET 8 Backend API (port 8000)
  |         \
  |          \--> MySQL (users, schedules, audit logs — via EF Core)
  |
  | HTTP + shared secret bearer token
  v
Python FastAPI "cloud-service" (port 8001)
  |
  | boto3 (AWS SDK), via STS AssumeRole
  v
AWS EC2 API
```

Three separate runtime processes, three separate codebases, one Git repo. The .NET backend is
the only thing the frontend ever talks to. The Python service is the only thing that ever talks
to AWS. This separation is deliberate — see `docs/architecture.md`.

---

## 2. Technology Stack

| Layer | Technology | Role in *this* project |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Single-page app; Vite is the dev server/bundler |
| Frontend state/data | TanStack Query (`@tanstack/react-query`) | Caches and refetches server data (instances, schedules, logs, users) |
| Frontend routing | React Router v6 | Client-side routing between Dashboard/Schedules/Logs/Settings/Users |
| Frontend state (local) | Zustand | Just one store: `authStore` (token, username, role) |
| Frontend styling | Tailwind CSS | All component styling, no CSS-in-JS |
| Frontend HTTP | Axios | `api/client.ts` — single configured instance used by every `api/*.ts` file |
| Backend | .NET 8 Web API (C#) | Auth, users, schedules, audit logs, business rules; never talks to AWS directly |
| Backend ORM | Entity Framework Core + Pomelo MySQL provider | Maps C# classes in `Models/Entities.cs` to MySQL tables |
| Backend auth | Custom JWT (via `Microsoft.AspNetCore.Authentication.JwtBearer`) | Bearer tokens, role claim, no external identity provider wired up yet |
| Backend password hashing | BCrypt.Net-Next | Used in `Services/PasswordService.cs` |
| Backend cron parsing | Cronos | Used in `Services/ScheduleValidator.cs` for cron-mode schedules |
| Cloud service | Python 3.11 + FastAPI | Internal-only HTTP API, one route file (`app/main.py`) |
| Cloud service AWS SDK | boto3 / botocore | All actual EC2 API calls live in `app/providers/aws.py` |
| Cloud service config encryption | `cryptography` (Fernet) | Decrypts the AWS account list from an env var |
| Database | MySQL 8.0 | Users, Credentials, ExternalIdentities, Schedules, AuditLogs |
| Containerization | Docker + Docker Compose | `infra/docker-compose.yml` wires all 4 services (+ MySQL) together |

**Not used despite being present in the code:** `Services/IAccountConfigProvider.cs` defines an
interface intended to make the account-config source swappable (env-var today, a secrets vault
later) — only the env-var implementation (`EnvAccountConfigProvider`) exists; no vault
implementation is written. GCP/Azure/Oracle provider classes in `cloud-service/app/providers/`
exist and are wired into the factory, but every method in them raises `NotImplementedError` —
they are structurally present, never functionally used.

---

## 3. Architecture (detailed)

```text
User's browser
     |
     |  loads React SPA from Vite dev server (dev) or nginx (Docker prod build)
     v
React app (frontend/)
     |
     |  Axios, baseURL = VITE_API_BASE_URL, header: Authorization: Bearer <JWT>
     v
.NET 8 Web API (backend/)
     |            \
     |             \--> MySQL: Users, Credentials, ExternalIdentities, Schedules, AuditLogs
     |
     |  HttpClient, baseURL = EC2MANAGER_CLOUD_SERVICE_URL,
     |  header: Authorization: Bearer <EC2MANAGER_INTERNAL_API_KEY>
     v
Python FastAPI service (cloud-service/)
     |
     |  boto3, credentials via STS AssumeRole (DeferredRefreshableCredentials)
     v
AWS EC2 API (per account, per region)
```

Also running independently: `Services/ScheduleRunner.cs` — a `.NET` `BackgroundService` inside
the backend process that polls the `Schedules` table every 15 seconds and, for any due schedule,
calls the same cloud-service endpoints the frontend would call for a manual action.

---

## 4. Complete Project Structure

```text
ec2-manager/
├── backend/                         .NET 8 Web API
│   ├── Controllers/
│   │   ├── AuthController.cs        login + /me (no public registration)
│   │   ├── UsersController.cs       admin-only user CRUD
│   │   ├── AccountsController.cs    returns AWS account metadata (no secrets)
│   │   ├── InstancesController.cs   list/start/stop EC2 instances
│   │   ├── SchedulesController.cs   schedule CRUD + dry-run preview
│   │   └── LogsController.cs        paginated audit log query
│   ├── Services/
│   │   ├── JwtService.cs            issues JWTs
│   │   ├── PasswordService.cs       hash/verify/validate/generate passwords
│   │   ├── AdminBootstrapService.cs one-time initial-admin creation (IHostedService)
│   │   ├── AuditService.cs          writes AuditLog rows
│   │   ├── CloudServiceClient.cs    typed HttpClient wrapper around cloud-service
│   │   ├── IAccountConfigProvider.cs  + EnvAccountConfigProvider (reads/decrypts AWS account metadata)
│   │   ├── ScheduleValidator.cs     schedule validation + "next run" computation
│   │   └── ScheduleRunner.cs        BackgroundService that fires due schedules
│   ├── Models/Entities.cs           EF Core entity classes (User, Credential, ExternalIdentity, Schedule, AuditLog)
│   ├── Data/AppDbContext.cs         EF Core DbContext, table/column configuration
│   ├── DTOs/Dtos.cs, UserDtos.cs    request/response shapes (records)
│   ├── Program.cs                   app startup: DI, auth, CORS, middleware pipeline
│   ├── appsettings.json             non-secret default config
│   └── backend.csproj               NuGet package references, target framework
│
├── cloud-service/                   Python FastAPI, talks to AWS
│   ├── app/
│   │   ├── main.py                  FastAPI app + all HTTP routes
│   │   ├── providers/
│   │   │   ├── base.py              CloudProvider Protocol + is_dns_protected()
│   │   │   ├── aws.py               the only real implementation
│   │   │   ├── gcp.py / azure.py / oracle.py   stubs, all raise NotImplementedError
│   │   │   └── factory.py           get_provider(cloud) → picks implementation
│   │   └── config/account_config.py Fernet-decrypts the AWS account list from env
│   └── generate_encrypted_config.py CLI helper to produce the encrypted env value
│
├── frontend/                        React 18 + TS + Vite + Tailwind
│   └── src/
│       ├── main.tsx                 entry point — mounts <App/>, sets up QueryClient/Router
│       ├── App.tsx                  route table, auth/admin route guards
│       ├── pages/                   one file per route (Login, Dashboard, Schedules, Logs, Settings, Users)
│       ├── components/              shared UI: Layout, Button, Badge, Modal, Toast, ScheduleForm, etc.
│       ├── api/                     one file per backend resource (auth, users, instances, schedules, logs)
│       └── store/authStore.ts       Zustand store: token/username/role, persisted to sessionStorage
│
├── infra/
│   ├── docker-compose.yml           wires backend + cloud-service + frontend + mysql
│   ├── Dockerfile.backend / .cloud-service / .frontend
│   └── nginx.conf                   serves the built frontend in the Docker image
│
├── docs/                            architecture.md, authentication.md, env-vars.md, encryption-helper.md
└── README.md                        setup instructions
```

**Critical files** (read these to understand the app): `backend/Program.cs`,
`backend/Controllers/InstancesController.cs`, `cloud-service/app/providers/aws.py`,
`backend/Services/ScheduleRunner.cs`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/App.tsx`.

**Configuration files** (not application logic): `appsettings.json`, `.env`/`.env.example` files,
`tailwind.config.js`, `vite.config.ts`, `backend.csproj`, `requirements.txt`, `package.json`.

**Boilerplate/generated**: `vite-env.d.ts`, `postcss.config.js`, EF Core migration files (not
present in this repo yet — see §18).

---

## 5. Important Files — Detailed Explanation

### `backend/Controllers/InstancesController.cs`

**Purpose:** The endpoint the frontend Dashboard actually talks to for everything
instance-related — list, get one, start, stop.

**Why it exists:** It's the boundary between "the frontend's idea of an instance" (filtered,
paginated, JSON) and "cloud-service's idea of an instance" (raw AWS data) — plus it's where
audit logging for manual actions happens.

**Important functions:**
```csharp
GetInstances(...)   // GET /instances — fans out to cloud-service per account/region, filters, returns
GetInstance(...)    // GET /instances/{id} — full detail including tags
Start(...) / Stop(...)  // POST /instances/start, /instances/stop — thin wrappers around DoAction
DoAction(...)        // does the real work: calls CloudServiceClient, writes an AuditLog row
```

**How it's connected:**
```text
Dashboard.tsx (frontend)
   ↓ axios GET /instances?accountKeys=...
InstancesController.GetInstances()
   ↓ CloudServiceClient.ListInstancesAsync()  (one call per account×region)
cloud-service /instances/list
   ↓ AwsCloudProvider.list_instances()
boto3 describe_instances (AWS)
```

**Important code:**
```csharp
var filtered = dnsOnly == true ? all.Where(i => !i.DnsEnabled) : all;
```
`dnsOnly` is the frontend's "Hide protected" checkbox. `DnsEnabled` here actually means
*protected* (see §14 for why that name is confusing but intentional), so hiding protected
instances means keeping the ones where it's `false`.

---

### `cloud-service/app/providers/aws.py`

**Purpose:** The only file in the entire project that makes real AWS API calls.

**Why it exists:** Isolates all AWS-specific code behind the `CloudProvider` interface
(`base.py`), so `main.py`'s routes never need to know they're talking to AWS specifically.

**Important functions:**
```python
_get_session(account_key)       # builds/caches a boto3 Session, either via STS AssumeRole or static keys
_build_refreshable_session()    # the STS AssumeRole path — auto-refreshing credentials
get_regions(account_key)        # discovers + caches usable AWS regions for an account
list_instances(...)             # fans requests out across regions IN PARALLEL (ThreadPoolExecutor)
_split_by_dns_policy(...)       # the actual DNS=Yes protection check, right before any start/stop
start_instances() / stop_instances()   # thin wrappers around _do_action()
```

**How it's connected:**
```text
cloud-service/app/main.py (FastAPI route)
   ↓
AwsCloudProvider.list_instances() / start_instances() / stop_instances()
   ↓
boto3 ec2 client (per region)
   ↓
AWS EC2 API
```

**Important code:**
```python
if is_dns_protected(inst.get("Tags", [])):
    skipped.append({"instanceId": inst["InstanceId"], "reason": "Protected: DNS tag is set to Yes"})
else:
    actionable.append(inst["InstanceId"])
```
This is *the* safety rule of the entire application — checked fresh from AWS every single time,
never from a cache, so a tag change takes effect on the very next action attempt.

---

### `backend/Services/ScheduleRunner.cs`

**Purpose:** The only thing in this codebase that runs without any HTTP request triggering it —
a background loop.

**Why it exists:** Scheduled start/stop has to happen even if nobody has the web app open.

**Important functions:**
```csharp
ExecuteAsync(...)   // the BackgroundService loop — runs every 15s forever
TickAsync(...)      // one iteration: loads enabled schedules, checks each, fires due ones
ShouldFireNow(...)  // pure function: given a Schedule and "now", should it fire this tick?
FireAsync(...)      // actually calls cloud-service to start/stop, then writes an AuditLog
```

**How it's connected:**
```text
Program.cs: builder.Services.AddHostedService<ScheduleRunner>()
   ↓ (runs automatically at app startup, independent of any request)
ScheduleRunner.TickAsync() every 15s
   ↓
CloudServiceClient.StartInstancesAsync() / StopInstancesAsync()
   ↓
cloud-service → AWS
   ↓
AuditService.LogAsync()  (ActionType = "ScheduleStart" / "ScheduleStop")
```

---

## 6. Frontend Deep Dive

**Entry point:** `frontend/src/main.tsx` — creates a `QueryClient`, wraps `<App/>` in
`<QueryClientProvider>` and `<BrowserRouter>`, mounts to `#root`.

**Routing:** `frontend/src/App.tsx` defines the route table:
```tsx
<Route path="/login" element={<Login />} />
<Route element={<RequireAuth><Layout /></RequireAuth>}>
  <Route path="/" element={<Dashboard />} />
  <Route path="/schedules" element={<Schedules />} />
  <Route path="/logs" element={<Logs />} />
  <Route path="/settings" element={<Settings />} />
  <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
</Route>
```
`RequireAuth` redirects to `/login` if there's no token in `authStore`. `RequireAdmin` (nested
inside `RequireAuth`, so a token is already guaranteed) redirects to `/` if `role !== 'Admin'`.

**State management:** Two kinds, used for two different things:
- **Zustand** (`store/authStore.ts`) — the only global client state: `token`, `username`, `role`.
  Persisted to `sessionStorage` so a page refresh doesn't log you out.
- **TanStack Query** — every piece of *server* data (instances, schedules, logs, users, accounts)
  is a `useQuery`/`useMutation` call, never stored in Zustand or component state long-term. This
  is why the Dashboard's Refresh button calls `refetch()` rather than manually re-fetching and
  setting state.

**API/service layer:** `frontend/src/api/client.ts` is a single configured Axios instance:
```ts
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```
Every other `api/*.ts` file (`auth.ts`, `instances.ts`, `schedules.ts`, `logs.ts`, `users.ts`)
imports this same `api` instance, so auth headers and the 401→logout redirect are handled in
exactly one place.

**Example trace — clicking Start on an instance:**
```text
Dashboard.tsx: <Button onClick={() => requestAction('start', [inst.instanceId])}>
      ↓
requestAction() sets pendingAction, calls actionMutation.mutate({dryRun:true})
      ↓
api/instances.ts: startInstances(accountKey, region, ids, dryRun)
      ↓
axios POST /instances/start
      ↓
[shows DryRunModal with the preview]
      ↓ (user clicks Confirm)
confirmAction() calls actionMutation.mutate({..., dryRun:false})
      ↓
same endpoint, dryRun=false → actually starts the instance
      ↓
qc.invalidateQueries({queryKey:['instances']}) → table refetches automatically
```

---

## 7. Backend Deep Dive

**Entry point:** `backend/Program.cs`. Sequence, in order, as written in the file:
1. Reads `EC2MANAGER_DB_CONNECTION`, configures `AppDbContext` for MySQL via Pomelo
2. Registers services: `IAccountConfigProvider`, `JwtService`, `PasswordService`, `AuditService`,
   `CloudServiceClient` (typed `HttpClient`), and two `IHostedService`s: `ScheduleRunner` and
   `AdminBootstrapService`
3. Configures JWT bearer authentication (`ValidIssuer`/`ValidAudience` both = `"ec2-manager"`,
   symmetric key from `EC2MANAGER_JWT_SECRET`)
4. Configures CORS to allow exactly one origin: `EC2MANAGER_FRONTEND_ORIGIN`
5. `app.MapControllers()`, `app.Run()`

**Request lifecycle for an authenticated endpoint**, e.g. `GET /instances`:
```text
HTTP request arrives
   ↓
app.UseCors()           — checks Origin header against EC2MANAGER_FRONTEND_ORIGIN
   ↓
app.UseAuthentication()  — validates the JWT, populates HttpContext.User
   ↓
app.UseAuthorization()   — checks [Authorize] / [Authorize(Roles="Admin")] on the matched action
   ↓
InstancesController.GetInstances()  — the actual method body runs
   ↓
CloudServiceClient (HTTP call to cloud-service)
   ↓
response serialized to JSON, sent back
```

**Where the actual business logic lives** (not just plumbing):
- DNS protection enforcement: `cloud-service/app/providers/aws.py::_split_by_dns_policy` (real
  enforcement point) + `InstancesController`'s filtering (defense-in-depth, not the source of
  truth)
- Schedule validity rules (cron XOR windowed recurrence, etc.): `Services/ScheduleValidator.cs::Validate`
- "When should a schedule fire": `Services/ScheduleRunner.cs::ShouldFireNow`
- Password policy: `Services/PasswordService.cs::Validate`
- Self-lockout prevention (admin can't demote/deactivate/delete themselves):
  `Controllers/UsersController.cs` — each mutating action checks `user.Id == CurrentUserId`

---

## 8. Frontend ↔ Backend Connection

**Base URL:** frontend reads `VITE_API_BASE_URL` (from `frontend/.env`) at build time; baked
into the JS bundle (`frontend/src/api/client.ts`). This is why changing the backend's address
requires a frontend *rebuild*, not just an env var change at runtime — a real footgun encountered
earlier in this project's setup.

**Auth:** every request carries `Authorization: Bearer <JWT>`, attached by the Axios request
interceptor in `client.ts`. A `401` response triggers `useAuthStore.getState().logout()` and a
redirect to `/login`, handled in the same file's response interceptor.

| Frontend action | Method | Endpoint | Backend file | What it does downstream |
|---|---|---|---|---|
| Log in | POST | `/auth/login` | `AuthController.cs` | Verifies password, issues JWT |
| Get current user | GET | `/auth/me` | `AuthController.cs` | Returns id/username/email/role for the JWT's `sub` |
| List AWS accounts (metadata) | GET | `/accounts` | `AccountsController.cs` | Reads decrypted account config, returns key/name/id only |
| List instances | GET | `/instances` | `InstancesController.cs` | Calls cloud-service per account/region |
| Get one instance | GET | `/instances/{id}` | `InstancesController.cs` | Calls cloud-service, returns full detail incl. tags |
| Start/stop instances | POST | `/instances/start`, `/instances/stop` | `InstancesController.cs` | Calls cloud-service, writes AuditLog |
| List/create/edit/delete schedules | GET/POST/PUT/DELETE | `/schedules[/{id}]` | `SchedulesController.cs` | CRUD against MySQL `Schedules` table |
| Enable/disable schedule | POST | `/schedules/{id}/enable`, `/disable` | `SchedulesController.cs` | Toggles `Enabled` column |
| Preview a schedule | POST | `/schedules/{id}/dryRun` | `SchedulesController.cs` | Computes next N run times + affected instances |
| List audit logs | GET | `/logs` | `LogsController.cs` | Filtered/paginated query against `AuditLogs` |
| List/create/edit/delete users | GET/POST/PUT/DELETE | `/users[/{id}]` | `UsersController.cs` | Admin-only CRUD against `Users`/`Credentials` |
| Activate/deactivate user | POST | `/users/{id}/activate`, `/deactivate` | `UsersController.cs` | Toggles `IsActive` |
| Reset a user's password | POST | `/users/{id}/reset-password` | `UsersController.cs` | Sets new hash, optionally auto-generates one |

**Example — start instances, frontend to backend to cloud-service:**

Frontend (`frontend/src/api/instances.ts`):
```ts
export async function startInstances(accountKey, region, instanceIds, dryRun) {
  const res = await api.post('/instances/start', { accountKey, region, instanceIds, dryRun })
  return res.data
}
```
Backend (`InstancesController.cs`):
```csharp
[HttpPost("start")]
public Task<ActionResult<InstanceActionResponse>> Start(InstanceActionRequest req) =>
    DoAction(req, "start", "ManualStart");
```
Backend calling cloud-service (`CloudServiceClient.cs`):
```csharp
var resp = await _http.PostAsJsonAsync("/instances/start", new { accountKey, region, instanceIds, dryRun });
```
cloud-service (`app/main.py`):
```python
@app.post("/instances/start", ...)
def start_instances(req: ActionRequest) -> dict[str, Any]:
    provider = get_cloud_provider(req.cloud)
    return provider.start_instances(req.accountKey, req.region, req.instanceIds, req.dryRun)
```

---

## 9. Database Deep Dive

**Technology:** MySQL 8.0, accessed via EF Core + Pomelo. Connection string:
`EC2MANAGER_DB_CONNECTION` env var, read in `Program.cs`.

**Connection/model configuration file:** `backend/Data/AppDbContext.cs`.

**Tables (from `Models/Entities.cs`):**

```text
User
├── Id (PK)
├── Username (unique)
├── Email               ← NOT unique, NOT used as identity key (see §10)
├── DisplayName
├── Role                "Admin" or "User"
├── IsActive
├── CreatedAt, CreatedBy
└── LastLoginAt

Credential                       (1:1 with User)
├── Id (PK)
├── UserId (FK → User.Id)
├── PasswordHash
├── PasswordUpdatedAt
└── MustChangePassword

ExternalIdentity                 (N:1 with User — not used yet, see §11)
├── Id (PK)
├── UserId (FK → User.Id)
├── Provider, ProviderUserId     unique together — the real identity key
├── ProviderEmail
└── LinkedAt, LastLoginAt

Schedule
├── Id (PK)
├── Name, AccountKey, Regions (JSON), InstanceIds (JSON)
├── Action                       "Start" or "Stop"
├── ValidFrom, ValidTo
├── RecurrenceType, DaysOfWeek (JSON), TimeOfDay
├── CronExpression               mutually exclusive with the recurrence fields above
├── Enabled
└── CreatedAt/By, UpdatedAt, LastFiredAt

AuditLog
├── Id (PK)
├── Timestamp, UserId, UserName
├── ActionType                   e.g. ManualStart, ScheduleStop, UserCreated, Login, AdminBootstrap
├── AccountKey, Region, InstanceIds (JSON)
├── DryRun
├── Result                       Success / Partial / Failed
└── Message, Error
```

**Relationships:**
```text
User 1───1 Credential
User 1───N ExternalIdentity
```
`Schedule` and `AuditLog` have no FK relationship to `User` in the schema — `CreatedBy`/`UserName`
are plain strings, not foreign keys. This means deleting a user does **not** cascade-delete or
orphan-check their schedules/audit history; the string is just a historical label. This is a
deliberate simplification, not an oversight — auditing "who did this" should survive account
deletion.

**List/JSON columns:** `Regions`, `InstanceIds`, `DaysOfWeek` are stored as JSON strings via EF
Core value converters (`AppDbContext.cs`) since MySQL/Pomelo doesn't natively map `List<string>`.

**Example CRUD flow — creating a schedule:**
```text
POST /schedules  { name, accountKey, regions, action, cronExpression, ... }
      ↓
SchedulesController.Create()
      ↓
ScheduleValidator.Validate(schedule)   ← rejects if cron AND recurrence both set, etc.
      ↓
_db.Schedules.Add(schedule); await _db.SaveChangesAsync();
      ↓
INSERT INTO Schedules (...) VALUES (...)
```

---

## 10. Authentication & Authorization

**This section descriactually implemented — verify it yourself with
`dotnet build` before trusting it in production; see `docs/authentication.md` for the full
architecture rationale and the (unimplemented) plan for external providers.**

**Registration:** none. `AuthController.cs` has exactly two endpoints: `POST /auth/login` and
`GET /auth/me`. There is no `POST /auth/register` anywhere in the codebase.

**Initial account creation:** `Services/AdminBootstrapService.cs`, an `IHostedService` that runs
once at startup:
```csharif (anyUsers) return;   // never touches the DB again once ANY user exists
var username = Environment.GetEnvironmentVariable("EC2MANAGER_INITIAL_ADMIN_USERNAME");
var password = Environment.GetEnvironmentVariable("EC2MANAGER_INITIAL_ADMIN_PASSWORD");
```
If those env vars aren't set and no users exist, it logs a warning and does nothing — by design,
there is no fallback default credential anywhere in the code.

**Login flow:**
```text
LoginRequest {username, password}
      ↓
AuthController.Login()
    _db.Users.Include(u => u.Credential).FirstOrDefaultAsync(u => u.Username == req.Username)
      ↓
_passwords.Verify(req.Password, user.Credential.PasswordHash)   [BCrypt]
      ↓ (all of: exists, has Credential, IsActive, password matches)
_jwt.GenerateToken(user)   → JWT with sub=User.Id, role claim=User.Role
      ↓
AuthResponse { token, username, role }
      ↓ (frontend)
authStore.setAuth(token, username, role) → sessionStorage
```

**Password hashing:** BCrypt, work factor 12, in `Services/ice.cs`. Never stored or
logged in plaintext except the one-time response when an admin generates a random reset password
(`UsersController.ResetPassword`, `ResetPasswordResponse.GeneratedPassword`).

**Session:** JWT only, no refresh token. Expiry = `Jwt:ExpiryMinutes` in `appsettings.json`
(default 60 min). When it expires, the *next* API call gets a 401, the Axios interceptor logs the
user out client-side. There is no server-side session revocation — a JWT is valid until it
expires, full stop, even if e user is deactivated mid-session (until their *next* request hits
an endpoint that re-checks `IsActive`, which `/auth/me` does but most other endpoints don't
explicitly re-check per request — they rely on `[Authorize]` validating the JWT signature/expiry
only). **This is a real gap**, not something the code handles.

**Authorization:** role-based, two roles (`"Admin"`, `"User"`), via ASP.NET Core's built-in
`[Authorize(Roles = "Admin")]` on `UsersController`. The role comes from the JWT's `role` claim,
s once at login time — if an admin changes a logged-in user's role, that user's *existing*
token still carries the old role until they log in again.

**Logout:** client-side only — `authStore.logout()` clears `sessionStorage`. No server-side
token blacklist exists.

---

## 11. External Services and Integrations

Only one real external integration: **AWS**, via boto3 in `cloud-service/app/providers/aws.py`.

```text
AwsCloudProvider._build_refreshable_session()
      ↓
boto3.client("sts").assume_role(R=..., ...)   [the "hub" host's own IAM identity assumes into the target account]
      ↓
DeferredRefreshableCredentials  [auto-refreshes before expiry, no manual re-assume needed]
      ↓
boto3 ec2 client, built from that session
      ↓
AWS EC2 API: describe_instances, describe_regions, start_instances, stop_instances
```

No other external service (no email provider, no payment gateway, no third-party auth provider,
no Redis/queue) is integrated anywhere in the code, despite `docs/authentication.md`enting
a *plan* for Microsoft Entra ID / Google login — none of that is implemented yet, only planned.

---

## 12. API Reference (backend, `.NET`)

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | none | Log in, get JWT |
| GET | `/auth/me` | any user | Current user info |
| GET | `/accounts` | any user | AWS account metadata (no secrets) |
| GET | `/instances` | any user | List/filter instances |
| GET | `/instances/{id}` | any user | Instance detail |
| POST | `/instanc/start` | any user | Start (dry-run or real) |
| POST | `/instances/stop` | any user | Stop (dry-run or real) |
| GET/POST | `/schedules` | any user | List / create |
| GET/PUT/DELETE | `/schedules/{id}` | any user | Get / update / delete |
| POST | `/schedules/{id}/enable`, `/disable` | any user | Toggle |
| POST | `/schedules/{id}/dryRun` | any user | Preview next runs |
| GET | `/logs` | any user | Paginated audit log |
| GET/POST | `/users` | **Admin only** | List / create user |
| GET/PUT/DELETE | `/users/{id}` | **Admin only** | Get / update / delete user |
| POST | `/users/{id}/activate`, `/deactivate` | **Admin only** | Toggle account |
| POST | `/users/{id}/reset-password` | **Admin only** | Reset password |

Example:
```http
POST /instances/start
Authorization: Bearer <token>
Content-Type: application/json

{ "accountKey": "prod", "region": "ap-south-1", "instanceIds": ["i-0123..."], "dryRun": true }
```
```json
{
  "wouldStart": ["i-0123..."],
  "wouldStop": [],
  "wouldSkip": [{"instanceId": "i-0456...", "reason": "Protected: DNS tag is set to Yes"}],
  "errors": []
}
```

**Internal API (cloud-service, not called by the frontend directly):** `POST /instances/list`,
`POST /instances/start`, `POST /instances/stop`, `GET /accounts/{key}/regions` — all require
`Authorization: Bearer <EC2MANAGER_INTERNAL_API_KEY>`, a shared secret between backend and
cloud-service only.

---

## 13. End-to-End Flow: Creating a Schedule

```text
Schedules.tsx: user fills ScheduleForm, submits
      ↓
api/schedules.tseateSchedule(input)
      ↓
POST /schedules
      ↓
SchedulesController.Create(ScheduleCreateRequest req)
      ↓
MapToEntity(req, new Schedule)
      ↓
ScheduleValidator.Validate(schedule)
      │   - Name/AccountKey/Action required
      │   - ValidFrom required, ValidTo >= ValidFrom
      │   - cron XOR (RecurrenceType/DaysOfWeek/TimeOfDay) — never both
      │   - Weekly requires DaysOfWeek; Daily/Weekly require TimeOfDay
      ↓ (if errors) → 400 Bad Request, frontend shows toast
↓ (if valid)
_db.Schedules.Add(schedule); SaveChangesAsync()
      ↓
INSERT INTO Schedules (...)
      ↓
200 OK, schedule returned
      ↓
Frontend: qc.invalidateQueries(['schedules']) → table refetches
```

**Then, independently, every 15 seconds forever:**
```text
ScheduleRunner.TickAsync()
      ↓
SELECT * FROM Schedules WHERE Enabled = 1
      ↓
for each: ShouldFireNow(schedule, now)?
      │   cron mode: Cronos checks if a cron occurrence fell in the last ~2 minutes
      │   windowedode: is now within 30s of TimeOfDay, and (if Weekly) is today an allowed day?
      │   one-off mode: has ValidFrom just been crossed and never fired before?
      ↓ (if due)
FireAsync(schedule)
      ↓
CloudServiceClient.StartInstancesAsync(...) or StopInstancesAsync(...)   [dryRun: false]
      ↓
cloud-service re-checks DNS=Yes protection at execution time (never trusts anything cached)
      ↓
AuditService.LogAsync("ScheduleStart" or "ScheduleStop", ...)
      ↓
schedule.LastFiredAt = now; Sanc()
```

---

## 14. Business Logic — Where the Real Decisions Happen

**DNS protection (the single most important rule in the app):**
`cloud-service/app/providers/base.py::is_dns_protected` — `DNS=Yes` (case-insensitive) →
protected → cannot be started/stopped, ever, through this tool. Checked in
`aws.py::_split_by_dns_policy` immediately before every real AWS API call — never cached, never
trusted from an earlier list call.

> **Naming note worth flagging explicitly:** the wire field is called d` (in the JSON
> API, the C# `InstanceListItemDto.DnsEnabled`, and the frontend TS type) but it now means
> *protected*, not *actionable*. This is a deliberate policy flip made mid-project (the tag's
> original intended meaning was inverted from "DNS=Yes allows action" to "DNS=Yes blocks
> action") and the field name was never renamed to match — `is_dns_protected()` on the Python
> side is correctly named, but `DnsEnabled` on the C#/TS side is not. If you're recreating this
> project, name it `isProtecte from the start to avoid this confusion.

**Schedule mutual-exclusivity rule:** `ScheduleValidator.Validate` — a schedule is either cron-driven
or window-driven, never both; enforced with plain boolean logic, not a database constraint.

**Self-lockout prevention:** `UsersController.cs` — every mutating admin action
(`Update`, `SetActive`, `Delete`) checks `user.Id == CurrentUserId` and rejects self-harming
changes (demoting yourself, deactivating yourself, deleting yourself) with a 400.

**Password poli* `PasswordService.Validate` — 12+ chars, one upper, one lower, one digit.
Plain string checks, no external library for policy (only for hashing).

---

## 15. Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `EC2MANAGER_DB_CONNECTION` | backend | MySQL connection string |
| `EC2MANAGER_JWT_SECRET` | backend | HMAC key for signing JWTs |
| `EC2MANAGER_CLOUD_SERVICE_URL` | backend | Base URL of cloud-service |
| `EC2MANAGER_INTERNAL_API_KEY` | backend + cloud-service | Shared secret tween them |
| `EC2MANAGER_FRONTEND_ORIGIN` | backend | CORS allow-list (exactly one origin) |
| `EC2MANAGER_DECRYPTION_KEY` | backend + cloud-service | Fernet key to decrypt account config |
| `EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED` | backend + cloud-service | The encrypted account list itself |
| `EC2MANAGER_INITIAL_ADMIN_USERNAME/PASSWORD/EMAIL` | backend | One-time bootstrap only |
| `EC2MANAGER_ASSUME_ROLE_DURATION` | cloud-service | STS session length, default 3600s |
| `VITE_API_BASE_URL` | frontend | Backend base URL — **baked in at build time**, not runtime |
| `ASPNETCORE_URLS` | backend (Docker only, or manually exported for local `dotnet run`) | Which address/port Kestrel binds to |

`dotnet run` does **not** auto-load `.env` files — only Docker Compose's `env_file:` directive
does. This tripped up local (non-Docker) setup earlier in this project's history; the fix is
`set -a; source .env; set +a` before `dotnet run`.

---

## 16. Docker / Deployment

`infra/docker-compose.yml` defines 4 services:sql`, `cloud-service`, `backend`, `frontend`.
Build context for all three app Dockerfiles is the **repo root** (`context: ..`), not each
service's own folder — every `COPY` in each Dockerfile is prefixed with the service's folder name
accordingly (e.g. `COPY cloud-service/requirements.txt .`).

```text
docker compose up --build
      ↓
mysql container starts, healthcheck waits for it to accept connections
      ↓
cloud-service container builds (Python 3.11-slim base) and starts
      ↓
backend contalds (multi-stage: dotnet/sdk:8.0 build → dotnet/aspnet:8.0 runtime), starts
      ↓
frontend container builds (multi-stage: node:20-alpine build → nginx:1.27-alpine serve), starts
```

Inside the Docker network, services reach each other by **service name** (`mysql`,
`cloud-service`) as hostnames — e.g. `backend`'s `EC2MANAGER_CLOUD_SERVICE_URL=http://cloud-service:8001`.
From the host machine (or a browser), it's `localhost` (or the machine's public IP) plus the
**published** port. This distinctionce name vs. `localhost` — was a recurring source of
connection errors earlier in this project's setup, both for the app itself and for running EF
Core migrations from the host against the containerized MySQL.

---

## 17. Networking and Ports

| Component | Port | Reachable from | Notes |
|---|---|---|---|
| Frontend (Vite dev) | 5173 | Browser | Binds to `localhost` only unless `host: true` is set in `vite.config.ts` (added after an earlier remote-access issue) |
| Frontend (Docker/nginx) | 80 inside coniner, published as 5173 | Browser | |
| Backend | 8000 | Frontend, browser (Swagger) | Docker sets `ASPNETCORE_URLS=http://+:8000`; local `dotnet run` needs this exported manually or it binds elsewhere |
| cloud-service | 8001 | Backend only (internal API key required) | Never called by the frontend directly |
| MySQL | 3306 | Backend, migration tooling | Published to host by Docker Compose for local `dotnet ef` commands |

---

## 18. Error Handling

**Backend → frontend:** controllers mostly return stanrd ASP.NET Core results
(`BadRequest`, `NotFound`, `Unauthorized`, `Conflict`, `Ok`). Unhandled exceptions (e.g. a
`CloudServiceClient` call throwing because cloud-service returned 500) are **not** caught by any
global exception middleware in `Program.cs` — they surface as a raw 500 with a stack trace in
Kestrel's log, and the frontend just sees a failed HTTP request. There is no custom error
middleware in this project.

**Frontend:** the Dashboard's Refresh button is the one place with explicit, user-visle error
handling — `isFetching`/`error` from `useQuery`, a toast, and an inline error banner (this was a
bug fix; the original version had no error UI at all). Other pages rely on TanStack Query's
mutation `onError` callbacks to show toasts (`Schedules.tsx`, `Users.tsx`), but not every
`useQuery` call has explicit error UI — some pages will just silently show stale or empty data if
a GET fails.

**cloud-service:** a single `try/except ClientError` in `aws.py::_list_region` — if one AWS
region is unree/unusable (e.g. not opted-in), that region is skipped with a log warning
rather than failing the whole multi-region request. This was a real fix made during this
project's development after discovering that a newer opt-in AWS region without account
enablement broke the entire instance list.

---

## 19. Important Programming Concepts Used Here

- **Async/await** — everywhere in both C# (`async Task<...>`) and Python (`async def`, though
  most of `aws.py`'s boto3 calls are actually synchronous and just r inside FastAPI's
  threadpool via `run_in_threadpool`, not truly async I/O).
- **Dependency injection** — the entire backend is built on ASP.NET Core's built-in DI container
  (`builder.Services.AddScoped<...>`); controllers receive `AppDbContext`, `CloudServiceClient`,
  etc. via constructor injection, never instantiate them directly.
- **Background services** — `ScheduleRunner` and `AdminBootstrapService` both implement
  `IHostedService`/`BackgroundService`, .NET's mechanism for "run this outside thquest
  pipeline."
- **JWT claims-based auth** — the role check (`[Authorize(Roles = "Admin")]`) works purely off a
  claim embedded in a signed token; the server never re-checks the database's `Role` column on
  every request (a real, documented gap — see §10).
- **React Query mutations vs. queries** — `useQuery` for reads (auto-caching, auto-refetch),
  `useMutation` for writes (imperative `.mutate()`, manual cache invalidation via
  `qc.invalidateQueries`).
- **Thread pool parallelism (Python)** âstances` in `aws.py` uses
  `concurrent.futures.ThreadPoolExecutor` to query all AWS regions in parallel instead of one at
  a time — a real performance fix made during development (sequential regions made the Dashboard
  take 10+ seconds to load).

---

## 20. Critical Files to Study First

```text
1. backend/Program.cs                          — how the whole backend wires together
2. backend/Models/Entities.cs                  — the data model
3. backend/Controllers/InstancesController.cs  — theature, start to finish
4. cloud-service/app/providers/aws.py          — where AWS is actually touched
5. backend/Services/ScheduleRunner.cs          — the only code that runs without a request
6. frontend/src/App.tsx                        — route map + auth guards
7. frontend/src/pages/Dashboard.tsx            — the main screen, ties everything together
8. frontend/src/api/client.ts                  — how every frontend request is authenticated
9. backend/Controllers/UsersController.cs      — odel
10. docs/authentication.md                     — read this before touching auth code at all
```
Read in this order: backend shape → the one real feature end-to-end → the background job → the
frontend's entry/routing → the main screen → the auth model. This mirrors how the app actually
executes, not the folder structure.

---

## 21. Request-Tracing Example: "Stop this instance"

```text
Dashboard.tsx: row's Stop button
      ↓  disabled={inst.dnsEnabled}  — literally cannot click if protected
onClick={() => requestAction('stop', [inst.instanceId])}
      ↓
Dashboard.tsx: requestAction() → actionMutation.mutate({action:'stop', ids, dryRun:true})
      ↓
api/instances.ts: stopInstances(accountKey, region, ids, true)
      ↓
axios POST http://<backend>/instances/stop  {accountKey, region, instanceIds, dryRun:true}
      ↓
InstancesController.Stop(req) → DoAction(req, "stop", "ManualStop")
      ↓
CloudServiceClient.StopInstancesAsync(...)
      ↓
axios-equivalent (HttpClient) POST http://cloud-service:8001/instances/stop
      ↓
cloud-service/app/main.py: stop_instances(req) → provider.stop_instances(...)
      ↓
AwsCloudProvider._do_action(..., action="stop")
      ↓
_split_by_dns_policy() → re-verifies DNS tag right now, from AWS, not cache
      ↓ (dry_run=True, so:)
returns {wouldStop: [...], wouldSkip: [...], errors: []}  — NO actual AWS call made yet
      ↓ (back up the chain to the frontend)
Dashboard.tsx: DryRunModal shows the preview
      ↓ (user clks Confirm)
actionMutation.mutate({..., dryRun:false})  — same full chain again, dryRun=false this time
      ↓
AwsCloudProvider._do_action: ec2.stop_instances(InstanceIds=actionable)  — REAL AWS CALL
      ↓ (back in .NET)
InstancesController.DoAction: AuditService.LogAsync("ManualStop", ..., result, message)
      ↓
INSERT INTO AuditLogs (...)
      ↓
200 OK back to frontend
      ↓
Dashboard.tsx: toast shown, qc.invalidateQueries(['instances']) → table refetches, row updates
```

---

## 22. How to Recreate This Project From Scratch

```text
Stage 1 — Repo structure: backend/, cloud-service/, frontend/, infra/, docs/ folders.

Stage 2 — cloud-service skeleton: FastAPI app with a /health route, requirements.txt
  (fastapi, uvicorn, boto3, cryptography, pydantic). Verify: uvicorn app.main:app runs,
  curl /health returns 200.

Stage 3 — AWS provider interface: define a Protocol (base.py) with list/start/stop/get_regions
  methods before writing any real AWS code — this is what makes G stubs trivial later.

Stage 4 — Real AWS implementation: boto3 session management first (start with static keys —
  simplest), describe_instances, then start/stop. Add the DNS-tag check as a small pure function
  you can unit-test independently of AWS. Only after this works, add STS AssumeRole as an
  alternative session-building path.

Stage 5 — .NET backend skeleton: `dotnet new webapi`, add EF Core + Pomelo MySQL, a minimal
  User entity, get `dotnet ef database update` creating one table before aanything else.

Stage 6 — JWT login only (no registration): a Login endpoint that checks a hardcoded test user
  first, then swap in real password verification once the shape is right.

Stage 7 — CloudServiceClient: a typed HttpClient in the backend calling your cloud-service's
  /instances/list. Get one instance showing up in a curl response before building any UI.

Stage 8 — InstancesController: wraps CloudServiceClient, adds filtering. This is your first real
  feature end-to-end — verify with cuan before touching the frontend at all.

Stage 9 — React skeleton: Vite + TS + Tailwind, a Login page, an Axios client with the
  Authorization header interce017 wired up from day one (this is easy to forget and adds later).

Stage 10 — Dashboard: TanStack Query fetching /instances, a table, a Start/Stop button that
  calls the API with dryRun:true first, shows a confirm modal, then dryRun:false.

Stage 11 — Schedules: add the Schedule entity + validator (cron XOR recurrence) + CRUD endpoints
  beforeng the background runner — you want to be able to create/inspect schedules in the
  DB before anything auto-fires them.

Stage 12 — ScheduleRunner: an IHostedService polling loop. Test with a short interval and a
  one-off schedule set 30 seconds in the future before trusting cron/weekly logic.

Stage 13 — Audit logging: add AuditLog writes to every mutating action as you build it, not as
  an afterthought — retrofitting this later means re-touching every controller.

Stage 14 — Admin-managed useredential split from the start if you want future SSO
  support; a bootstrap hosted service instead of a public register endpoint.

Stage 15 — Docker Compose: write this last, once everything works via `dotnet run`/`npm run dev`/
  `uvicorn` locally — Docker networking bugs are much harder to debug on top of application bugs
  you haven't found yet.
```

---

## 23. Testing

**No automated test suite exists in this project** — this is a real gap, not something omitted
from this document. Manual verificonly:

```bash
# cloud-service
curl http://localhost:8001/health

# backend
curl http://localhost:8000/health
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}'

# frontend
curl -I http://localhost:5173
```
A successful login returns `{"token": "...", "username": "...", "role": "Admin"}`.

---

## 24. Troubleshooting (issues actually hit while building/running this project)

**Frontend can't reach backend:** check `VITE_API_BASE_URL` matches the backend's actual
reachable address (not `localhost` if accessed from a different machine — this is baked in at
*build* time, so changing `.env` requires a frontend rebuild), then check the backend is actually
listening (`ASPNETCORE_URLS` — Kestrel's default binding is not `0.0.0.0:8000` unless told to
be), then check CORS (`EC2MANAGER_FRONTEND_ORIGIN` must exactly match the frontend's origin,
including port).

**Backend can't reach MySQL:** check `EC2MANAGER_DB_CONNECTION` — `Server=mynly resolves
inside the Docker network; from the host (e.g. running `dotnet ef` locally) it must be
`Server=localhost`.

**`Table 'ec2manager.Users' doesn't exist`:** migrations haven't been applied —
`dotnet ef migrations add InitialCreate && dotnet ef database update`.

**cloud-service `AuthFailure` from AWS:** almost always either (a) clock skew on the host, or (b)
attempting a region the account hasn't opted into — both were hit and fixed during this project's
development; see `docs/architecture.md` the region-skip logic in `aws.py`.

---

## 25. Security Considerations

**Current implementation:**
- Passwords hashed with BCrypt (work factor 12), never logged or returned in plaintext except a
  one-time admin-generated reset password.
- No public registration — fail-closed if bootstrap env vars are never set.
- AWS credentials never touch the .NET backend or the database — only cloud-service holds a
  live AWS session, and even that's short-lived STS credentials, not long-lived static keys (when
 figured via `roleArn`).
- `EC2MANAGER_INTERNAL_API_KEY` gates backend→cloud-service calls, but it's a single static shared
  secret with no rotation mechanism built in.

**Potential concerns:**
- JWTs have no server-side revocation — a deactivated user's existing token remains valid until
  it expires (§10).
- No rate limiting on `/auth/login` — brute-force protection isn't implemented.
- CORS allows exactly one origin via exact string match — fine for this deployment shape, but
  fragile (a trailior protocol mismatch silently breaks everything, as seen repeatedly
  during this project's setup).
- No HTTPS is configured anywhere in this codebase — all traffic shown in this project's setup
  was plain HTTP, acceptable for a private/internal deployment behind a VPN or security group,
  not for public internet exposure as-is.

---

## 26. Development vs Production

| Aspect | Dev (as built/run in this project) | Production would need |
|---|---|---|
| Frontend | Vite dev server, `npm run dev` | Staticuild (`vite build`) served by nginx — the Docker image already does this |
| Backend | `dotnet run`, `ASPNETCORE_URLS` exported manually | Published build, HTTPS termination (reverse proxy), real secrets manager instead of `.env` |
| Secrets | Plaintext `.env` files | A vault (Anthropic — er, AWS Secrets Manager/Vault), not committed files |
| Database | Single MySQL container, root password | Managed MySQL (RDS), non-root credentials, backups |
| Auth | Static JWT secret in `.env` | Rotated secret, ide short-lived tokens + refresh flow (not implemented) |

---

## 27. Important Commands

```bash
# cloud-service
cd cloud-service && uvicorn app.main:app --reload --port 8001

# backend (local, non-Docker)
cd backend
set -a; source .env; set +a
export ASPNETCORE_URLS="http://0.0.0.0:8000"
dotnet run

# backend migrations
dotnet ef migrations add <Name>
dotnet ef database update

# frontend
cd frontend && npm install && npm run dev

# Docker (everything)
cd infra && docker compose up --build
```

---

## 28. Quick Reference

```text
Architecture:      React → .NET backend → Python cloud-service → AWS
                                  ↓
                                MySQL

Key files:
  backend/Controllers/InstancesController.cs   → the core feature
  cloud-service/app/providers/aws.py           → real AWS calls
  backend/Services/ScheduleRunner.cs           → background job
  frontend/src/pages/Dashboard.tsx             → main screen

Key endpoints:
  POST /auth/login              → get a JWT GET  /instances                → list EC2 instances
  POST /instances/start|stop    → act on them (dry-run first)
  GET/POST /schedules           → scheduled actions
  GET  /logs                     → audit trail
  /users/*  (Admin only)         → account management

Key rule: DNS=Yes tag → instance is PROTECTED, cannot be started/stopped, ever.
```

---

## 29. Understand This Project in 10 Minutes

1. **What is it?** A web tool to view and start/stop AWS EC2 instances, with a safety rule
   (nstances are protected) and audit logging.
2. **Major components:** React frontend, .NET backend (business logic + DB), Python
   cloud-service (the only thing that talks to AWS).
3. **Frontend:** `frontend/src/`, Vite dev server on port 5173.
4. **Backend:** `backend/`, .NET 8 Web API on port 8000.
5. **Database:** MySQL, accessed only by the backend via EF Core.
6. **Frontend ↔ backend:** HTTP + JWT bearer token, via a single Axios instance
   (`frontend/src/api/client.ts`).
7. **Backend ↔ database:**Core, `backend/Data/AppDbContext.cs`.
8. **Main business logic:** the DNS-protection check
   (`cloud-service/app/providers/base.py::is_dns_protected`, enforced in `aws.py`), and the
   schedule-firing decision (`backend/Services/ScheduleRunner.cs::ShouldFireNow`).
9. **Authentication:** admin-managed accounts only, JWT-based, in
   `backend/Controllers/AuthController.cs` + `UsersController.cs`; no public sign-up.
10. **Files to open first:** `backend/Program.cs`, then
    `backend/Controllers/InstancesController.cs`, then `cloud-service/app/providers/aws.py`.
