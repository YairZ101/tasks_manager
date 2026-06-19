# AGENTS.md

## What This Is

A Kanban-style task manager that delegates work to AI agents. The backend runs tasks by spawning configurable CLI agent tools (Crush, Claude Code, Aider, Codex, etc.), streams their output via SSE to a React frontend that shows a board with drag-and-drop. Tasks move through a user-configurable workflow of steps, each running the agent with step-specific prompts. Data lives in a SQLite database inside `.tasks_manager/` in the repo root.

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
│       ├── executor/executor.ts   Agent execution with concurrency via Map<taskId, RunState>, worktree support
│       ├── worktree/worktree.ts   Git worktree create/remove/prune for parallel agent isolation
│       ├── workflow/
│       │   ├── step-catalog.ts    Predefined step catalog (Planning, Development, Visual QA, Open PRs)
│       │   ├── step-config.ts     Step-specific prompt instructions and config rendering
│       │   └── workflow-utils.ts  Status validation, step lookups, review file cleanup
│       ├── agents/            CLI adapter (spawns external agent tools)
│       ├── sse/broadcaster.ts SSE with ring buffer (1000 events), Last-Event-ID replay
│       ├── routes/            Hono route modules (tasks, logs, agent-config, agent-control, workflow-steps, init)
│       ├── lock.ts            PID-based single-instance lock (.tasks_manager/.lock)
│       ├── recovery.ts        Crash recovery — kills orphaned agent processes on startup
│       └── types.ts           Shared TypeScript interfaces
└── frontend/       React 19 + Vite + Tailwind CSS v4 + Zustand
    └── src/
        ├── App.tsx            Root component, SSE toast listener, multi-tab detection
        ├── api/client.ts      Thin fetch wrapper, all API calls
        ├── workflow/step-catalog.ts  Predefined step catalog (duplicated from backend)
        ├── hooks/
        │   ├── useTaskStore.ts    Zustand store (single global store for all app state)
        │   └── useEventSource.ts  SSE connection, event dispatching to store + log callbacks
        └── components/
            ├── Board.tsx          Dynamic columns from workflow steps
            ├── Backlog.tsx        Backlog panel with search
            ├── TaskDetail.tsx     Task detail panel with action buttons and log viewer
            ├── WorkflowEditor.tsx Shared workflow step editor (drag-and-drop, review toggle, config)
            ├── WorkflowSettingsModal.tsx  Workflow settings modal (uses WorkflowEditor)
            ├── InitWizard.tsx     4-step init wizard (agent, test, prefix, workflow)
            └── ...                Column, TaskCard, Sidebar, modals
```

### Data Flow

1. Frontend calls REST API → backend route handler → SQLite
2. Backend broadcasts change over SSE (`task:updated`, `agent:status`, `task:log`, `toast`, `workflow:updated`)
3. Frontend `useEventSource` hook receives SSE → updates Zustand store or dispatches `CustomEvent`
4. Agent execution: `startAgent()` checks concurrency → spawns CLI process → streams output via `onOutput` callback → buffered batch-insert to `task_logs` table + SSE broadcast per line

### Workflow System

Tasks move through a configurable workflow: **Todo → [workflow steps] → Done**. Todo and Done are fixed. The steps in between come from a predefined catalog and are configured per project during init or via the Workflow Settings modal.

Each workflow step:
- Runs the agent with step-specific prompt instructions (defined in `step-config.ts`)
- Has a `requires_review` toggle — if on, the task pauses after the agent finishes for human approval; if off, the task auto-advances to the next step
- Can have per-step config options (e.g., Planning has `planLocation` and `trackInGit`)

The predefined catalog (`step-catalog.ts`):
- **Planning** (`requires_review: true`) — agent creates a plan, doesn't write code
- **Development** (`requires_review: false`) — agent implements the task
- **Visual QA** (`requires_review: true`) — agent tests the UI visually
- **Open PRs** (`requires_review: false`) — agent commits and opens a PR

Steps that don't touch git (Planning, Development, Visual QA) explicitly tell the agent not to run git commands. Only the Open PRs step handles committing and PR creation. The Open PRs step collects cross-step config (e.g., if Planning's `trackInGit` is false, it tells the agent to exclude the plan file from commits).

Auto-advance chaining: when a step with `requires_review: false` completes, the executor automatically starts the agent on the next step. The chain stops at a step with `requires_review: true` or at Done. Chaining happens after the `finally` block frees the concurrency slot to avoid deadlocks.

### Key Constraints

- **CLI-only agent execution**: The system only supports CLI-based agents (tools like Crush, Claude Code, Aider, Codex). There is no API/LLM adapter — the configured CLI tool is expected to be a full autonomous agent that can read/write files and run commands.
- **Concurrent agent execution via worktrees**: Multiple agents can run simultaneously (up to `max_concurrent_agents` from `agent_config`, default 3) when in a git repository. Each agent gets its own git worktree at `.tasks_manager/worktrees/<task-key>` on branch `agent/<task-key>`. In non-git repos, falls back to single-agent mode.
- **Persistent worktrees across steps**: Worktrees are shared across workflow steps for the same task. Each step works in the same worktree, accumulating changes. The worktree is only cleaned up when the task reaches `done`, is deleted, or is moved back to `todo`/`backlog`. `createWorktree` is idempotent — if a valid worktree already exists, it's reused.
- **Concurrency tracking**: The executor uses a `Map<number, RunState>` keyed by task ID instead of a global mutex. `getRunnerState()` returns the active count, max concurrent limit, and list of active runs.
- **Detached process groups**: CLI adapter spawns with `detached: true` and kills via process group (`-pid`) for clean tree termination.
- **Buffered log writes**: Agent output is batched in a buffer and flushed every 50ms to avoid per-line SQLite transactions. The buffer is force-flushed when the agent completes or fails.
- **SSE ring buffer**: The broadcaster keeps the last 1000 events. Clients that reconnect with `Last-Event-ID` get replay; if their ID is too old, they receive a `stale` event triggering a full task refetch.

## Gotchas

- **`.js` extension in imports**: All backend TypeScript imports use `.js` extensions (`import { getDb } from './db/database.js'`). This is required by Bun's module resolution with `"type": "module"`. Frontend imports also use `.js` but Vite handles them transparently.
- **Backend has no typecheck command**: The backend `tsconfig.json` has `"types": ["bun"]` and no `"noEmit"` — it's not designed for standalone `tsc --noEmit`. CI only typechecks the frontend. Backend correctness relies on `bun test`.
- **Some executor tests skip in CI**: Tests that spawn real processes (`sleep`, timing-dependent) use `(process.env.CI ? test.skip : test)` to avoid flakiness. Don't remove these guards.
- **Task status is a string, not an enum**: `tasks.status` stores step slugs (`'planning'`, `'development'`, etc.) plus fixed statuses (`'backlog'`, `'todo'`, `'done'`). Validation is at the app layer via `getValidStatuses()`, not a DB CHECK constraint.
- **Transition rules**: Can move to `backlog` only from `todo`. Moving to any workflow step starts the agent. Moving away from a workflow step while the agent is running triggers `cancelAgent()`. Moving to `todo` or `backlog` clears `agent_status`.
- **`requires_review` is user-configurable**: The catalog provides defaults, but users can toggle `requires_review` per step via the Workflow Settings modal.
- **`sort_order` uses floats**: Reordering inserts between existing items by averaging adjacent `sort_order` values. No rebalancing exists — long-lived boards could theoretically lose precision.
- **Frontend log viewer uses mutable refs**: `TaskDetail` stores logs in `useRef` (not `useState`) to avoid re-allocating on each SSE line. A `logVersion` counter triggers re-renders. The `buildLogRows()` function is the pure-logic core and is unit-tested separately.
- **SSE race condition handling**: Logs arriving via SSE before the initial `getTaskLogs` fetch resolves are buffered in `sseBufferRef`, then deduped against DB results by `run_number:message` key.
- **Error objects carry HTTP status**: Backend errors use `Object.assign(new Error(...), { status: 404 })` pattern. Route handlers check `err.status` to determine response code; default is 500.
- **`_deleted` sentinel**: When broadcasting task deletion, the backend sends `{ ...task, _deleted: true }`. The frontend checks this flag to remove from store vs update.
- **Single-row config tables**: Both `agent_config` and `project_config` use `CHECK (id = 1)` — they're singleton rows, always accessed with `WHERE id = 1`. The `agent_config` table still has legacy API-related columns in the DB schema (from a removed feature) but they are unused — the application only reads/writes CLI fields.
- **`.tasks_manager/` self-ignores**: `initDataDir()` creates a `.gitignore` containing `*` inside the data directory, so it never needs to touch the repo's root `.gitignore`.
- **Workflow step tests need DB setup**: Tests that call `getStepInstructions('open-prs')` or any function touching `workflow_steps` need a database initialized. Test `beforeEach` blocks must seed `workflow_steps` rows.
- **Step-specific prompts throw on unknown slugs**: `getStepInstructions()` throws if the slug isn't in its switch-case. When adding new steps to the catalog, add a corresponding case.
- **Vite proxy**: The frontend dev server proxies `/workflow-steps` (and other API paths) to the backend. If you add new route paths, add them to `vite.config.ts` proxy config.
- **Init requires workflow steps**: The `/status` endpoint returns `initialized: true` only when both `project_config` exists AND at least one workflow step is in the DB. The init wizard's workflow step is the last step before the board loads.

## Testing Patterns

**Every code change must include corresponding test updates.** When adding a new feature, modifying behavior, or changing a component's props/API, write or update the relevant tests in the same step — not as a separate pass afterward. If a file has a co-located test file (e.g., `Board.tsx` → `Board.test.tsx`), check whether existing tests still cover the new behavior and add new tests for anything that changed.

### Backend (Bun test runner)
- Tests create temp directories with `fs.mkdtempSync`, init a fresh SQLite DB, and clean up in `afterEach`
- Route tests use Hono's `app.request()` — no HTTP server needed
- Executor tests need `ensureAllReleased()` in `afterEach` because `startAgent()` fires and forgets — the background promise must be awaited or cancelled
- Import from `bun:test` (`describe`, `test`, `expect`, `beforeEach`, `afterEach`)
- Test files are co-located with source files (e.g., `executor.test.ts` next to `executor.ts`)
- **Seed `workflow_steps`** in `beforeEach` for any test that calls `startAgent()` or touches workflow logic: `db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('development', 'Development', 0, '{}', 1.0)").run()`

### Frontend (Vitest + happy-dom + React Testing Library)
- Setup file imports `@testing-library/jest-dom/vitest` for DOM matchers
- `vi.mock('../api/client')` is the standard pattern for mocking the API layer
- Zustand store is manipulated directly via `useAppStore.setState()` in tests
- **Set `workflowSteps`** in store state when testing Board or TaskDetail: `useAppStore.setState({ workflowSteps: [...] })`
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
| GET    | `/status`                 | Check init state (requires project_config + workflow_steps) |
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
| GET    | `/workflow-steps`         | List active workflow steps                                |
| POST   | `/workflow-steps`         | Add a step from the catalog                               |
| PATCH  | `/workflow-steps/:id`     | Update step (sort_order, requires_review, config)         |
| DELETE | `/workflow-steps/:id`     | Remove step (with task relocation)                        |
| GET    | `/workflow-steps/catalog` | Full catalog with active flags                            |
| POST   | `/init/generate-prefix`   | Ask agent to generate a JIRA-style prefix                 |
| POST   | `/init/save-prefix`       | Save project prefix (one-time init)                       |

## Dev Server Lifecycle

When starting `bun run dev` for Playwright or manual testing, always use `run_in_background=true` and save the shell ID. When testing is done, call `job_kill` on that shell ID **before** doing anything else. Then verify with `ps aux | grep` that no `bun`, `vite`, or `concurrently` processes survived, and remove `.tasks_manager/.lock` if it's stale.

## CI

GitHub Actions with 4 jobs: `test-backend`, `test-frontend`, `typecheck` (frontend only), `build`. All use `bun install --frozen-lockfile`. Backend tests run with `--timeout 30000` and `CI=true` env var.

## Planning Docs (`doc/plans/`)

Design docs in `doc/plans/` are **append-only decision records**, not living documentation. Do **not** rewrite the substance of an existing plan to reflect a new decision — write a new doc that names what it supersedes, and mark the old one with a one-line "Superseded by …" banner while leaving its body intact. Once a feature ships, the code is the source of truth, not the plan. Full convention: [`doc/plans/README.md`](doc/plans/README.md).
