# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/); the project does not
use fixed semantic version tags yet.

### Added — Smart product (AI)
- **Semantic RAG**: knowledge documents are chunked and embedded through the
  OpenAI-compatible embeddings endpoint (`embeddingModel` config, keyword scoring
  as fallback); cosine retrieval with a similarity gate — nothing is injected
  when nothing matches (no more hallucinated context). `knowledgeTags` filters
  retrieval by doc tags; `showSources` appends grounded source titles to user
  replies; the RAG tester displays matched chunks with scores; a
  `docs/reindex` endpoint rebuilds the index. New `ai_knowledge_chunks` table.
- **Smart human handoff**: the fixed keyword list became an LLM intent
  classifier (`human` / `angry` / `no`, keyword fallback when disabled or on
  failure) with repeated-frustration escalation after the second angry turn.
  Open escalations surface in a dedicated "AI → Human queue" on the Support
  Desk with resolve action, visible even when the support module is off.
- **AI usage metrics**: prompt/completion tokens, latency and errors are stored
  per assistant turn; a `metrics` endpoint and dashboard chips show requests,
  errors, tokens and average latency for the trailing 7 days.
- **"✨ Create with AI"** in studio forms: autoresponder replies, drip step
  sequences, inline button keyboards, scheduler/broadcast message text, and a
  knowledge-base FAQ draft — generated server-side through the bot's own AI
  provider and dropped into the form for the operator to edit.

### Added — Product breadth
- **Telegram Stars checkout**: `POST /api/tma/:slug/checkout` verifies the cart
  against the server-side catalog, creates the order as `pending_payment` and
  returns a Stars invoice link; engine-level `pre_checkout_query` validation and
  `successful_payment` routing (via a decoupled payment events bus) transition
  orders to `paid` and fire the `order_paid` webhook; the E-Commerce Mini App
  opens the invoice and polls status. Order status lookup is initData-guarded
  per buyer. (VIP subscriptions already bill natively in Stars through
  Telegram subscription invite links.)
- **Analytics overview**: new `/api/bots/:id/analytics` endpoint aggregates
  ChatActivity into per-day message/reply/media series (7/30 days) with
  audience totals; the bot dashboard renders a dependency-free SVG chart.
- **Bot time zone**: bot-level IANA time zone (`GET/PATCH /api/bots/:id/settings`,
  dashboard selector) drives leaderboard schedules (daily/weekly wall-clock
  times, DST-correct); pure-stdlib tz helpers with a unit test suite.
- **Live data (SSE)**: `GET /api/bots/:id/support/stream` and
  `/api/bots/:id/broadcasts/stream` ping the dashboard instantly on changes
  (new support messages incl. escalations; broadcast queue/progress/cancel).
  JWT is accepted from the `access_token` query parameter for EventSource;
  clients reconnect with backoff, pause on hidden tabs, and keep slow polling
  as a backstop (4-5s loops relaxed to 15s).
- **Content template library**: bilingual drip sequences, autoresponder texts,
  and button layouts seedable from the CRUD forms ("Use template").
- **Button builder types**: visual builder now supports URL, Callback, Web App
  and Copy-text buttons with lossless round-trip (unknown properties preserved
  instead of silently dropped), Telegram limits validation (100 buttons,
  callback byte length, https-only web app URLs) and type-distinct previews.
  Callback buttons are simulatable in the sandbox (`simulator/callback`).

### Added — Comprehensible & easy (Phase 1)
- Full Turkish localization beyond the shell: the entire module registry (names,
  descriptions, field labels, column headers, 4-tab help documentation) and every
  dashboard page translate between English and Turkish (~700 keys per language).
  An i18n parity + registry-coverage test suite guards against missing keys in CI.
- First-run onboarding checklist (rotate master key → add bot → enable modules →
  sync connections → first simulator message), dismissible, with a visible
  warning when a starter preset fails during bot creation.
- Localized API errors: the error envelope carries a machine-readable `code`
  (status-derived, `VALIDATION_ERROR` for class-validator arrays, or explicit
  `StudioException` codes at ~25 throw sites); the dashboard maps codes to
  translated messages via `localizedErrorMessage`.
- Locale-aware date/number formatting (`Intl.DateTimeFormat`) across all tables;
  browser-language detection for first-run UI language.
- Subscriber picker (UserPicker) for VIP grants with search over the Audience CRM.
- Row reordering (↑/↓) for ordered CRUD resources (start menu items).
- "Test in simulator" shortcut on autoresponder rows; simulator auto-scroll,
  localized sandbox texts, and real-handler-chain simulation (see below).
- Search/sort/pagination via the shared DataTable on the generic CRUD tables,
  the webhook delivery log, and the VIP subscription table; busy states,
  success toasts and unsaved-changes guard on forms.

### Added — Operational robustness
- **Simulator on the real chain**: the sandbox no longer re-implements matching;
  it builds a grammY bot with a fake API transformer and runs every enabled
  module runtime — including welcome, moderation, giveaways and callback presses.
  A reserved tester user id keeps sandbox traffic out of real analytics paths.
- **Versioned Prisma migrations** (`prisma/migrations`) with `migrate deploy`
  wired into `bun run start` and the Docker entrypoint; `0_init` baselined and
  `1_rag_chunks_and_ai_metrics` applied.
- **Retention service**: periodic pruning of ai_chat_history (90d),
  support_messages (180d), security_logs (180d) and mini_app_orders (365d),
  configurable via `RETENTION_*_DAYS` env vars (0 disables a table).
- **Audit trail expansion**: bot delete and module enable/config changes now
  land in the security audit log alongside auth events (`AuditService`).
- **CORS is opt-in**: same-origin by default; `CORS_ORIGINS` allow-list for
  split deployments replaces the blanket `enableCors()`.
- **Bounded in-memory moderation state**: flood windows and strike counters are
  swept after 24h of inactivity (previously unbounded maps).

### Changed
- Docker image ships the Prisma CLI + migrations and applies pending migrations
  before boot.
- Client tsconfig excludes bun test files from the app typecheck.
- Simulator drawer input/buttons extended for callback data.

### Notes for upgraders
- If your `data/studio.sqlite` predates versioned migrations, run
  `bunx prisma migrate resolve --applied 0_init` once before `bun run start`.
- Semantic RAG requires an OpenAI-compatible embeddings endpoint; bots without
  one keep keyword retrieval automatically.
