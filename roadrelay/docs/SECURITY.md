RoadRelay — Security
====================

## 1. Authentication

### JWT flow

```
client                              server
  │                                   │
  │── POST /auth/start-verification ─▶│
  │                                   │ generate code, hash with Argon2,
  │                                   │ store challenge row, send via SMS provider
  │◀──── 202 + challengeId ───────────│
  │                                   │
  │── POST /auth/complete-verification│
  │   { phone, code, installId }      │
  │                                   │ verify hash, consume row,
  │                                   │ upsert user + device,
  │                                   │ activate if pending,
  │                                   │ sign access + refresh JWTs
  │◀──── 200 + tokens ────────────────│
```

- **Access token** — HS256, ttl `JWT_ACCESS_TTL` (default 15 min).
  Contains: `sub`, `role`, `ts` (trust score), `st` (status), `did`
  (device id). Validated by `JwtAuthGuard` on every protected route.
- **Refresh token** — HS256 signed with a *different* secret, ttl
  default 30 days. Refresh rotation will be added once we ship a
  refresh endpoint (the schema and tokens are already in place).
- **Status guard** — `JwtAuthGuard` rejects `banned` and `deleted`
  accounts even with a valid signature, so revocation is immediate
  on token reissue and at most one TTL away on existing tokens.

In production, switch to RS256 with key rotation when the surface
warrants it. The current HMAC choice keeps the bootstrap simple.

### Why phone-only

- Lower spam ceiling than email (sybil cost = real SIM).
- Maps cleanly to "I will only be contacted by people I trust to have
  my plate".
- Recovery is the same as login, no separate password store.

The trade-off (SIM swap risk) is mitigated by device binding and the
trust gate.

---

## 2. Authorization

### Role model

| Role        | Granted to                 | Powers                                  |
| ----------- | -------------------------- | --------------------------------------- |
| `user`      | Default                    | Add vehicles, lookups, contact, report  |
| `moderator` | Trusted reviewers          | Vehicle approvals, report triage        |
| `admin`     | Engineering / on-call      | All moderator powers, sanctions, bans   |

`RolesGuard` reads `@Roles(...)` metadata. Every admin route is gated
by **both** `JwtAuthGuard` and `RolesGuard`, in that order.

### Trust gate

Even an `active` user can be silently filtered. See
[`ABUSE_PREVENTION.md`](./ABUSE_PREVENTION.md) §4.

---

## 3. Input validation

- **DTO validation** with `class-validator`. The global `ValidationPipe`
  is configured `whitelist: true, forbidNonWhitelisted: true`, so
  unknown fields are rejected loudly.
- **Plate normalization** is the only place we accept "free" text into
  the lookup hot path. `normalizePlate()` enforces a single canonical
  form: `[A-Z0-9]+`, max 10 chars, anything else throws.
- **Phone numbers** must match a strict E.164 pattern.
- **UUIDs** parsed via `ParseUUIDPipe`.
- **File uploads** allowlisted by content-type and capped at 20 MB
  before we even hand out a presigned URL.

We never construct SQL by string concatenation — every query uses
positional parameters.

---

## 4. PII protection

### Data minimisation

- **No DMV data, ever.** The system only matches plates a user has
  registered themselves.
- **No full geo location** — `plate_search_logs.geo_region` stores
  city / region strings; raw lat/lon is never sent.
- **Display names are optional.** A driver can run the entire flow
  with no name visible to anyone.

### What is encrypted

| Field                                  | Encryption                            |
| -------------------------------------- | ------------------------------------- |
| `users.phone_number_ciphertext`        | AES-256-GCM, key in `PII_ENCRYPTION_KEY` |
| `users.phone_number_hash`              | Deterministic HMAC-SHA256 (lookup key) |
| `relay_events.payload_ct`              | AES-256-GCM (per-message envelope)    |
| `vehicle_verification_artifacts` files | S3 SSE-S3 (`x-amz-server-side-encryption`) |

The plaintext phone number is **never written to disk**, **never
logged**, and **never returned in API responses** — only the last 4
digits (`phone_last_four`).

### Implementation

`src/common/utils/pii-crypto.ts` implements both the deterministic
HMAC and the AES-GCM envelope. The output layout is:

```
[ 12-byte IV | ciphertext | 16-byte auth tag ]
```

In production, replace the static `PII_ENCRYPTION_KEY` with a per-record
data key wrapped by KMS. The `PiiCrypto` interface stays the same; only
the constructor wiring needs to change.

---

## 5. Logging

- **Structured logs** via `pino` with PII fields explicitly redacted
  (`req.headers.authorization`, `phone`, `phone_number*`, `code`, `otp`).
- **Request id** added by `RequestIdMiddleware`; echoed in error
  envelopes so users can quote it to support without leaking detail.
- **Sensitive lookups** — `plate_search_logs` stores the *hash* of the
  plate, not the plaintext. A leak of the log table doesn't reveal
  what plates were searched.

---

## 6. Audit log

Every privileged action goes to `audit_logs`:

- `auth.signup`, `auth.login`, `auth.otp_failed`
- `vehicle.add`, `admin.vehicle_approve`, `admin.vehicle_reject`
- `contact_request.create | accept | decline | cancel`
- `safety.block | unblock | report`
- `admin.report_dismiss | warn | suspend | ban`
- `trust.anomaly_adjust`

The table is append-only by convention (no UPDATE/DELETE policies in
the MVP). In production:

- Mark it `INSERT`-only via a row-level security policy.
- Partition by month.
- Ship cold partitions to glacier-class storage after 90 days.
- Mirror to a write-once bucket for compliance / incident response.

`AuditService.write` swallows its own errors so audit failures never
break user-facing flows. Failures are logged loudly so monitoring picks
them up.

---

## 7. Encryption recommendations

| Scope                | Recommendation                                     |
| -------------------- | -------------------------------------------------- |
| TLS                  | TLS 1.3 only at the edge; HSTS preload.            |
| At rest (DB)         | Postgres TDE or full-disk encryption.              |
| At rest (PII fields) | Field-level via `PiiCrypto`.                       |
| At rest (S3)         | SSE-S3 by default, SSE-KMS for verification docs.  |
| In transit (worker)  | mTLS or VPC-only between API ↔ Postgres ↔ Redis.    |
| Secret storage       | AWS Secrets Manager / GCP Secret Manager.          |
| Key rotation         | 90 days for HMAC + JWT secrets; 1 year for PII KEK.|

---

## 8. Network surface

- **Helmet** for the standard hardening headers.
- **Strict CORS** — only configured front-ends are allowed.
- **No HTTP** — terminate TLS at the LB; redirect plain HTTP.
- **No introspection** — Swagger UI disabled when `NODE_ENV=production`.
- **No verbose errors** — `HttpExceptionFilter` returns a fixed
  envelope; raw error messages and stack traces never leave the box.

---

## 9. Account lifecycle

- **Soft delete** — `users.deleted_at` is set, ciphertext cleared,
  hash retained for sybil resistance until anonymized.
- **Re-registration** — same phone re-registers as a new user with a
  fresh trust score baseline (no carryover of previous bad behaviour
  is intentional, since the previous account is gone, but the
  anti-sybil cooldown is enforced via SMS provider velocity controls).
- **Right to be forgotten** — admin tooling will support hard delete
  + cascade in a follow-up. The schema already uses `ON DELETE CASCADE`
  on owned data so the work is bounded.
