# Telegram Bot & Mini App Management Studio

A self-hosted web application for managing multiple Telegram bots and Telegram Mini Apps (TMAs) from a single dashboard.

## Tech Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Backend   | NestJS 11, grammY (multi-bot long-polling pool), class-validator        |
| Database  | SQLite (`bun:sqlite`) with WAL mode at `data/studio.sqlite`             |
| Dashboard | React 19, Vite, Material UI v7, React Router v7, i18next (English & Turkish) |
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
bun run start    # serves everything on port 3000
```

## Docker Deployment

```bash
docker compose up -d --build
```

The container exposes port `3000`, persists SQLite data in the `./data` volume, and reports health via `GET /api/health`. Configure `ADMIN_MASTER_KEY` and `JWT_SECRET` in the environment before deploying publicly.

## Project Structure

```text
telegram-bot-studio/
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
        ├── bots/               # Bot CRUD and status
        ├── bot-engine/         # Multi-bot runtime pool and grammY dispatch
        └── modules/            # Isolated feature modules (20 toggleable)
```

## Module Catalog

| Category                  | Modules                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Directory & Content       | Chat Connections, Start Menu, Channel Post Scheduler                                                                                |
| Communication & CRM       | Support Desk (Livegram), Business Secretary, Drip Sequences, Broadcast Engine, Audience CRM                                          |
| Community & Moderation    | Welcome & Clean Chat, Captcha Gatekeeper, Anti-Spam Moderation, Giveaways, Referral Leaderboard, Quizzes & Polls, Reaction Analytics, Message Score & Activity Leaderboard |
| Automation & Monetization | AI Assistant, Custom Commands & Auto-Responder, Paid Media Paywall, VIP Subscriptions, Webhooks Hub                                  |

Every module ships with an integrated Documentation & Setup Guide dialog (Overview & Use Cases, Step-by-Step Setup, Placeholders Dictionary, Troubleshooting & Rate Limits) available from its dashboard page.

### Chat Connections

Register groups and channels once in the Connections module; every target-chat field across the studio (Scheduler, Support Desk, Giveaways, VIP Subscriptions, Paid Media, Webhooks) becomes a dropdown powered by that shared list. Chats the bot is added to are learned automatically — the engine records every group/channel the bot operates in and a 30-second auto-sync imports them into the address book (titles and usernames enriched via `getChat`), so the Connections list stays current without any manual action. Auto-sync can be turned off per bot from the Connections page, and numeric ids (`-100…`) as well as public `@usernames` are supported. Modules without any matching connection show an inline notice linking straight to the Connections page while still allowing manual id entry.

### Message Score & Activity Leaderboard

Scores member activity in every group the bot operates in (messages, replies to others, and media, each with a configurable weight) and ranks the most active members per period (today, 7 days, 30 days, all time). The rich message composer selects one or many target chats, defines header, per-member row template, and footer with placeholders (`{rank}`, `{medal}`, `{mention}`, `{score}`, `{messages}`, `{group_name}`, ...), parse mode, medal emojis, and silent delivery — with a server-rendered live preview. Postings can be sent instantly or automated through schedules (once, hourly, daily, weekly in UTC) managed from the module page.

> **Group privacy note:** Telegram hides regular member messages from bots unless the bot is a group administrator or bot privacy mode is disabled via BotFather. Enable one of the two so the module can score activity.

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
- Full bilingual interface (English & Turkish) switchable instantly from the top navigation bar.
