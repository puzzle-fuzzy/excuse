# Agent Guide (AGENTS.md / CLAUDE.md)

Shared guidance for AI coding assistants (Claude Code, Codex) working in this repository. `CLAUDE.md` is a symlink to this file so both tools read the same single source of truth.

## Project Overview

AI content generation platform ("让想象力拥有生产力") — Bun monorepo with React frontend, ElysiaJS backend, and a background task worker. All AI calls go through Alibaba DashScope (Qwen text/image, Wan/HappyHorse video). Includes a Canvas pipeline for automated story-to-video generation and a Subtitle pipeline for ASR-based subtitle burning.

## Common Commands

```bash
# Development (starts server :5007 + client :8007 + worker :5100 health)
bun run dev

# Individual dev servers
bun run dev:server    # apps/server — Elysia API
bun run dev:client    # apps/client — Vite React SPA
bun run dev:worker    # apps/worker — unified task poller + canvas pipeline driver

# Build
bun run build

# Typecheck (concurrently across server, client, worker)
bun run typecheck

# Testing
bun run test            # bun test across server, worker, and all packages
                          # (server suite runs in --isolate to avoid mock.module pollution)
bun run test:client     # vitest (client)
bun run test:all        # both
bun run test:db         # packages/db test-db script (needs PG)
bun run test:isolate    # bun test with --isolate flag
bun run test:coverage   # both with --coverage

# Run a single package's tests
bun test --cwd packages/workflow-engine
bun test --cwd apps/worker
# Server suite is mock.module-heavy, so it defaults to --isolate:
bun run --cwd apps/server test

# Run a single bun test file
bun test apps/server/test/auth-routes.test.ts
bun test packages/billing/test/calculate.test.ts
# Mixing multiple server files that call mock.module needs --isolate:
#   bun test --isolate apps/server/test/a.test.ts apps/server/test/b.test.ts

# Run a single vitest test (from apps/client)
cd apps/client && bun vitest src/__tests__/some.test.tsx

# Lint
bun run lint
bun run lint:fix

# Database (from packages/db)
cd packages/db
bun run db:generate     # generate migration from schema changes
bun run db:migrate      # run migrations (bun --env-file ../../.env src/migrate.ts)
bun run db:push         # push schema directly (dev only)
bun run db:studio       # Drizzle Studio GUI

# PostgreSQL (Docker)
docker compose up -d    # starts PG on host port 5433
```

**Important**: `packages/db` scripts use `bun --env-file ../../.env <file>` (not `bun run`). The `--env-file` flag only works when executing files directly, not with `bun run` subcommand. Root scripts that delegate to a workspace use `bun run --cwd <pkg> <script>`.

## Architecture

### Monorepo Layout

The repo is mid-refactor: a once-monolithic set of packages is being split into focused, mostly-**pure** packages. There are two layers — pure rule/logic packages (no DB/provider/app runtime deps) and runtime packages (own the IO). Apps wire the two together via adapters.

```
apps/
  client/   — React 19 + Vite + Tailwind CSS 4 + shadcn/ui (port 8007)
  server/   — ElysiaJS API (port 5007)
  worker/   — Unified task poller: claims tasks, drives Canvas pipeline, polls legacy video/ASR queues
packages/
  shared/          — Cross-app types + Pino logger singleton (BASE layer, no deps)
  db/              — Drizzle ORM schema + repositories + services (PostgreSQL 16)
  provider/        — DashScope client + model-configs + ASR client (legacy façade, re-exports storage/ffmpeg)
  storage/         — Aliyun OSS / local file storage (AssetStorage)
  ffmpeg/          — FFmpeg ops: audio extraction, subtitle burning, media probing
  billing/         — Cost calculation (token/image/video-second/audio) + statistics
  canvas-engine/   — Canvas domain logic: continuity, schema
  canvas-runtime/  — Canvas phase execution (phases/ dir) + LLM helpers + normalization
  prompt-engine/   — Prompt building + JSON extraction helpers
  task-engine/     — Pure: unified-task lifecycle (claim/lock/retry/failure) via *Adapter interfaces
  workflow-engine/ — Pure: Canvas phase-order + pipeline-run status + auto-advance rules
  events/          — Pure: SSE dispatch hub + PG NOTIFY payload parsing/mapping
  gateway/         — Pure: OpenAI-compatible request/response normalization
  metrics/         — Pure: MetricsCollector (status/latency percentiles)
  rate-limit/      — Pure: sliding-window limiter + 429 response builders
  subtitle-engine/ — Pure: subtitle style presets + ASS generation + ASR parsing
  auth/            — Pure: API-key hashing/creation/prefix detection (SHA-256)
```

**Dependency direction**: `shared` ← everything. Pure packages (`task-engine`, `workflow-engine`, `events`, `gateway`, `metrics`, `rate-limit`, `subtitle-engine`, `auth`) depend only on `shared` (and std-lib) — never on `db`, `provider`, server routes, or worker runtime. Runtime packages (`db`, `provider`, `storage`, `ffmpeg`, `billing`, `canvas-engine`, `canvas-runtime`, `prompt-engine`) may depend on `shared` and each other; apps sit on top.

### Key Architectural Patterns

**Adapter injection (the central pattern)** — Pure packages never touch IO. Instead they declare `*Adapter` interfaces (e.g. `TaskCompletionAdapter`, `CanvasPipelineTaskAdapter`, `GenerationNotifyDispatcherOptions.dispatchToUser`) and pure functions that receive an adapter (`completeTaskWithAdapter`, `createNextCanvasPipelineTask`, `applyTaskFailureWithAdapter`). The app implements the adapter with real DB/provider calls and passes it in. **Golden rule**: if you find yourself adding a `@excuse/db` or `@excuse/provider` import to `task-engine`/`workflow-engine`/`events`/`gateway`/`metrics`/`rate-limit`/`subtitle-engine`/`auth`, stop — the rule belongs in the pure package; the IO call belongs in the app-supplied adapter. See `docs/TODO.md` (§P4 "基础设施和通用能力治理") for the in-progress extraction roadmap.

**Unified task queue** — `tasks` table is the single async-execution layer (domains: `canvas`/`generate`/`subtitle`/`gateway`; types like `canvas.analyze`, `generate.video`). State machine: `queued → running → succeeded | failed | cancelled`, with a retry path `running → retrying → queued` (deferred by `nextRunAt`). Worker claims via `FOR UPDATE SKIP LOCKED` (`claimNextTask`), sets a `lockedBy`/`lockedUntil` lock, extends it via heartbeat, and orphan-sweeps tasks whose lock expired >5 min ago. All lifecycle decisions go through `@excuse/task-engine` (classify error → retry vs fail → compute backoff). Output/billing stays on `generation_records`; the task only owns execution lifecycle.

**Declarative model config** — All AI models are declared in `packages/provider/src/model-configs.ts` with their parameters, endpoints, input mappings, and pricing. Shared mapping fragments (`TEXT_MAPPING`, `IMAGE_MAPPING`, `VIDEO_T2V_MAPPING`, `VIDEO_MEDIA_MAPPING`) reduce repetition. `DashScopeClient` has zero model-specific branches — `applyMappings()` routes each param based on its `InputMapping` discriminated union (`prompt | parameter | media | mediaField | ignored`), then `buildRequestBody()` switches on `requestType` (`chat | openai-chat | image | video-t2v | video-media`) to shape the final payload. Adding a new model requires ONLY editing model-configs.ts.

**Type derivation chain** — Drizzle schema → `InferSelectModel` → `Serialize` (Date→string) → API types. Types flow one direction from DB schema to API, no duplication. Key domain types (`CostDetail`, `OutputResult`, `GenerationInputParams`, `CharacterProfile`, `ShotCamera`, `TaskInput`, `TaskOutput`, `TaskErrorInfo`, etc.) are in `packages/db/src/domain-types.ts` as pure interfaces with no runtime deps. Schema files use `$type<T>()` to attach domain types to JSONB columns.

**Eden treaty** — Client imports server `App` type via `@elysia/eden` for end-to-end type-safe API calls. `unwrapEden<T>()` helper in `apps/client/src/api/client.ts` extracts `data` from Eden's `{ data, error }` response and throws structured errors with 401/403 auto-cleanup. No separate API client definitions.

**Repository pattern** — DB access through exported async functions in `packages/db/src/repositories/*.repo.ts` (not classes). Every function calls `getDb()` → Drizzle query builder → returns nullable single record or array. `getDb()`/`setDb()` singleton for test injection.

**Factory routes** — Most route groups use `export function createXxxRoutes(config: ServerConfig)` returning a scoped `new Elysia({ prefix: '/api/xxx' })`. Simpler routes (health, models) export a plain `new Elysia()`. Each route file receives `ServerConfig` explicitly rather than reading process.env, enabling test injection.

**Auth dual-channel** — Two auth plugins in `apps/server/src/plugins/auth.ts`: `createAuthPlugin` (nullable userId, for mixed public/protected routes) and `createRequireAuthPlugin` (resolve-mode 401 guard, for fully protected routes). Auth priority: httpOnly cookie → JWT, `exc_` prefix → API Key hash lookup (`@excuse/auth`), other Bearer → JWT verify. Auth is applied per-route-group (not globally) to propagate Elysia's `derive` types.

**Canvas worker-driven pipeline** — 9 phases in `CANVAS_PHASE_ORDER` (`analyze → characters → locations → characterRefs → locationRefs → storyboard → continuity → rebuild → videos`). Each phase is a `tasks` row of type `canvas.<phase>` linked to a `canvas_pipeline_runs` row. Pipeline endpoints use `fireAndForget` — immediately return `{ accepted: true, runId }`. On task success the worker's `pipeline-stepper.ts` calls `@excuse/workflow-engine` (`decideCanvasAutoAdvance` + `canAdvanceToPhase`) to create the next phase task, **unless** `autoProgress=false` or the next phase is a pause-before gate (`storyboard`, `videos`) which need user confirmation. Concurrency guard via `filterActivePipelineRuns` prevents duplicate phase runs. Non-pipeline canvas operations (PATCH/DELETE sub-resources, layout, model-preferences) return `{ success: true }` synchronously.

**Subtitle pipeline** — ASR-based subtitle generation: upload video → extract audio → transcribe via DashScope ASR (`ASRClient`) → parse to `SubtitleSentence[]` (`@excuse/subtitle-engine`) → render ASS → burn via `@excuse/ffmpeg`. Route group at `/api/subtitle` with its own state machine. Worker handles ASR polling and subtitle export via `subtitle-processor.ts`.

**Provider façade** — `@excuse/provider` still re-exports `storage` and `ffmpeg` (thin shim files: `provider/src/storage.ts`, `subtitle-burner.ts`, `audio-extractor.ts`) for backward compatibility. Prefer importing from `@excuse/storage` / `@excuse/ffmpeg` directly in new code.

**SSE via PostgreSQL LISTEN/NOTIFY** — Worker updates DB → `pgClient.notify()` → Server's `startSSEListener()` receives → dispatchers from `@excuse/events` map NOTIFY payloads (`generation_status`, `notification` channels) to SSE events → `UserEventHub.dispatchToUser()` pushes to in-memory SSE connections → client receives. 30-second heartbeat. Client `SSEClient` class in `apps/client/src/api/sse.ts` uses `@microsoft/fetch-event-source` (not native EventSource, to support custom headers like Bearer token). Typed event handlers via `on<K extends keyof SSEEventMap>()`. Error hierarchy: `RetriableError` (5xx, reconnects), `FatalError` (4xx non-auth), `UnauthorizedError` (401/403, stops reconnect + clears auth).

### Server Route Structure

All routes are under `/api`, mounted in `apps/server/src/index.ts`:

- `/api/auth/*` — register, login, me (JWT via `@elysia/jwt`, bcrypt via `Bun.password`)
- `/api/api-keys/*` — API key CRUD (bearer auth)
- `/api/health` — health check
- `/api/models` — list supported models
- `/api/canvas/*` — Canvas CRUD + pipeline endpoints + PATCH/DELETE sub-resources
- `/api/generate` — submit generation task (text/image/video)
- `/api/records/*` — CRUD for generation records + retry/cancel
- `/api/upload` — multipart file upload + delete
- `/api/subtitle/*` — subtitle pipeline (upload, transcribe, burn)
- `/api/notifications/*` — notification CRUD
- `/api/sse` — SSE event stream
- `/api/billing/statistics` — cost stats
- `/api/openai/*` — OpenAI-compatible gateway (chat completions, normalized via `@excuse/gateway`)
- `/api/docs` + `/api/swagger` — Swagger UI

Server internals: domain logic in `src/modules/{canvas,generation,subtitle}/`, cross-cutting services in `src/services/{audit,metrics,sse-manager}.ts`, middleware in `src/plugins/`, helpers in `src/utils/`. Global plugins (applied before routes): OpenAPI + Swagger, `loggerPlugin`, `requestIdPlugin`, `rateLimitPlugin` (`@excuse/rate-limit`), CORS, static file serving for uploads. `export type App = typeof app` exported for Eden treaty type inference.

### Worker Structure (`apps/worker/src`)

Single poll loop (`index.ts`) runs four workloads each cycle:
1. **Unified task queue** — `claimNextTaskWithAdapter` → `handleTask` (dispatches by `task.type`, incl. all `canvas.*` phase handlers in `canvas-handlers.ts`/`canvas-execution.ts`) → `completeTaskWithAdapter` → `advancePipelineAfterTaskSuccess` (workflow-engine auto-advance). Failures route through `handleTaskError` → task-engine retry/fail decision.
2. **Legacy video polling** — `pollPendingVideoTasks()` → `task-processor.ts` (DashScope async video tasks, `generation_records`).
3. **ASR subtitle polling** — `pollPendingASRProjects()` → `processASRTask`.
4. **Subtitle export polling** — `pollExportingProjects()` → `processExportTask`.

Plus: `startTaskHeartbeat` (extend lock), `runOrphanSweep` (recover dead-locked tasks, 5-min grace), graceful shutdown on SIGINT/SIGTERM (waits for current task up to 30s), health server on `WORKER_HEALTH_PORT` (default 5100).

### Database

Schema files in `packages/db/src/schema/`, barrel-exported from `index.ts`. Repositories in `src/repositories/*.repo.ts`, services in `src/services/`.

| Table | Purpose |
|-------|---------|
| `accounts` | Users with username, email, hashed password, avatar, isActive |
| `generation_records` | AI generation tasks with JSONB `inputParams`/`outputResult`/`cost`, deduplication by `dedupeKey` (text, no length limit), `totalPriceCents` integer for SQL aggregation, `traceId` for cross-service correlation |
| `tasks` | Unified async task queue — `type`/`domain`/`priority`, claim lock (`lockedBy`/`lockedUntil`), retry (`attempts`/`maxAttempts`/`nextRunAt`), `errorJson` (`TaskErrorInfo`). Links to `generation_records` and `canvas_pipeline_runs` |
| `canvas_projects` | Canvas projects with status enum, JSONB analysis/layout/modelPreferences, soft delete via `isDeleted` |
| `canvas_characters` / `canvas_locations` / `canvas_shots` / `canvas_continuity` | Extracted canvas sub-resources |
| `canvas_pipeline_runs` | Pipeline execution tracking (phase, status, timing, `taskId` link) |
| `canvas_assets` | Canvas asset lifecycle (references, generated media) |
| `subtitle_projects` | Subtitle pipeline tasks with status enum |
| `uploaded_files` | File upload tracking with purpose enum |
| `workflows` + `workflow_steps` | Workflow templates (not yet active) |
| `credit_accounts` + `credit_transactions` + `usage_events` | Credit/billing system |
| `notifications` | User notifications |
| `api_keys` | API key management (hashed) |
| `audit_logs` | Audit trail |

Uses pgEnum for `category` (text/image/video/subtitle), generation `status` (pending/submitting/processing/saving_output/succeeded/failed/cancelled), task `status` (queued/running/retrying/succeeded/failed/cancelled), task `domain`, and canvas-specific statuses. Drizzle config at `packages/db/drizzle.config.ts` defaults to `localhost:5433`.

### Billing

Cents-based arithmetic with `currency.js` (`precision: 4`). `totalPriceCents` (integer) is the authoritative value; `totalPrice` (yuan) is derived display. Four calculation units:
- **Token**: inputTokens × price/1M + outputTokens × price/1M
- **Image**: count × price (respects `params.n`)
- **Video**: duration × price (720P vs 1080P by `params.resolution`)
- **Audio**: duration × price (for ASR subtitle costs)

`aggregateStatistics()` computes total/today/week/month costs, breakdown by category and model, 30-day daily trend.

### Client Structure

React Router v6 routes: `/login`, `/register`, `/` (Workspace), `/canvas`, `/canvas/:projectId` (CanvasEditor), `/subtitle`, `/subtitle/:id`, `/assets`, `/billing`. All authenticated routes wrapped in `ProtectedRoute` guard. SSE connection established on mount when token exists.

Uses React Compiler (`@rolldown/plugin-babel`) for automatic memoization. Vite proxy forwards `/api` to `localhost:5007`.

**State management** — Zustand stores:
- `useWorkspaceStore` — model selection, parameter editing, generation submission. Auto-selects first model on category change.
- `useGenerationStore` — record list, SSE-driven updates
- `useRealtimeSync` — SSE event routing, project version counters for Canvas refresh, phase completion signals
- `useSubtitleStore` — subtitle project management

**Token storage** — Auth token stored in memory only (not localStorage). Browser API requests use httpOnly cookie auth; SSE uses Bearer header.

### Environment

Required env vars: `DATABASE_URL`, `DASHSCOPE_API_KEY`, `JWT_SECRET`. Optional: `OSS_*` for Aliyun OSS (falls back to local filesystem), `PORT` (default 5007), `FRONTEND_URL`, `WORKER_POLL_INTERVAL_MS`, `WORKER_STALE_TIMEOUT_MS`, `WORKER_HEALTH_PORT` (default 5100), `LOG_LEVEL`, `VITE_API_BASE_URL`, `JWT_EXPIRES_IN`. See `.env.example` for full template.

## Conventions

- **Runtime**: Bun everywhere (package manager, test runner, script execution)
- **Linting**: `@antfu/eslint-config` with React + TypeScript — handles formatting (no Prettier)
- **TypeScript**: Strict mode, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`
- **Logging**: Pino with redaction for sensitive fields. Use the shared logger from `@excuse/shared`.
- **Client API calls**: Use Eden treaty instance from `src/api/client.ts` — never hand-write fetch calls.
- **Client components**: shadcn/ui (Radix primitives). Tailwind CSS v4. Path alias `@/*` → `./src/*`.
- **Pure-package discipline**: Rule packages must not import `@excuse/db`/`@excuse/provider`/apps. Move IO behind an adapter interface and inject it from the app. When extracting a new rule, keep `docs/TODO.md` in sync (the active extraction roadmap lives in §P4).
- **Server test helpers** — `apps/server/test/helpers/test-factory.ts` provides `makeAccount`, `makeRecord`, `makeFailedRecord`, `makeTestConfig`, `makeValidatedParams` (branded type bypass), `signTestToken`, `extractEdenError`. Mock `@excuse/db` via `mock.module()` (Bun auto-hoists before imports). Test against minimal Elysia instances via `treaty<App>()`.
- **Pure-package tests**: No DB/IO mocking needed — pass a fake adapter or in-memory fixture directly to the function under test.
- **Worker tests**: Accept `deps` override (`TaskProcessorDeps` interface) for dependency injection.
- **DB tests**: Use transaction-scoped Drizzle instances with `setDb()` injection.
- **Client tests**: Vitest with jsdom + @testing-library/react + @testing-library/user-event.
- **DrizzleQueryError**: When Drizzle ORM queries fail, the error message only shows SQL + params. The actual PostgreSQL error is in `error.cause` (e.g. `cause.code` for PG error codes like `23505` unique constraint). Always check `cause` for the real error.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs typecheck + lint + test (with PG service container) + client-test across 4 jobs.
