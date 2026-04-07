RoadRelay — REST API
====================

All endpoints live under `/v1`. Bodies and responses are JSON. Auth
uses a Bearer JWT in the `Authorization` header.

Errors share a common envelope:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many lookups. Try again later.",
    "requestId": "9c2b4f1e-...",
    "details": null
  }
}
```

---

## Auth

### `POST /v1/auth/start-verification`

Request an OTP for a phone number.

Rate-limited to 5 / minute / IP. The provider also enforces per-phone
velocity. We never reveal whether the number is already registered.

```http
POST /v1/auth/start-verification
Content-Type: application/json

{ "phoneNumber": "+15555550123" }
```

```json
202 Accepted
{
  "challengeId": "0e8d4f9a-...",
  "expiresAt": "2026-04-07T22:30:00.000Z",
  "resendCooldownSeconds": 60
}
```

### `POST /v1/auth/complete-verification`

Submit the OTP. Issues access + refresh tokens. If the phone has never
been seen before, also creates the user (`isNewUser = true`) and binds
the device.

```http
POST /v1/auth/complete-verification
Content-Type: application/json

{
  "phoneNumber": "+15555550123",
  "code": "482103",
  "installId": "ios-keychain-uuid-abc",
  "platform": "ios"
}
```

```json
200 OK
{
  "user": { "id": "u_01...", "phoneLastFour": "0123", "status": "active" },
  "isNewUser": true,
  "tokens": {
    "access": "eyJhbGciOi...",
    "refresh": "eyJhbGciOi...",
    "accessExpiresAt": "2026-04-07T22:45:00.000Z",
    "refreshExpiresAt": "2026-05-07T22:30:00.000Z"
  }
}
```

### `GET /v1/auth/me`

Returns the authenticated user's profile (no PII). Requires Bearer.

```json
200 OK
{
  "user": {
    "id": "u_01...",
    "displayName": null,
    "phoneLastFour": "0123",
    "role": "user",
    "status": "active",
    "trustScore": 500,
    "createdAt": "..."
  }
}
```

---

## Vehicles

### `POST /v1/vehicles`  *(auth required)*

Add a new vehicle. Status starts at `unverified`.

```http
POST /v1/vehicles
Authorization: Bearer ...
Content-Type: application/json

{
  "plate": "8ABC123",
  "state": "CA",
  "make": "Honda",
  "model": "Civic",
  "year": 2018,
  "color": "blue",
  "vinLastFour": "9421"
}
```

```json
201 Created
{
  "vehicle": {
    "id": "veh_01...",
    "plateNormalized": "8ABC123",
    "stateCode": "CA",
    "status": "unverified",
    "visibility": "public",
    ...
  }
}
```

### `GET /v1/vehicles`

List the caller's vehicles.

### `PATCH /v1/vehicles/:id/visibility`

```http
PATCH /v1/vehicles/veh_.../visibility
{ "visibility": "private" }
```

`public` (default), `private` (only previously-known senders), `hidden`
(invisible to lookup).

### `POST /v1/vehicles/:id/verification-uploads`

Request a presigned S3 PUT URL for a verification artifact.

```http
{
  "kind": "registration_doc",
  "contentType": "image/jpeg",
  "bytes": 423712
}
```

```json
{
  "uploadUrl": {
    "url": "https://s3.../...",
    "method": "PUT",
    "headers": { "Content-Type": "image/jpeg" },
    "expiresAt": "..."
  },
  "storageKey": "verifications/veh_.../registration_doc/01HX..."
}
```

### `POST /v1/vehicles/:id/verification-artifacts`

Confirm an upload finished. The server records the artifact and queues
it for malware scanning.

```http
{
  "kind": "registration_doc",
  "storageKey": "verifications/...",
  "contentType": "image/jpeg",
  "bytes": 423712,
  "sha256Hex": "abcdef..."
}
```

### `POST /v1/vehicles/:id/submit-for-review`

Move the vehicle to `pending_review`. Requires at least one clean
artifact. Admins approve via the moderation queue.

---

## Plates

### `POST /v1/plates/lookup`

Look up a license plate. Heavily rate-limited and gated by trust score.

```http
POST /v1/plates/lookup
Authorization: Bearer ...
{
  "plate": "8ABC123",
  "state": "CA",
  "geoRegion": "san-francisco-ca"
}
```

```json
200 OK
{
  "matched": true,
  "lookupId": "psl_42...",
  "abuseScore": 5,
  "vehicle": {
    "id": "veh_01...",
    "state": "CA",
    "plateNormalized": "8ABC123",
    "make": "Honda",
    "model": "Civic",
    "year": 2018,
    "color": "blue",
    "canBeContacted": true
  }
}
```

If no verified registration exists, returns `matched: false` with no
vehicle. Shadowbanned and abuse-blocked users get the same shape so
they can't tell they're being filtered.

---

## Contact requests

### `POST /v1/contact-requests`

Create a request from the caller to the owner of `vehicleId`.

```http
{
  "vehicleId": "veh_01...",
  "intent": "lights_on",
  "message": "Your headlights are still on in lot B!"
}
```

`intent` must be one of:
`lights_on | tire_flat | blocked_in | left_item | kind_note | incident | other`.

`message` is filtered server-side: phone numbers, emails, and URLs are
redacted; slurs and threats are hard-rejected.

### `GET /v1/contact-requests?direction=incoming|outgoing`

List active requests.

### `POST /v1/contact-requests/:id/accept`

Accept the request. Atomically opens a relay session.

```json
{
  "request": { ... },
  "sessionId": "rs_01..."
}
```

### `POST /v1/contact-requests/:id/decline`

Decline the request. The sender's trust score is reduced.
3 declines in 7 days triggers a sender cooldown.

### `DELETE /v1/contact-requests/:id`

Cancel a pending outgoing request.

### `POST /v1/contact-requests/:id/block`

Decline + block the sender in one action.

---

## Relay sessions

### `GET /v1/relay-sessions/:id`

Fetch session metadata. Only the two participants may read it. The
response uses **aliases**, never user ids or phone numbers.

```json
{
  "session": {
    "id": "rs_01...",
    "status": "active",
    "provider": "internal",
    "myAlias": "Driver-K312",
    "peerAlias": "Driver-N705",
    "expiresAt": "..."
  }
}
```

### `POST /v1/relay-sessions/:id/end`

Close the session. Both sides receive a `session_closed` event.

> Message send / receive endpoints are intentionally **not** part of
> the MVP wire spec — those land with the chat client wiring (see
> `ARCHITECTURE.md` §9). The schema is ready (`relay_events`).

---

## Safety

### `POST /v1/safety/reports`

```http
{
  "reportedUserId": "u_01...",
  "kind": "harassment",
  "description": "Sent threatening messages",
  "relaySessionId": "rs_01..."
}
```

### `POST /v1/safety/blocks`

```http
{ "blockedId": "u_01...", "reason": "spam" }
```

### `DELETE /v1/safety/blocks/:blockedId`

Remove an existing block.

### `GET /v1/safety/status`

Returns the caller's safety state.

```json
{
  "status": {
    "blockedCount": 3,
    "activeSanctions": [],
    "openReportsAgainstYou": 0
  }
}
```

---

## Admin (`role >= moderator`)

| Method | Path                                  | Purpose                          |
| ------ | ------------------------------------- | -------------------------------- |
| GET    | `/v1/admin/vehicles/pending`          | Review queue with artifacts      |
| POST   | `/v1/admin/vehicles/:id/approve`      | Mark verified                    |
| POST   | `/v1/admin/vehicles/:id/reject`       | Reject with reason               |
| GET    | `/v1/admin/reports/open`              | Open / triaging abuse reports    |
| POST   | `/v1/admin/reports/:id/action`        | dismiss / warn / suspend / ban   |

Every admin action writes an entry to `audit_logs`.

---

## Status codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 200  | Success.                                                                 |
| 201  | Resource created.                                                        |
| 202  | Accepted (OTP issued, async work scheduled).                             |
| 204  | No content (block, decline, end session).                                |
| 400  | Bad request — DTO validation or business rule (`vehicle_already_added`). |
| 401  | Missing / invalid token.                                                 |
| 403  | Authenticated but not allowed (role, trust gate, cooldown).              |
| 404  | Resource not found, OR deliberately hidden (visibility / block).         |
| 409  | Conflict (duplicate pending request).                                    |
| 422  | Validation error.                                                        |
| 429  | Rate limited (see `x-ratelimit-*` headers).                              |
| 500  | Internal error — never return raw error messages.                        |
