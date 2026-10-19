# Telegram Bot & Mini App Management Studio

A self-hosted web application for managing multiple Telegram bots and Telegram Mini Apps (TMAs) from a single dashboard.

## Tech Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Backend   | NestJS 11, grammY (multi-bot long-polling pool), class-validator        |
| Database  | SQLite via Prisma 6 (WAL mode) at `data/studio.sqlite`, versioned `prisma/migrations` |
| Dashboard | React 19, Vite, Material UI v7, React Router v7, i18next (English, Turkish, German & Russian) |
| Mini Apps | React + Vite shell with the official Telegram WebApp SDK                |
| Runtime   | Bun (`oven/bun:1-alpine` in Docker)                                     |

## Quick Start (Local Development)

```bash
# 1. Install dependencies
bun install

# 2. Configure environment (defaults work out of the box)
cp .env.example .env

# 3. Run backend + dashboard + mini app dev servers concurrently
bun run dev
```

- Studio dashboard: http://localhost:5173
- NestJS API: http://localhost:3000/api/health

On first boot the master key from `ADMIN_MASTER_KEY` (default `admin123`) is hashed with Argon2id and stored in SQLite. Sign in with it and change it from the Security page.

## Production Build

```bash
bun run build    # compiles dashboard -> dist/client, TMA shell -> dist/client-tma, backend -> dist/server
bun run start    # applies pending prisma migrations, then serves everything on port 3000
```

### Database Migrations

Schema changes ship as versioned SQL under `prisma/migrations/`. `bun run start` and the Docker entrypoint run `prisma migrate deploy` before boot, so upgrading an existing installation applies only the pending migrations. Existing databases created before migrations were introduced need a one-time baseline:

```bash
bunx prisma migrate resolve --applied 0_init
```

## Tests & CI

Unit and integration tests (bun test, 160+ cases) cover the critical pure logic: Telegram initData HMAC validation **with replay freshness**, CSV serialization/escaping, message placeholder/template rendering, spin prize weighting, blocklist regex matching, chat-lock evaluation, duration/timezone helpers, locale-pack parity (including `{{placeholder}}` preservation) for both bot replies (14 languages) and the dashboard i18n, broadcast A/B bucketing and winner scoring, Stars cart re-pricing, and a full **export/import round-trip against a scratch SQLite database** (Mini Apps survive, re-import is idempotent). GitHub Actions CI runs the suite on **Linux and Windows**, verifies there is no drift between `schema.prisma` and the versioned migrations, builds the production Docker image, and uploads the build artifact on push.

## Security Posture

- **Production credential guard**: the server refuses to boot when `NODE_ENV=production` and `ADMIN_MASTER_KEY`/`JWT_SECRET` are unset or still at their documented defaults. Login throttle counters persist across restarts and are keyed on the proxy-aware client IP (`trust proxy` = 1 hop).
- **Session transport**: the dashboard JWT ships as an `HttpOnly` `SameSite=Strict` cookie (bearer headers still accepted for API clients). SSE streams authenticate with a 30-second single-use ticket (`POST /api/auth/sse-ticket`) instead of a URL-borne token. A strict CSP is enabled with allowances for Telegram's WebApp SDK and https media.
- **Mini App initData**: HMAC validation is constant-time and `auth_date` must be fresher than 24 hours (replay protection).
- **Webhooks**: inbound hooks require `X-Webhook-Signature: hex(hmac_sha256(secret, rawBody))` (the secret is shown once when the hook is created), use high-entropy ids, and are rate limited; outgoing deliveries are signed, timed out after 10 s, and blocked from private/loopback targets unless `WEBHOOKS_ALLOW_PRIVATE=1`.
- **Metrics scraping**: `GET /api/metrics` requires either `Authorization: Bearer $METRICS_BEARER_TOKEN` or an authenticated dashboard session — bot usernames and audience sizes are no longer public.
- **Secrets never echo**: module configs mask credential-shaped fields (`apiKey`, tokens) in GET responses; the sentinel `__MASKED__` preserves stored values when saving a form back.

## Backup & Restore

Backups are atomic (`VACUUM INTO`) and run **automatically once per UTC day** (disable with `DISABLE_NIGHTLY_BACKUP=1`); the studio keeps the newest 10 in `data/backups/` and writes a `<file>.manifest.json` next to each containing the schema version (latest applied migration) and a fingerprint of the JWT secret. Restore procedure: stop the container, replace `data/studio.sqlite` with the backup file (remove any `-wal`/`-shm` siblings), start again — `prisma migrate deploy` brings the restored file up to date if it was older. If the manifest's `jwtSecretFingerprint` differs from your current secret, all dashboard sessions will need re-login (expected). The studio must run as a **single instance**: SQLite allows one writer and Telegram answers concurrent `getUpdates` for the same token with 409 conflicts — do not scale the compose service.

## Bot Portability & Operations

- **Clone bot**: copy module toggles/configs, autoresponders, drip campaigns, and mini apps to a new bot from the bot dashboard (requires a fresh BotFather token).
- **Export/Import**: full bot configuration as a JSON bundle (AI API keys excluded from exports, version-checked and idempotent on re-import — Mini Apps included).
- **Template gallery**: save any bot's export bundle as a named template and apply it to other bots in one click.
- **Backups**: one-click SQLite backups (`VACUUM INTO`) served by `/api/backup` with download and delete, plus automatic nightly backups with restore manifests (see Backup & Restore below).
- **Health monitoring**: the studio watches every bot's poller state, records failure/recovery events, and can push Telegram alerts to a configured chat — with a studio-wide operator bot fallback (`HEALTH_ALERT_BOT_TOKEN` + `HEALTH_ALERT_CHAT_ID`) so even a revoked token page gets out, and automatic retry of undelivered alerts.
- **Resumable broadcasts**: the engine checkpoints progress (cursor + counters) every 25 sends; interrupted broadcasts expose a one-click resume from the dashboard instead of re-sending to everyone.
- **Prometheus metrics**: `GET /api/metrics` exposes runtime gauges (bot statuses, daily volume, enabled modules, audience size, uptime, memory, DB size, HTTP latency histogram) in the Prometheus text format; scraping requires a bearer token or an authenticated session.

## Automation & Content Features

- **Visual flow builder**: multi-step conversation trees (message, input, condition, delay, tag nodes) triggered by commands, keywords, or `/start`, with persistent per-user sessions, inline-button navigation, and sandbox testing through the real middleware chain.
- **Broadcast A/B experiments**: up to 3 variants sent to a deterministic test split, per-variant click-through tracking via redirect links, and one-click winner roll-out to the remaining audience.
- **Shared media library**: reusable URL / Telegram file_id assets with a picker wired into the broadcast, welcome, flow, and autoresponder composers.
- **Group file search**: indexes files shared in targeted groups and auto-answers "X var mı?" / "does anyone have X?" questions with a mention and t.me links; `/ara` and `/find` search on demand.
- **Inline mode**: answer `@bot <query>` searches in any chat with saved quick answers, optionally routed through the AI assistant (requires `/setinline` in @BotFather).
- **AI translation**: translate any studio text (welcome templates, rules, broadcasts) into a subset of the 14 supported bot languages in one provider call, then apply the result to the field.
- **Mini App templates**: seven ready templates — e-commerce (Stars checkout), loyalty hub, forms, reward wheel, webview, points leaderboard, and a support desk that relays requests to the support module's admin chat.

## Docker & Coolify Deployment

### Standard Docker Compose

```bash
docker compose up -d --build
```

The container exposes port `3000`, persists SQLite data in the named volume `tg_bot_studio_data`, and reports health via `GET /api/health`. `docker-compose.yml` supports environment variables from `.env` or your orchestrator: set strong values for `ADMIN_MASTER_KEY` and `JWT_SECRET` before deploying publicly — in `production` the server refuses to boot on fallback defaults. Run exactly **one instance** (SQLite single-writer + per-token long polling).

### Deploying to Coolify

This project is pre-configured for **Coolify (v4+)**:
- **Automatic Domain & SSL**: `SERVICE_FQDN_STUDIO_3000` automatically exposes the domain input field in Coolify and generates Let's Encrypt certificates through Traefik/Caddy.
- **Environment Management**: Environment variables can be configured directly inside the Coolify UI.
- **Database Persistence**: SQLite data is stored in the Docker named volume `tg_bot_studio_data` to survive rebuilds and redeployments.

For step-by-step instructions, see the **[Coolify Deployment Guide](COOLIFY.md)**.

## Project Structure

```text
tg-bot-studio/
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Container orchestrator with volume persistence
├── vite.config.ts              # Dashboard build (dist/client)
├── vite.config.tma.ts          # Mini App shell build (dist/client-tma)
├── data/                       # SQLite database folder (Docker volume mount)
└── src/
    ├── client/                 # React 19 Studio Dashboard
    ├── client-tma/             # Telegram Mini App webview shell + templates
    └── server/                 # NestJS backend
        ├── common/             # Guards, filters, interceptors, decorators, utils
        ├── database/           # SQLite service and migrations
        ├── auth/               # Master key authentication and sessions
        ├── bots/               # Bot CRUD, clone, export/import, backups
        ├── bot-engine/         # Multi-bot runtime pool and grammY dispatch
        ├── i18n/               # Bot-side locale packs (14 languages)
        ├── metrics/            # Prometheus metrics endpoint (/api/metrics)
        ├── templates/          # Bot template gallery (save/apply export bundles)
        └── modules/            # Isolated feature modules (36 toggleable)
```

## Module Catalog

All 36 modules are toggleable per bot from the Modules page and grouped into four sidebar categories:

| Category                  | Modules                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory & Content       | Chat Connections, Start Menu, Channel Post Scheduler, Shared Media Library, Group File Search                                                                                                                                                                                                                                 |
| Communication & CRM       | Support Desk (Livegram), Business Secretary, Drip Sequences, Broadcast Engine, Audience CRM                                                                                                                                                                                                                |
| Community & Moderation    | Group Welcome & Goodbye, Captcha Gatekeeper, Moderation & Anti-Spam, Group Moderation Commands, Group Admin Tools, Chat Locks, AntiRaid, Group Rules, Admin Log Channel, Message Cleaning, Forum Topic Management, Ban Federations, Bot Reply Language, Giveaways Engine, Referral Leaderboard, Quizzes & Polls, Reaction Analytics, Message Score & Leaderboard |
| Automation & Monetization | AI Assistant, Commands & Auto-Responder, Paid Media Paywall, VIP Subscriptions, Webhooks Hub, Bot-to-Bot Commands, Inline Mode Answers, Visual Flow Builder                                                                                                                                                 |

Every module ships with an integrated Documentation & Setup Guide dialog (Overview & Use Cases, Step-by-Step Setup, Placeholders Dictionary, Troubleshooting & Rate Limits) available from its dashboard page.

### Chat Connections

Register groups and channels once in the Connections module; every target-chat field across the studio (Scheduler, Support Desk, Giveaways, VIP Subscriptions, Paid Media, Webhooks) becomes a dropdown powered by that shared list. Chats the bot is added to are learned automatically — the engine records every group/channel the bot operates in and a 30-second auto-sync imports them into the address book (titles and usernames enriched via `getChat`), so the Connections list stays current without any manual action. Auto-sync can be turned off per bot from the Connections page, and numeric ids (`-100…`) as well as public `@usernames` are supported. Modules without any matching connection show an inline notice linking straight to the Connections page while still allowing manual id entry.

### Group File Search

Indexes every file shared in the module's target groups (documents, videos, audio, photos with captions — filename plus caption, Turkish-folded so "basvuru" finds "Başvuru Formu.pdf"). When a member asks a question like "X var mı?", "kimde var?", "yok mu?", or "does anyone have X?", the bot replies to their message, mentions them, and lists the matching files as t.me message links (newest first, capped by a per-chat max-results setting). `/ara <query>` and `/find <query>` search the index explicitly, per-user and per-chat cooldowns keep the group quiet, and additional trigger regexes can be configured per chat for other languages. The module page lists the whole index with a free-text filter, links back to the original messages, and supports pruning stale rows.

> **Group privacy note:** the bot only sees member messages when it is a group administrator or privacy mode is disabled via BotFather. The Bot API exposes no message history, so the index starts filling from the moment the module is enabled — earlier files cannot be searched. In basic (non-supergroup) groups message links do not exist; the bot re-sends the matched file itself as the reply.

**Retroactive indexing (backfill):** the Bot API cannot read history, but the studio can index it through a connected Telegram account. Connections → *Scan Accounts* manages one or more MTProto accounts per bot (login wizard: optional api_id/api_hash from my.telegram.org, phone, code, 2FA; the session is stored AES-GCM encrypted and used only to read the histories you pick). From the module page, choose an account, a target chat and a depth (last 1,000/5,000/10,000 or the entire history) — the paced scan upserts every media message into the same index with real message ids, is flood-wait aware, cancellable, and safe to re-run (no duplicates). GramJS (`telegram`) runs under Bun.

### Message Score & Leaderboard

Scores member activity in every group the bot operates in (messages, replies to others, and media, each with a configurable weight) and ranks the most active members per period (today, 7 days, 30 days, all time). The rich message composer selects one or many target chats, defines header, per-member row template, and footer with placeholders (`{rank}`, `{medal}`, `{mention}`, `{score}`, `{messages}`, `{group_name}`, ...), parse mode, medal emojis, and silent delivery — with a server-rendered live preview. Postings can be sent instantly or automated through schedules (once, hourly, daily, weekly in UTC) managed from the module page.

> **Group privacy note:** Telegram hides regular member messages from bots unless the bot is a group administrator or bot privacy mode is disabled via BotFather. Enable one of the two so the module can score activity.

### Group Moderation Suite

Beyond automated moderation, the studio bundles a full in-group admin toolkit: ban/mute/kick command families with timed, delete and silent variants, persistent warnings with configurable limits, purge commands, fine-grained content locks (45+ types with allowlists and script/script-language filters), AntiRaid join-storm defense, per-group rules and reply language, user reports with approvals, forum topic management, message cleaning, and ban federations whose ban lists are enforced across every group of every studio bot. All actions can stream to an Admin Log Channel for a full audit trail.

### Visual Builders & Zero Raw JSON Experience

- **Visual Button Builder**: Build Telegram inline keyboards visually with drag/add row and button controls (URL, Callback, WebApp, Copy Text) and real-time Telegram button rendering.
- **Visual Drip Sequence Builder**: Build onboarding and sales drip campaigns with interactive timelines and quick delay chips (`+15m`, `+1h`, `+24h`, `+3d`).
- **Visual Mini App Configurator**: Configure E-Commerce catalogs, Custom Forms, Spin-to-Win wheels, and Loyalty tiers without writing raw JSON.
- **Quick Datetime Helpers**: One-click scheduling chips (`+1h`, `+24h`, `+7d`) across scheduling forms.

### Smarter AI Engine with RAG & Multimodal Voice

- **RAG Knowledge Base**: Upload custom company documents, FAQs, and policies with keyword/semantic indexing and an interactive search testing sandbox.
- **Multimodal Voice Support**: Automatic voice note transcription powered by OpenAI Whisper STT.
- **Persistent SQLite Conversation Memory**: Long-term contextual memory per user stored directly in SQLite.
- **Smart Human Handoff**: Automatic detection of frustration/support requests to route queries to live agents.

### In-Studio Bot Sandbox Simulator

Test commands (`/start`, `/help`, etc.), interactive inline buttons, and AI assistant answers live in a Telegram-like sandbox drawer right inside the management studio without needing your phone.

### Bot Diagnostics & 1-Click Starter Presets

- **Diagnostics Inspector**: Instant health check verifying Telegram Bot API token validity, pool runtime status, Group Privacy Mode, and connected chats.
- **1-Click Starter Presets**: Provision curated bundles for **E-Commerce**, **Community & Moderation**, **Customer Support**, or **Growth & Marketing** during bot creation or anytime from the dashboard.

### Real Two-Way Web Support Desk with AI Copilot

Manage and reply to customer tickets directly from the web dashboard. Features canned replies and an AI Copilot that drafts contextual answers based on conversation history.

## Documentation

- Placeholder dictionary (`{first_name}`, `{user_id}`, `{mention}`, `{group_name}`, ...) is available inside every module's help dialog with one-click copy.
- Telegram rate limit guidance (429 backoff) and required bot permissions are documented per module in the dashboard.
- Four interface languages (English, Turkish, German, Russian) switchable instantly from the top navigation bar; bots themselves reply in any of 14 languages, settable per group.
- API reference lives at `/api/docs` (OpenAPI/Swagger UI) on any running instance.

> **Manifest note:** frontend libraries (React, MUI, i18next, …) are intentionally declared in `devDependencies` — Vite bundles them into `dist/client`, and the Docker runner's `bun install --production` correctly excludes them, keeping the runtime image small. Do not import them from server code; it would build locally and crash in the container. Dependabot keeps both npm and GitHub Actions dependencies fresh (weekly, grouped minor/patch).
