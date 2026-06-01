# @syncro/backend

The backend service for SYNCRO (`@syncro/backend`), a self-custodial subscription management platform. This Express.js + TypeScript server handles API endpoints, authentication, payment processing, and integrations with external services.

## Overview

The backend is responsible for:
- **API Endpoints**: RESTful API for subscription management, user preferences, analytics, and more
- **Authentication**: JWT-based auth with HTTP-only cookies; role-based access control (RBAC)
- **Email Integration**: Gmail and Outlook OAuth scanning for subscription detection
- **Payment Processing**: Stripe and Paystack webhook handling
- **Notifications**: Telegram bot, Slack webhooks, push notifications (Web Push/VAPID), email digests, and quiet-hours support
- **Blockchain**: Soroban/Stellar event indexing with Redis-backed dead-letter queue fallback
- **Observability**: Sentry error tracking, Winston structured logging, health snapshots

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Express.js 5.2.1 |
| Language | **TypeScript** (strict mode, compiled to `dist/`) |
| Database | PostgreSQL via Supabase (`@supabase/supabase-js`) |
| Auth | JWT + HTTP-only cookies (`jsonwebtoken`, `bcryptjs`) |
| Rate Limiting | `express-rate-limit` with Redis backing (`rate-limit-redis`) |
| Queue / Jobs | `bullmq`, `node-cron` |
| Push Notifications | `web-push` (VAPID) |
| Telegram | `telegraf` |
| Email | `nodemailer`, `googleapis`, Microsoft Graph |
| Blockchain | `@stellar/stellar-sdk` (Soroban) |
| Validation | `zod` |
| Logging | `winston`, `winston-daily-rotate-file` |
| Monitoring | Sentry (`@sentry/node`, `@sentry/profiling-node`) |

## Project Structure

```
backend/
├── src/
│   ├── index.ts                  # Express server entry point, route registration
│   ├── routes/                   # 24 route modules (see Route Inventory below)
│   ├── services/                 # 30+ business logic services
│   ├── middleware/               # Auth, RBAC, rate limiting, validation, error handling
│   ├── schemas/                  # Zod validation schemas
│   ├── jobs/                     # Scheduled jobs (reminder, auto-resume, CSP monitoring)
│   ├── config/                   # Logger, env validation, rate-limit config
│   ├── lib/                      # Redis store, TOTP rate limiter
│   ├── types/                    # Shared TypeScript type definitions
│   └── utils/                    # Cycle ID, expiry, retry, sanitization helpers
├── routes/
│   └── integrations/             # Gmail and Outlook OAuth routes (JS/TS hybrid)
├── services/                     # Legacy service files (email scanner, paystack, etc.)
├── tests/                        # Jest test suites (40+ test files)
├── migrations/                   # SQL migration files
├── scripts/                      # Env validation, Swagger export, DB utilities
├── docs/                         # Rate limiting and renewal execution docs
├── .env.example                  # Reference environment variable file
├── jest.config.js                # Jest configuration (ts-jest, 80% coverage threshold)
├── tsconfig.json                 # TypeScript compiler config (target ES2022, Node16)
└── package.json
```

## Setup

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL (or a Supabase project)
- Redis (optional — enables persistent rate limiting and blockchain DLQ)

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Key variables:

```bash
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
LOG_LEVEL=info

# Database (Supabase / PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/syncro

# Auth
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# Admin API Key — REQUIRED in production
# Generate with: openssl rand -hex 32
ADMIN_API_KEY=your_secure_admin_api_key

# Gmail OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/gmail/callback

# Outlook OAuth
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=...
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/integrations/outlook/callback

# Payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Telegram Bot
TELEGRAM_BOT_TOKEN=...

# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Encryption (for stored API keys)
ENCRYPTION_KEY=your_32_byte_encryption_key

# Push Notifications (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:noreply@syncro.app

# Redis (optional — rate limiting, DLQ, renewal locks)
REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_ENABLED=true

# Stellar / Soroban (optional — disables blockchain indexer if unset)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ADDRESS=...
STELLAR_SECRET_KEY=SB...
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Monitoring
SENTRY_DSN=...

# AI (optional — subscription classification fallback)
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...

# CSP Monitoring
CSP_MONITORING_ENABLED=true
CSP_ALERT_HOURLY_RATE=100
CSP_ALERT_AFFECTED_USERS=50
```

See `.env.example` for the full list including rate limit tuning variables.

### Running the Server

```bash
# Development (ts-node-dev with auto-reload)
npm run dev

# Production (compile then start)
npm run build
npm start

# Validate environment variables
npm run validate-env
```

### Database Migrations

```bash
# Push migrations to Supabase
npm run db:migrate

# Push to production
npm run db:migrate:prod

# Create a new migration file
npm run db:new

# Reset local database
npm run db:reset
```

### Testing

```bash
# Run all tests
npm test

# Backend-to-contract integration tests (simulated Soroban RPC, no secrets required)
npm test -- tests/integration/

# Tests use Jest + ts-jest with 80% coverage threshold
# Test files live in backend/tests/*.test.ts
```

#### Blockchain contract integration (Backlog #75)

Simulated integration tests in `tests/integration/` verify that `BlockchainService`
invokes the correct Soroban method names and that backend bindings stay aligned with
the canonical contract interface manifest in `shared/src/soroban-contract-interfaces.ts`.

| Test file | Purpose |
|-----------|---------|
| `integration/blockchain-contract-integration.test.ts` | Simulated RPC invoke + failure modes |
| `integration/contract-interface-drift.test.ts` | Backend bindings vs deployed contract signatures |

The contracts CI workflow also runs the drift test when Rust contracts change.
Live testnet tests remain opt-in via `tests/soroban-integration.test.ts`
(`ENABLE_TESTNET_ACTIONS=true` + Soroban secrets).

### Other Scripts

```bash
# Export Swagger spec to JSON
npm run swagger:export

# RLS compliance audit
npm run audit:rls

# Check for migration drift
npm run check:migrations
```

### API Documentation

Swagger UI is available at `/api/docs` when the server is running.
The raw OpenAPI spec is served at `/api/docs.json`.

---

## Route Inventory

All routes are registered in `src/index.ts`. Auth middleware (`authenticate`) is applied per-router. Admin routes additionally require `ADMIN_API_KEY` via `adminAuth`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs.json` | OpenAPI spec (JSON) |

### Subscriptions — `/api/subscriptions`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List user subscriptions |
| POST | `/` | Create subscription |
| GET | `/:id` | Get subscription by ID |
| PATCH | `/:id` | Update subscription |
| DELETE | `/:id` | Delete subscription |
| GET | `/:id/price-history` | Subscription price history |
| POST | `/:id/attach-gift-card` | Attach gift card to subscription |
| POST | `/:id/retry-sync` | Retry blockchain sync |
| GET | `/:id/cooldown-status` | Renewal cooldown status |
| POST | `/:id/cancel` | Cancel subscription |
| POST | `/:id/pause` | Pause subscription |
| POST | `/:id/resume` | Resume subscription |
| POST | `/bulk` | Bulk subscription operations |
| PATCH | `/:id/notification-preferences` | Update notification preferences |
| POST | `/:id/snooze` | Snooze subscription reminder |
| POST | `/:id/trial/convert` | Convert trial to paid |
| POST | `/:id/trial/cancel` | Cancel trial |
| GET | `/trials/saved-metric` | Trial savings metric |
| POST | `/import/preview` | Preview CSV import |
| POST | `/import/commit` | Commit CSV import |
| POST | `/check-duplicates` | Detect duplicate subscriptions |
| GET | `/auto-tag` | Auto-tag suggestions |
| POST | `/:id/track-interaction` | Track user interaction |

### Analytics — `/api/analytics`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/summary` | Spend summary and trends |
| GET | `/budgets` | User budgets |
| GET | `/spending` | Spending trends and monthly breakdown |
| GET | `/forecast` | 6-month spending forecast |

### Tags — `/api/tags`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List tags |
| POST | `/` | Create tag |
| DELETE | `/:id` | Delete tag |
| POST | `/subscriptions/:id/tags` | Add tag to subscription |
| DELETE | `/subscriptions/:id/tags/:tagId` | Remove tag from subscription |
| PATCH | `/subscriptions/:id/notes` | Update subscription notes |

### User — `/api/user`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/role` | Get user role |
| GET | `/export-data` | GDPR data export |
| DELETE | `/account` | Delete account |

### User Preferences — `/api/user` (via user-preferences router)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/preferences` | Get user preferences |
| PATCH | `/preferences` | Update user preferences |
| PATCH | `/preferences/quiet-hours` | Update quiet hours settings |
| GET | `/preferences/delayed-notifications` | Get delayed notifications |
| POST | `/preferences/test-quiet-hours` | Test quiet hours configuration |

### MFA — `/api/mfa`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/2fa/recovery-codes/generate` | Generate recovery codes |
| POST | `/2fa/...` | Additional MFA setup/verify endpoints |
| DELETE | `/2fa/recovery-codes` | Delete recovery codes |
| POST | `/2fa/notify` | Send MFA notification |
| PUT | `/2fa/...` | Update MFA settings |

### API Keys — `/api/keys`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create API key |
| GET | `/` | List API keys |
| DELETE | `/:id` | Revoke API key |
| GET | `/:id/usage` | Get API key usage stats |

### Team — `/api/team`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List team members |
| POST | `/` | Invite team member |
| GET | `/pending` | List pending invitations |
| POST | `/accept/:token` | Accept team invitation |
| PUT | `/:memberId` | Update member role |
| DELETE | `/:memberId` | Remove team member |
| PATCH | `/slack-webhook` | Update Slack webhook URL |

### Digest — `/api/digest`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/preferences` | Get digest preferences |
| PATCH | `/preferences` | Update digest preferences |
| POST | `/test` | Send test digest email |
| GET | `/history` | Get digest send history |
| POST | `/admin/run` | Manually trigger digest (admin) |

### Push Notifications — `/api/notifications/push`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/subscribe` | Register push subscription |
| DELETE | `/unsubscribe` | Remove push subscription |
| GET | `/status` | Get push notification status |
| GET | `/vapid-public-key` | Get VAPID public key |

### Slack Integration — `/api/integrations/slack`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Check whether Slack webhook delivery is configured |

### Risk Score — `/api/risk-score`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get all subscription risk scores |
| GET | `/:subscriptionId` | Get risk score for subscription |
| POST | `/recalculate` | Trigger global risk recalculation (admin) |
| POST | `/:subscriptionId/calculate` | Calculate risk for one subscription |

### Simulation — `/api/simulation`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Run billing simulation / cost projection |

### Exchange Rates — `/api/exchange-rates`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get current exchange rates (fiat + crypto) |

### Calendar — `/api/calendar`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/feed/:userId/:token.ics` | iCal feed for subscription renewals |
| GET | `/token` | Get calendar token |

### Gift Card Ledger — `/api/gift-card-ledger`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/balance` | Get gift card balance |
| GET | `/history` | Get ledger history |
| POST | `/top-up` | Add credit |
| POST | `/deduct` | Deduct credit |

### Referrals — `/api/referrals`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/code` | Get referral code |
| GET | `/stats` | Get referral statistics |
| POST | `/validate` | Validate a referral code |

### Suggestions — `/api/suggestions`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get subscription suggestions |
| POST | `/dismiss` | Dismiss a suggestion |

### Merchants — `/api/merchants`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List merchants |
| GET | `/:id` | Get merchant by ID |
| POST | `/` | Create merchant (admin) |
| PATCH | `/:id` | Update merchant (admin) |
| DELETE | `/:id` | Delete merchant (admin) |

### Audit — `/api/audit`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Write audit log batch |
| GET | `/` | Query audit logs (admin) |

### Compliance — `/api/compliance`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/export` | Export user data (GDPR) |
| POST | `/account/delete` | Request account deletion |
| POST | `/account/delete/cancel` | Cancel deletion request |
| GET | `/account/deletion-status` | Get deletion status |
| GET | `/unsubscribe` | Render unsubscribe page |
| POST | `/unsubscribe` | Process unsubscribe |
| GET | `/email-preferences` | Get email preferences |
| PATCH | `/email-preferences` | Update email preferences |

### Webhooks — `/api/webhooks`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List webhooks |
| POST | `/` | Create webhook |
| PUT | `/:id` | Update webhook |
| DELETE | `/:id` | Delete webhook |
| POST | `/:id/test` | Test webhook |
| GET | `/:id/deliveries` | Get webhook delivery history |

### Reminder Settings — `/api/reminder-settings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get reminder settings |
| PATCH | `/` | Update reminder settings |

### Integrations — `/api/integrations`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/gmail/auth` | Initiate Gmail OAuth |
| GET | `/gmail/callback` | Gmail OAuth callback |
| POST | `/gmail/scan` | Scan Gmail for subscriptions |
| DELETE | `/gmail/:id` | Disconnect Gmail account |
| GET | `/outlook/auth` | Initiate Outlook OAuth |
| GET | `/outlook/callback` | Outlook OAuth callback |
| POST | `/outlook/scan` | Scan Outlook for subscriptions |
| DELETE | `/outlook/:id` | Disconnect Outlook account |

### Telegram — `/api/telegram`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | Telegram bot webhook receiver |

### Admin — `/api/admin` and `/api/reminders`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reminders/status` | Public | Scheduler status |
| POST | `/api/reminders/process` | Admin | Trigger reminder processing |
| POST | `/api/reminders/schedule` | Admin | Schedule reminders |
| POST | `/api/reminders/retry` | Admin | Retry failed reminders |
| GET | `/api/admin/metrics/subscriptions` | Admin | Subscription metrics |
| GET | `/api/admin/metrics/renewals` | Admin | Renewal metrics |
| GET | `/api/admin/metrics/activity` | Admin | Agent activity metrics |
| GET | `/api/admin/health` | Admin | Full system health check |
| POST | `/api/admin/expiry/process` | Admin | Process subscription expiries |

---

## Security

- **Rate Limiting**: Redis-backed with in-memory fallback. Key limits:
  - Team invitations: 20/hour per user
  - MFA operations: 10 per 15 minutes per user
  - Admin endpoints: 100/hour per IP
- **CORS**: Restricted to `FRONTEND_URL`
- **Auth**: JWT stored in HTTP-only cookies; `authenticate` middleware on protected routes
- **RBAC**: `adminAuth` middleware guards admin endpoints via `ADMIN_API_KEY`
- **Input Validation**: Zod schemas on all mutating routes via `validate` middleware
- **PII Redaction**: Sensitive fields stripped from logs (see `PII_REDACTION_README.md`)
- **CSRF Protection**: CSRF middleware applied (`src/middleware/csrf.ts`)
- **Idempotency**: Idempotency-Key header support on key mutation endpoints
- **Secret Management**: Secrets loaded via `secret-provider.ts`; never logged

See `backend/docs/RATE_LIMITING.md` for full rate limiting documentation.

## Blockchain / Soroban

When `SOROBAN_CONTRACT_ADDRESS` or `STELLAR_SECRET_KEY` is not configured, blockchain writes are skipped and events are stored in `blockchain_logs` with `status="pending"`.

On RPC failure, the service retries with exponential backoff (3 attempts). After exhausting retries:
- If `REDIS_URL` is set → failed payload is pushed to Redis DLQ list `dlq:blockchain_tx`
- If Redis is unavailable → a dead letter entry is written to `blockchain_logs` with `event_type="blockchain_dead_letter"` and `status="dead_letter"`

> **Note**: The Soroban integration is currently configured for **Stellar Testnet**. Mainnet card issuance support is pending.

## Background Jobs

| Job | Trigger | Description |
|-----|---------|-------------|
| Reminder Engine | Cron (scheduled) | Processes and retries subscription reminders |
| Auto-Resume | Cron | Automatically resumes paused subscriptions |
| CSP Monitoring | Cron | Refreshes CSP violation stats and sends alerts |
| Health Snapshot | Every 15 min | Records system health metrics |
| Notification Queue | Event-driven | Processes the delayed notification queue |
| Expiry Service | Admin trigger | Processes subscription expiries |

## Planned / Not Yet Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Stellar Mainnet | Planned | Blocked on mainnet-ready card issuance |
| AI Classification | Partial | Anthropic/Gemini fallback wired; accuracy tuning in progress |
| WebSocket Push | Partial | VAPID push is shipped; real-time WebSocket delivery under development |

## Related Documentation

- `backend/ARCHITECTURE.md` — architecture decisions and service map
- `backend/docs/RATE_LIMITING.md` — comprehensive rate limiting documentation
- `backend/docs/PERFORMANCE_INDEXES_IMPLEMENTATION.md` — performance indexes documentation
- `backend/docs/PERFORMANCE_INDEXES_QUERY_PLANS.md` — query plans and benchmarking
- `backend/docs/RENEWAL_EXECUTION.md` — renewal execution flow
- `backend/BILLING_SIMULATION_API.md` — billing simulation details
- `backend/SUBSCRIPTION_API.md` — subscription API reference
- `backend/TELEGRAM_INTEGRATION_GUIDE.md` — Telegram bot setup
- `client/BACKEND_DOCUMENTATION.md` — frontend-facing API specifications
