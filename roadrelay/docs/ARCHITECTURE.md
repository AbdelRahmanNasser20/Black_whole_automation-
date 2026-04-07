RoadRelay — Architecture
========================

## 1. Goals

RoadRelay lets one driver contact another by their license plate **without
ever revealing personal phone numbers**. Plates are matched against the
app's own opt-in database. The system prioritises safety over growth:
malicious users will probe it from day one, and the architecture treats
that as the default case.

The backend has four jobs:

1. **Authenticate humans** (phone OTP, never anonymous accounts).
2. **Bind plates to verified humans** (manual review of documents).
3. **Mediate contact** (consent-required, masked communication only).
4. **Detect & punish abuse** (rate limits, trust scoring, sanctions).

## 2. High-level diagram

```
                ┌────────────────────┐
                │   Mobile clients   │
                │  (iOS / Android)   │
                └─────────┬──────────┘
                          │  HTTPS / JWT
                          ▼
┌──────────────────────────────────────────────┐
│              API Gateway / NestJS            │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Controllers  │→ │  Domain Modules      │  │
│  └──────────────┘  │ auth / users / ...   │  │
│  ┌──────────────┐  └────────┬─────────────┘  │
│  │ Guards       │           │                │
│  │ Filters      │           ▼                │
│  └──────────────┘  ┌──────────────────────┐  │
│  ┌──────────────┐  │ Infrastructure layer │  │
│  │ Cron / jobs  │  │ (db, cache, storage, │  │
│  └──────────────┘  │  notifications, relay│  │
│                    │  provider)           │  │
│                    └────────┬─────────────┘  │
└─────────────────────────────┼────────────────┘
                              │
        ┌───────────┬─────────┴─────────┬───────────────┐
        ▼           ▼                   ▼               ▼
   ┌────────┐  ┌─────────┐       ┌────────────┐   ┌────────────┐
   │Postgres│  │  Redis  │       │ S3 / MinIO │   │Notification│
   │  16+   │  │   7+    │       │ artifacts  │   │  + relay   │
   └────────┘  └─────────┘       └────────────┘   │  providers │
                                                  └────────────┘
```

Everything inside the dashed box is owned by us. Notifications, SMS,
and the masked-relay provider are accessed only through abstract
interfaces — never imported directly from domain code.

## 3. Bounded contexts

| Module             | Responsibility                                              |
| ------------------ | ----------------------------------------------------------- |
| `auth`             | Phone OTP, JWT issuance, device binding                     |
| `users`            | Profile, role, trust score, device records                  |
| `vehicles`         | Add, list, visibility, document upload, submit-for-review   |
| `plates`           | Plate lookup, abuse detection, trust gating                 |
| `contact-requests` | Send / accept / decline / cancel / block, content filtering |
| `relay-sessions`   | Open / fetch / end masked sessions, alias generation        |
| `safety`           | Blocks, reports, safety status                              |
| `admin`            | Moderation queue, vehicle approvals, sanction issuance      |
| `audit`            | Append-only log of every privileged action                  |

Modules talk to each other only via service classes (never directly to
each other's tables). The infrastructure layer is the only place that
imports SDKs (`pg`, `ioredis`, `aws-sdk`, etc.).

## 4. Request lifecycle

```
HTTP request
  → RequestIdMiddleware  (attach x-request-id)
  → Helmet               (security headers)
  → Cors
  → ValidationPipe       (DTO whitelist + transform)
  → Controller
    → JwtAuthGuard       (verify token, attach req.user)
    → RolesGuard         (admin / moderator gating)
    → RateLimitGuard     (Redis sliding window per route)
    → @CurrentUser()
    → service.call()
    → service writes audit log entry
  → HttpExceptionFilter  (uniform error envelope)
  → response
```

## 5. Why NestJS

- Built-in DI container makes the abstract-provider pattern (relay,
  notifications, storage) trivial to wire.
- Decorators give us composable cross-cutting concerns
  (`@RateLimit`, `@Roles`, `@CurrentUser`).
- Module boundaries are enforceable.
- We can introduce a separate worker entrypoint sharing the same
  modules without restructuring.

## 6. Why raw SQL migrations

- Schema is the most security-sensitive part of the system; we want
  reviewers to read it directly, with no ORM magic.
- Lookups against `vehicle_registrations` are hot paths that benefit
  from hand-tuned partial indexes.
- ORMs that hide column types make it too easy to leak phone numbers
  via accidental `SELECT *` calls.

We still use the `pg` driver from services, but with explicit column
lists in every query.

## 7. Service layer responsibilities

A service class:

- Owns transactions (`UnitOfWork.run`).
- Validates **business rules** (DTO validation handles syntax).
- Writes to **its own** tables only.
- Emits notifications and audit log entries.
- NEVER returns ORM entities directly to controllers — always maps to
  a public-safe shape that excludes ciphertext, hashes, and trust scores.

Controllers are intentionally thin: parse, delegate, return.

## 8. Background jobs

The MVP uses `@nestjs/schedule` (in-process cron). Two jobs:

- **`ExpirationsJob`** — every minute. Marks expired contact requests,
  closes ttl'd relay sessions, expires sanctions, prunes old OTP rows.
  Uses `FOR UPDATE SKIP LOCKED` to allow safe horizontal scale-out.

- **`AnomalyDetectionJob`** — every 5 minutes. Aggregates the past hour
  of plate-lookup logs and applies trust score adjustments to repeat
  offenders. Decoupled from the request path so per-lookup latency
  stays bounded.

When request volume justifies it, move both jobs to a separate worker
process backed by BullMQ (the deps are already in `package.json`).

## 9. Threat model (abridged)

| Threat                         | Mitigation                                            |
| ------------------------------ | ----------------------------------------------------- |
| Mass plate scraping            | Rate limits + trust gating + anomaly detection         |
| SMS pumping (toll fraud)       | Per-IP `auth.start` limit, OTP attempt cap, SMS provider velocity controls |
| Account takeover via SIM swap  | OTP attempts logged, device fingerprint binding, re-OTP on new install |
| Stalking via plate enumeration | No DMV data; plates ONLY match opted-in users; abuse score gates lookups |
| Owner deanonymisation          | Aliases in chat, no phone exposed, no email exposed   |
| Mass account creation (sybil)  | Phone-uniqueness, low default trust, cooldown after declines |
| Harassment via masked chat     | PII filter + slur filter + report + block + sanctions |
| DB leak                        | PII encrypted at rest, deterministic hash for lookup, audit log    |
| Insider abuse                  | RolesGuard + audit log + admin actions are all logged |
| Replay of OTP                  | Argon2 hash + single-use consume + TTL                |

## 10. Scaling considerations

**Current shape (MVP).** Single API process behind a load balancer,
single Postgres primary, single Redis. This handles tens of thousands
of DAU comfortably.

**First scale milestone.**

- **Postgres read replicas** for `plate_search_logs` analytics queries.
- **Promote `audit_logs`** to a monthly partitioned table; ship to
  cold storage after 90 days.
- **Move jobs** to dedicated worker processes (BullMQ).
- **Geographic CDN** in front of the storage bucket.

**Second milestone (millions of users).**

- **Plate lookup hot path** — `vehicle_registrations` is partitioned by
  `state_code`; the partial unique index already isolates verified rows.
- **Stream events** — emit `domain_event` rows to a Postgres logical
  replication slot or Kafka. Consumers (analytics, fraud, notifications)
  subscribe instead of querying directly.
- **Move OTP storage out of Postgres** into Redis with TTL keys to
  reduce write amplification.
- **Deploy regionally** — auth + writes pinned to region; lookups
  served from the nearest read replica.

## 11. Folder structure

```
src/
├── main.ts                              # bootstrap
├── app.module.ts                        # composition root
│
├── config/                              # typed config registries
│   ├── app.config.ts
│   ├── auth.config.ts
│   ├── database.config.ts
│   ├── redis.config.ts
│   └── storage.config.ts
│
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── rate-limit.guard.ts
│   │   ├── rate-limit.service.ts
│   │   └── roles.guard.ts
│   ├── middleware/
│   │   └── request-id.middleware.ts
│   ├── types/
│   │   └── auth.types.ts
│   └── utils/
│       ├── pii-crypto.ts
│       ├── phone.ts
│       └── plate.ts
│
├── infrastructure/
│   ├── database/
│   │   ├── database.module.ts           # PG_POOL provider
│   │   └── unit-of-work.ts              # transaction wrapper
│   ├── logging/
│   │   ├── logging.module.ts
│   │   └── pino-logger.service.ts       # PII redaction in logs
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── notification.service.ts      # facade
│   │   ├── tokens.ts                    # interfaces (no vendor types)
│   │   └── providers/
│   │       ├── stub-notification.provider.ts
│   │       └── stub-sms.provider.ts
│   ├── redis/
│   │   └── redis.module.ts              # REDIS_CLIENT, REDIS_RATE_LIMIT
│   ├── relay/
│   │   ├── relay-provider.module.ts
│   │   ├── tokens.ts
│   │   └── providers/
│   │       └── internal-relay.provider.ts
│   └── storage/
│       ├── storage.module.ts
│       ├── tokens.ts
│       └── providers/
│           └── s3-storage.provider.ts
│
├── jobs/
│   ├── jobs.module.ts
│   ├── expirations.job.ts
│   └── anomaly-detection.job.ts
│
└── modules/
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   ├── otp.service.ts
    │   ├── token.service.ts
    │   └── dto.ts
    ├── users/
    │   ├── users.module.ts
    │   └── users.service.ts
    ├── vehicles/
    │   ├── vehicles.module.ts
    │   ├── vehicles.controller.ts
    │   ├── vehicles.service.ts
    │   ├── vehicle-verification.service.ts
    │   └── dto.ts
    ├── plates/
    │   ├── plates.module.ts
    │   ├── plates.controller.ts
    │   ├── plates.service.ts
    │   ├── trust-score.service.ts
    │   ├── abuse-detection.service.ts
    │   └── dto.ts
    ├── contact-requests/
    │   ├── contact-requests.module.ts
    │   ├── contact-requests.controller.ts
    │   ├── contact-requests.service.ts
    │   ├── content-filter.service.ts
    │   └── dto.ts
    ├── relay-sessions/
    │   ├── relay-sessions.module.ts
    │   ├── relay-sessions.controller.ts
    │   └── relay-sessions.service.ts
    ├── safety/
    │   ├── safety.module.ts
    │   ├── safety.controller.ts
    │   ├── safety.service.ts
    │   └── dto.ts
    ├── admin/
    │   ├── admin.module.ts
    │   ├── admin.controller.ts
    │   └── admin.service.ts
    └── audit/
        ├── audit.module.ts
        └── audit.service.ts
```
