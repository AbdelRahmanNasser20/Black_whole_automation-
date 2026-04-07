RoadRelay — Abuse Prevention
============================

The single most important assumption in the entire system:

> **Malicious users will try to abuse RoadRelay from day one.**
> Stalking, scraping, and harassment are the default failure modes,
> not the long-tail edge cases.

Every defence below is layered. No single layer is allowed to be the
only thing standing between an attacker and a victim.

---

## 1. Layered defences

```
                                 ┌──────────────────────┐
                                 │ Mobile client checks │  (UX hints)
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   1. Network                    │ Edge / WAF / CDN     │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   2. Per-IP rate limit          │ RateLimitGuard (IP)  │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   3. Auth                       │ JwtAuthGuard         │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   4. Per-user rate limit        │ RateLimitGuard (user)│
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   5. Trust gate                 │ TrustScoreService    │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   6. Heuristic abuse score      │ AbuseDetectionService│
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   7. Async anomaly sweep        │ AnomalyDetectionJob  │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
   8. Human moderation           │ AdminService         │
                                 └──────────────────────┘
```

If a layer fails or is bypassed, the next one still applies.

---

## 2. Rate limiting (Redis)

We use a **sliding-window counter** implemented as a Lua script in
Redis. Two buckets per (subject, route): the current and previous
windows. The previous bucket is weighted by elapsed fraction. This
gives smoother behaviour than fixed-window counters and avoids the
"double burst" problem at boundaries.

Decorator usage:

```ts
@RateLimit({ bucket: 'auth.start', limit: 5, windowSeconds: 60, by: 'ip' })
```

Subject keys:

| `by`        | Key shape                  |
| ----------- | -------------------------- |
| `ip`        | `ip:<remote>`              |
| `user`      | `user:<id>` (falls back to IP) |
| `user+ip`   | `user:<id>\|ip:<remote>`   |
| `device`    | `dev:<id>` (falls back)    |

### Standard buckets

| Route                                 | Limit                    | Window | Key   |
| ------------------------------------- | ------------------------ | ------ | ----- |
| `POST /auth/start-verification`       | 5                        | 60s    | ip    |
| `POST /auth/complete-verification`    | 10                       | 60s    | ip    |
| `POST /vehicles`                      | 5                        | 1h     | user  |
| `POST /vehicles/:id/verification-uploads` | 30                  | 1h     | user  |
| `POST /plates/lookup`                 | 30                       | 1d     | user  |
| `POST /plates/lookup` (per-IP)        | 60                       | 1d     | ip    |
| `POST /contact-requests`              | 10                       | 1d     | user  |
| `POST /safety/reports`                | 10                       | 1d     | user  |
| `POST /safety/blocks`                 | 50                       | 1d     | user  |

The route-level limits are the **upper bound**. The trust score gate
(`TrustScoreService.gateFor`) tightens them dynamically per user.

### What rate limiting does NOT do

It doesn't catch coordinated attacks across multiple accounts and IPs.
That's the job of the trust system + anomaly job (§4 and §5).

---

## 3. OTP brute force protection

Defence in depth:

1. **Per-IP** rate limit on `start-verification` (5/min) and
   `complete-verification` (10/min) — see above.
2. **Per-challenge** attempt limit (`OTP_MAX_ATTEMPTS=5`). Stored on
   the row; once exceeded the row is dead.
3. **Argon2** hashing of OTP code so a DB leak doesn't immediately
   expose live codes.
4. **Constant-time-ish verify path** — we always run `argon2.verify`
   even when the row doesn't exist, so timing reveals nothing.
5. **TTL** of 5 minutes (`OTP_TTL_SECONDS=300`).
6. **Single-use** — `consumed_at` is set conditionally; replays fail.

---

## 4. Trust score model

Every user has a `trust_score` integer in `[0, 1000]`, default `500`.
The gate is implemented in `src/modules/plates/trust-score.service.ts`:

| Score   | Behaviour                                                          |
| ------- | ------------------------------------------------------------------ |
| `< 300` | **Shadowbanned.** Lookups return "no match"; writes are no-ops.    |
| `< 450` | Lookups allowed (5/day). No new contact requests.                  |
| `< 600` | 20 lookups/day. 5 contact requests/day.                            |
| `< 800` | 40 lookups/day. 10 contact requests/day. *Default for verified.*   |
| `≥ 800` | 80 lookups/day. 20 contact requests/day. *High-trust users.*       |

### Score adjustments

| Event                              | Δ trust    |
| ---------------------------------- | ---------- |
| Vehicle verified                   | +75        |
| Contact request accepted (sender)  | +10        |
| Contact request accepted (recip)   | +5         |
| Contact request declined (sender)  | -5         |
| Report dismissed (reporter)        | -1         |
| Report actioned (reported user)    | -100       |
| Sanction issued                    | -250       |
| 30 days clean                      | +20        |
| Anomaly job hit                    | -25 .. -100|

The score is **never exposed to end users**. Surfaces show qualitative
tiers like "verified driver" instead.

---

## 5. Real-time abuse detection

`AbuseDetectionService.scoreLookup` runs synchronously on every plate
lookup and returns a 0..100 score plus reason tags. Heuristics:

| Reason                 | Trigger                                           | Δ score |
| ---------------------- | ------------------------------------------------- | ------- |
| `burst_60s`            | ≥ 10 lookups in 60s (per user)                    | +35     |
| `high_cardinality_10m` | ≥ 25 distinct plates in 10 min                    | +30     |
| `repeat_plate_24h`     | Same plate ≥ 4 times in 24h                       | +15     |
| `cross_ip_1h`          | ≥ 4 distinct IPs in 1h                            | +15     |
| `ghost_account`        | Account < 24h old AND no verified vehicle         | +20     |

If the synchronous score ≥ 70, the lookup is **denied with 403** and
logged with `abuse_score` set. The trust adjustment is applied
asynchronously by `AnomalyDetectionJob` so we don't pay the database
cost on the request path.

---

## 6. Asynchronous anomaly sweep

`AnomalyDetectionJob` runs every 5 minutes:

```sql
SELECT user_id,
       COUNT(*)            AS lookups,
       COUNT(DISTINCT plate_query_hash) AS distinct_plates,
       AVG(abuse_score)    AS avg_score
  FROM plate_search_logs
 WHERE created_at > NOW() - INTERVAL '1 hour'
 GROUP BY user_id
HAVING COUNT(*) > 50 OR AVG(abuse_score) > 30;
```

For each flagged user:

| Condition                  | Action             |
| -------------------------- | ------------------ |
| `> 50 lookups/h`           | -25 trust          |
| `> 200 lookups/h`          | -75 trust          |
| `> 30 distinct plates/h`   | -25 trust          |
| `avg_score > 50`           | -50 trust          |

Each adjustment writes a row to `audit_logs` for review.

---

## 7. Spam prevention for contact requests

- **Profanity / threats** — hard ban via `ContentFilterService`.
- **PII leakage** — phone, email, URLs are redacted from messages.
- **Self contact** — `cr_no_self_contact` constraint.
- **Duplicates** — partial unique index on `(sender, vehicle)` where
  `status = 'pending'`.
- **Cooldown** — 3 declines in 7 days = senders blocked from new
  requests until the cooldown expires.
- **Block check** — service rejects requests both ways.
- **One-time accept** — accepting flips status; further messages live
  only inside the relay session.
- **Message ttl** — `expires_at` set to `NOW() + 48h`; expired requests
  are reaped by the cron job.

---

## 8. Plate scan velocity (anomaly examples)

Stalker pattern (single user, high cardinality):

```
user_id              | lookups | distinct_plates | avg_score
---------------------|---------|-----------------|----------
u_01HX...            | 87      | 71              | 47
```

Result: `-100 trust` immediately, drops user under 450, no contact
requests allowed; eventually drops under 300 → shadowbanned.

Scraper pattern (rotating IPs):

```
user_id              | lookups | distinct_ip_1h | avg_score
---------------------|---------|----------------|----------
u_02HX...            | 220     | 6              | 62
```

Result: `cross_ip_1h` flagged on each lookup → abuse_score > 70 →
synchronous 403 → audit log → trust drops via job.

---

## 9. Sanctions ladder

`AdminService.actionReport` supports four actions:

| Action     | Sanction kind      | Effect                                          |
| ---------- | ------------------ | ----------------------------------------------- |
| `dismiss`  | none               | Closes report. -1 trust to noisy reporter.      |
| `warn`     | `warning`          | Toast to user. -50 trust.                       |
| `suspend`  | `suspended` (72h)  | All routes return 401 `account_locked`.         |
| `ban`      | `banned`           | Permanent. JWT immediately invalid.             |

Sanctions are stored on the `sanctions` table. `users.status` is the
authoritative gate (checked in `JwtAuthGuard`), but the sanctions
table holds the *why*.

---

## 10. Telemetry to track

Operationally we monitor:

- **OTP fail rate** (per region, per provider) — sudden spikes = abuse.
- **Lookup → contact ratio** — should stay sane (< 1:0.3 typical).
- **Decline rate** — too high suggests sender targeting.
- **Anomaly hits / hour** — alarm if it spikes.
- **Pending review queue depth** — SLO < 24h to action.
- **Open report queue depth** — SLO < 12h to action.
- **Sanctions issued / day** — too low *or* too high are both signals.
