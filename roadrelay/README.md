RoadRelay Backend (MVP)
=======================

Privacy-preserving driver-to-driver contact platform. Drivers register
their own vehicles, lookups happen ONLY against the in-app database
(no DMV data), and every interaction is consent-based and never reveals
phone numbers.

This repo contains the production-shaped backend scaffolding:

```
roadrelay/
├── docker-compose.yml          # Postgres + Redis + MinIO for local dev
├── package.json                # Node 20+ / NestJS / TypeScript
├── tsconfig.json
├── .env.example
├── migrations/                 # Raw SQL, applied with node-pg-migrate
│   ├── 001_init_extensions_and_enums.sql
│   ├── 002_users_and_devices.sql
│   ├── 003_vehicles.sql
│   ├── 004_plate_search_logs.sql
│   ├── 005_contact_requests_and_relay.sql
│   └── 006_safety_blocks_reports_sanctions.sql
├── docs/
│   ├── ARCHITECTURE.md         # System design, scaling, threat model
│   ├── API.md                  # All HTTP endpoints with examples
│   ├── ABUSE_PREVENTION.md     # Rate limits, trust scoring, anomaly rules
│   └── SECURITY.md             # JWT, PII, encryption, audit
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── config/                 # Typed config registries
    ├── common/                 # Cross-cutting middleware/guards/utils
    ├── infrastructure/         # DB, Redis, storage, notifications, relay
    ├── modules/                # One folder per bounded context
    │   ├── auth/               # OTP + JWT
    │   ├── users/
    │   ├── vehicles/           # Add, verify, visibility
    │   ├── plates/             # Lookup + abuse detection + trust scoring
    │   ├── contact-requests/   # Send, accept, decline, block
    │   ├── relay-sessions/     # Masked communication sessions
    │   ├── safety/             # Block, report, status
    │   ├── audit/              # Append-only audit log
    │   └── admin/              # Moderation dashboard endpoints
    └── jobs/                   # Cron: expirations, anomaly sweep
```

Read the docs in this order:

1. `docs/ARCHITECTURE.md`
2. `docs/API.md`
3. `docs/ABUSE_PREVENTION.md`
4. `docs/SECURITY.md`

Quick start (local):

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migration:run
npm run start:dev
# OpenAPI: http://localhost:3000/docs
```
