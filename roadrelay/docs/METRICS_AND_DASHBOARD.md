RoadRelay — Metrics, Dashboard, Future Integrations
===================================================

This is a "what to build next" companion doc. None of it is required
for the MVP backend to ship.

## 1. Metrics to track

### Product health

| Metric                                | Why it matters                                |
| ------------------------------------- | --------------------------------------------- |
| `daily_active_users`                  | Baseline growth.                              |
| `verifications_completed / day`       | Funnel: vehicle add → docs → reviewed.        |
| `avg_time_to_verification`            | Reviewer SLO.                                 |
| `lookup → match rate`                 | Network density. Below 5% means the graph is too sparse to be useful. |
| `lookup → contact_request rate`       | Intent-to-contact conversion.                 |
| `contact_request → accept rate`       | If this drops, sender quality is bad.         |
| `accept → relay_session messages`     | Did acceptance produce real conversations?    |
| `D7 / D30 retention`                  | Standard cohort analysis.                     |

### Trust & safety

| Metric                                | Why it matters                                |
| ------------------------------------- | --------------------------------------------- |
| `abuse_score >= 70 (denials) / day`   | How often the synchronous filter triggers.    |
| `anomaly_job hits / day`              | Background sweep severity.                    |
| `reports opened / 1k DAU`             | Baseline harassment rate.                     |
| `reports actioned / opened`           | Moderator effectiveness.                      |
| `time_to_action_p50`                  | Moderator SLO.                                |
| `sanctions issued / day, by kind`     | Watch for spikes.                             |
| `decline_rate by sender bucket`       | Find groomers / spammers early.               |
| `OTP fail rate by region`             | SMS pumping detection.                        |

### Reliability

| Metric                                | Target               |
| ------------------------------------- | -------------------- |
| `http_request_duration_ms_p95`        | < 200ms              |
| `http_request_duration_ms_p99`        | < 500ms              |
| `pg_pool_wait_time_p95`               | < 5ms                |
| `redis_command_duration_p95`          | < 2ms                |
| `error_rate (5xx)`                    | < 0.1%               |
| `cron_job_lag`                        | < 60s                |

Wire these up via `prom-client` in a follow-up; the structured logging
is already there to feed into Loki / Datadog.

---

## 2. Admin dashboard

Two-pane layout:

```
┌──────────────────────────────────────────────────────────┐
│  RoadRelay Moderation                              [me]  │
├──────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ Queues   │  │  Pending vehicle verification      │   │
│  │ ▶ Vehicles│  │  ┌──────────────────────────────┐  │   │
│  │   (24)   │  │  │ CA · 8ABC123 · Honda Civic   │  │   │
│  │ ▶ Reports│  │  │ Submitted 2h ago · 3 docs    │  │   │
│  │   (12)   │  │  │ [view docs] [approve] [reject]│ │   │
│  │ ▶ Users  │  │  └──────────────────────────────┘  │   │
│  │ ▶ Audit  │  │  ...                               │   │
│  └──────────┘  └────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Pages

1. **Vehicle queue** — `/admin/vehicles/pending`. Inline image viewer
   for artifacts (signed URLs). Approve / Reject with reason.
2. **Report queue** — `/admin/reports/open`. Group by reported user;
   show recent contact requests, relay event highlights, prior reports.
3. **User search** — by id or phone last-four; show trust score history,
   sanctions, reports filed against and by.
4. **Audit log** — searchable by `actor_id`, `action`, `target_id`,
   `request_id`. Read-only.
5. **Live abuse dashboard** — real-time chart of `abuse_score >= 70`
   denials and `anomaly_job` adjustments. One-click drill-down.

### Permissions

- **Moderators** — see queues, approve/reject vehicles, action reports.
- **Admins** — everything + manual sanction issuance, user role changes.

The backend already exposes everything needed; the dashboard is a thin
React app talking to `/v1/admin/*`.

---

## 3. Plugging in a real masked-communication provider

The `IRelayProvider` interface (`src/infrastructure/relay/tokens.ts`)
is the only contract domain code knows about. To add Twilio Proxy:

1. Create `src/infrastructure/relay/providers/twilio-proxy.provider.ts`:

   ```ts
   export class TwilioProxyProvider implements IRelayProvider {
     constructor(private readonly twilio: Twilio, private readonly serviceSid: string) {}

     async open(input: OpenRelaySessionInput) {
       const session = await this.twilio.proxy
         .services(this.serviceSid)
         .sessions
         .create({ uniqueName: input.contactRequestId, ttl: input.ttlSeconds });
       await session.participants.create({ identifier: phoneFor(input.participantA.userId) });
       await session.participants.create({ identifier: phoneFor(input.participantB.userId) });
       return { providerSessionId: session.sid, metadata: { provider: 'twilio_proxy' } };
     }

     async close(input: CloseRelaySessionInput) {
       await this.twilio.proxy.services(this.serviceSid)
         .sessions(input.providerSessionId).update({ status: 'closed' });
     }
   }
   ```

2. Register it in `relay-provider.module.ts` behind a config flag:

   ```ts
   case 'twilio_proxy':
     return new TwilioProxyProvider(buildTwilioClient(config), config.get('relay.twilio.serviceSid')!);
   ```

3. Domain code (the `RelaySessionsService`) does **not** change. The
   provider switch is a one-line config flip.

The same shape works for Bandwidth, Sinch, MessageBird, etc. The
critical contract:

- `open()` is **idempotent on contactRequestId** (so an accept retry
  doesn't double-open a session).
- `close()` is **idempotent**.
- Neither method receives or returns a phone number — domain code must
  pass an opaque user id, and the provider is responsible for resolving
  it to a number internally if needed.

For voice, layer a "request a call" intent on top of the existing
session. Voice is **explicitly out of MVP** to keep the consent surface
small.
