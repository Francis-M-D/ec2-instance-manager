# Architecture

## Overview

Multi-cloud EC2 instance manager, AWS-only today, structured for GCP/Azure/Oracle later.

```
┌─────────────┐      JWT       ┌──────────────────┐   Bearer token   ┌──────────────────┐
│   React     │ ─────────────▶ │   .NET 8 API     │ ───────────────▶ │  Python FastAPI   │
│  frontend   │ ◀───────────── │  (backend/)      │ ◀─────────────── │  (cloud-service/) │
└─────────────┘                └──────────────────┘                  └──────────────────┘
                                       │                                       │
                                       ▼                                       ▼
                                 ┌───────────┐                          ┌────────────┐
                                 │   MySQL   │                          │  AWS APIs  │
                                 │ (EF Core) │                          │  (boto3)   │
                                 └───────────┘                          └────────────┘
```

## Responsibilities

- **cloud-service** (Python/FastAPI/boto3): the only component that talks to AWS directly.
  Implements `CloudProvider` (list/start/stop instances, region discovery). AWS is implemented
  with STS AssumeRole (cross-account, refreshable credentials) or legacy static keys.
  GCP/Azure/Oracle are stubs that raise `NotImplementedError`, wired through the same
  `get_provider(cloud)` factory so swapping providers is a one-line change for callers.

- **backend** (.NET 8 Web API): owns authentication, admin-managed user accounts, schedules, and
  audit logs (MySQL via EF Core). Never talks to AWS directly — always goes through
  `cloud-service` over HTTP, authenticated with a shared bearer secret
  (`EC2MANAGER_INTERNAL_API_KEY`). Enforces the DNS-tag policy at the API boundary and again when
  schedules fire (defense in depth; the Python service also enforces it at the point of the AWS
  call).

- **frontend** (React + Vite + TS + Tailwind): consumes the .NET API only, never cloud-service
  directly. TanStack Query handles caching/invalidation for instances, schedules, logs.

## Authentication & user identity

There is no public registration. Accounts are created by an administrator only, via
`UsersController`, after a one-time bootstrap (`AdminBootstrapService`) creates the first admin
from environment variables. The identity model deliberately separates three concerns so that
adding Microsoft Entra ID / Entra External ID / Microsoft personal accounts / Google login later
never requires touching `Schedule`, `AuditLog`, or any authorization logic:

- `User` — the permanent internal identity (`Id`, role, active flag). Everything else in the
  system references `User.Id`.
- `Credential` — the local password, one-to-one with `User`, kept in its own table so "how do we
  authenticate this person" is structurally separate from "who is this person."
- `ExternalIdentity` — zero-or-more rows per `User`, one per linked external login, keyed on
  `(Provider, ProviderUserId)` where `ProviderUserId` is the provider's stable subject id
  (never email).

Full detail, including the concrete plan for wiring up OIDC providers and the account-linking/
migration approach, is in `docs/authentication.md`.

## DNS tag policy

Instances tagged `DNS=Yes` (case-insensitive) are **protected** — they are DNS-critical and may
never be started/stopped through this tool, manually or via schedule. Every other instance (tag
missing, or any other value) is actionable. This is enforced in
`cloud-service/app/providers/base.py::is_dns_protected` and checked right before every AWS
`start_instances`/`stop_instances` call — never from a cache — so a tag change takes effect on
the very next action.

## Schedules

A schedule uses **either** a cron expression **or** windowed recurrence (`None`/`Daily`/`Weekly`
+ time of day + valid-from/valid-to), never both — validated in `ScheduleValidator`. A
`BackgroundService` (`ScheduleRunner`) polls every 15s, computes which enabled schedules are due,
and executes them through `cloud-service`, writing an audit log entry for every fire (success,
partial, or failed).

## Extending to a new cloud

1. Implement `CloudProvider` in `cloud-service/app/providers/<cloud>.py`.
2. Wire it into `factory.get_provider`.
3. Add an `authMode`/credential shape to the account config schema if it differs from AWS's
   `roleArn`/static-key shape.
4. No .NET or frontend changes are required unless you want cloud-specific UI (e.g. a cloud
   picker) — the internal API and DTOs are already cloud-agnostic.
