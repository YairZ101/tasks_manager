# AGENTS.md

## What This Is

A Kanban-style task manager that delegates work to AI agents. The backend runs tasks by spawning configurable CLI agent tools (Crush, Claude Code, Aider, Codex, etc.), streams their output via SSE to a React frontend that shows a board with drag-and-drop. Only one agent can run at a time (global mutex). Data lives in a SQLite database inside `.tasks_manager/` in the repo root.

## Commands

```bash
# Install
bun install

# Dev (backend + frontend concurrently)
bun run dev

# Backend only (hot-reload)
bun --watch packages/backend/src/index.ts

# Frontend only
cd packages/frontend && bun run dev

# Run all tests
bun run test

# Backend tests only
cd packages/backend && bun test

# Frontend tests only
cd packages/frontend && bun run test

# Typecheck (frontend only — backend uses bun:* types, no noEmit)
cd packages/frontend && bunx tsc --noEmit

# Build frontend for production
bun run build

# Run a single backend test file
cd packages/backend && bun test src/executor/executor.test.ts

# Run a single frontend test file
cd packages/frontend && bunx vitest run src/components/TaskDetail.test.tsx
```

## Architecture

```
packages/
├── backend/        Bun + Hono HTTP server, SQLite, SSE broadcaster
│   └── src/
│       ├── index.ts           Entry point — init sequence, route mounting, graceful shutdown
│       ├── db/database.ts     SQLite via bun:sqlite, migrations via PRAGMA user_version
│       ├── executor/executor.ts   Agent execution with global mutex, buffered log writes
│       ├── agents/            CLI adapter (spawns external agent tools)
│       ├── sse/broadcaster.ts SSE with ring buffer (1000 events), Last-Event-ID replay
│       ├── routes/            Hono route modules (tasks, logs, agent-config, agent-control, init)
│       ├── lock.ts            PID-based single-instance lock (.tasks_manager/.lock)
│       ├── recovery.ts        Crash recovery — kills orphaned agent processes on startup
│       └── types.ts           Shared TypeScript interfaces
└── frontend/       React 19 + Vite + Tailwind CSS v4 + Zustand
    └── src/
        ├── App.tsx            Root component, SSE toast listener, multi-tab detection
        ├── api/client.ts      Thin fetch wrapper, all API calls
        ├── hooks/
        │   ├── useTaskStore.ts    Zustand store (single global store for all app state)
        │   └── useEventSource.ts  SSE connection, event dispatching to store + log callbacks
        └── components/        Board, Backlog, TaskDetail (with virtualized log viewer), modals
```

### Data Flow

1. Frontend calls REST API → backend route handler → SQLite
2. Backend broadcasts change over SSE (`task:updated`, `agent:status`, `task:log`, `toast`)
3. Frontend `useEventSource` hook receives SSE → updates Zustand store or dispatches `CustomEvent`
4. Agent execution: `startAgent()` acquires mutex → spawns CLI process → streams output via `onOutput` callback → buffered batch-insert to `task_logs` table + SSE broadcast per line

### Key Constraints

- **CLI-only agent execution**: The system only supports CLI-based agents (tools like Crush, Claude Code, Aider, Codex). There is no API/LLM adapter — the configured CLI tool is expected to be a full autonomous agent that can read/write files and run commands.
- **Single agent mutex**: Only one agent runs at a time across the entire server. The mutex is an in-memory object in `executor.ts`, not DB-based. Concurrent start requests get HTTP 409.
- **Detached process groups**: CLI adapter spawns with `detached: true` and kills via process group (`-pid`) for clean tree termination.
- **Buffered log writes**: Agent output is batched in a buffer and flushed every 50ms to avoid per-line SQLite transactions. The buffer is force-flushed when the agent completes or fails.
- **SSE ring buffer**: The broadcaster keeps the last 1000 events. Clients that reconnect with `Last-Event-ID` get replay; if their ID is too old, they receive a `stale` event triggering a full task refetch.

## Gotchas

- **`.js` extension in imports**: All backend TypeScript imports use `.js` extensions (`import { getDb } from './db/database.js'`). This is required by Bun's module resolution with `"type": "module"`. Frontend imports also use `.js` but Vite handles them transparently.
- **Backend has no typecheck command**: The backend `tsconfig.json` has `"types": ["bun"]` and no `"noEmit"` — it's not designed for standalone `tsc --noEmit`. CI only typechecks the frontend. Backend correctness relies on `bun test`.
- **Some executor tests skip in CI**: Tests that spawn real processes (`sleep`, timing-dependent) use `(process.env.CI ? test.skip : test)` to avoid flakiness. Don't remove these guards.
- **Task status transitions are asymmetric**: Cannot move from `in-progress` or `done` back to `backlog` (HTTP 400). Moving to `in-progress` always triggers agent execution via `startAgent()`. Moving away from `in-progress` while an agent is running triggers `cancelAgent()`.
- **`sort_order` uses floats**: Reordering inserts between existing items by averaging adjacent `sort_order` values. No rebalancing exists — long-lived boards could theoretically lose precision.
- **Frontend log viewer uses mutable refs**: `TaskDetail` stores logs in `useRef` (not `useState`) to avoid re-allocating on each SSE line. A `logVersion` counter triggers re-renders. The `buildLogRows()` function is the pure-logic core and is unit-tested separately.
- **SSE race condition handling**: Logs arriving via SSE before the initial `getTaskLogs` fetch resolves are buffered in `sseBufferRef`, then deduped against DB results by `run_number:message` key.
- **Error objects carry HTTP status**: Backend errors use `Object.assign(new Error(...), { status: 404 })` pattern. Route handlers check `err.status` to determine response code; default is 500.
- **`_deleted` sentinel**: When broadcasting task deletion, the backend sends `{ ...task, _deleted: true }`. The frontend checks this flag to remove from store vs update.
- **Single-row config tables**: Both `agent_config` and `project_config` use `CHECK (id = 1)` — they're singleton rows, always accessed with `WHERE id = 1`. The `agent_config` table still has legacy API-related columns in the DB schema (from a removed feature) but they are unused — the application only reads/writes CLI fields.
- **`.tasks_manager/` self-ignores**: `initDataDir()` creates a `.gitignore` containing `*` inside the data directory, so it never needs to touch the repo's root `.gitignore`.

## Testing Patterns

### Backend (Bun test runner)
- Tests create temp directories with `fs.mkdtempSync`, init a fresh SQLite DB, and clean up in `afterEach`
- Route tests use Hono's `app.request()` — no HTTP server needed
- Executor tests need `ensureMutexReleased()` in `afterEach` because `startAgent()` fires and forgets — the background promise must be awaited or cancelled
- Import from `bun:test` (`describe`, `test`, `expect`, `beforeEach`, `afterEach`)
- Test files are co-located with source files (e.g., `executor.test.ts` next to `executor.ts`)

### Frontend (Vitest + happy-dom + React Testing Library)
- Setup file imports `@testing-library/jest-dom/vitest` for DOM matchers
- `vi.mock('../api/client')` is the standard pattern for mocking the API layer
- Zustand store is manipulated directly via `useAppStore.setState()` in tests
- Test files are co-located (e.g., `Board.test.tsx` next to `Board.tsx`)
- CSS is disabled in tests (`css: false` in vitest config)

## Styling

- Tailwind CSS v4 with the `@tailwindcss/vite` plugin (no `tailwind.config.js`)
- Custom design tokens defined in `index.css` under `@theme` — semantic color names (`bg`, `bg-raised`, `bg-card`, `text`, `text-muted`, `accent`, `danger`, `success`, `warning`, `running`)
- Fonts: Plus Jakarta Sans (body), JetBrains Mono (code/logs)
- Dark theme only
- Custom animations defined in `index.css`: `spin-slow`, `pulse-glow`, `slide-up`, `fade-in`, `slide-in-right`, `slide-out-right`
- Inline SVG icons throughout — no icon library

## API Surface

All routes return JSON. Status 204 for DELETE. Errors return `{ error: string }`.

| Method | Path                      | Purpose                                                   |
| ------ | ------------------------- | --------------------------------------------------------- |
| GET    | `/status`                 | Check init state, project config                          |
| GET    | `/events`                 | SSE stream (supports `Last-Event-ID`)                     |
| GET    | `/tasks`                  | List tasks (`?q=`, `?status=`)                            |
| POST   | `/tasks`                  | Create task (optional `run: true` for create-and-execute) |
| GET    | `/tasks/:id`              | Get single task                                           |
| PATCH  | `/tasks/:id`              | Update task fields / change status                        |
| DELETE | `/tasks/:id`              | Delete task (blocked while agent running)                 |
| GET    | `/tasks/:id/logs`         | Paginated logs (`?before_id=`, `?limit=`, `?run_number=`) |
| POST   | `/tasks/:id/agent/start`  | Start agent on task                                       |
| POST   | `/tasks/:id/agent/cancel` | Cancel running agent                                      |
| GET    | `/agent-config`           | Get agent configuration                                   |
| PUT    | `/agent-config`           | Update agent configuration                                |
| POST   | `/agent-config/test`      | Test agent config (30s timeout)                           |
| POST   | `/init/generate-prefix`   | Ask agent to generate a JIRA-style prefix                 |
| POST   | `/init/save-prefix`       | Save project prefix (one-time init)                       |

## CI

GitHub Actions with 4 jobs: `test-backend`, `test-frontend`, `typecheck` (frontend only), `build`. All use `bun install --frozen-lockfile`. Backend tests run with `--timeout 30000` and `CI=true` env var.
