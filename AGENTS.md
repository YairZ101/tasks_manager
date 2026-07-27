# AGENTS.md

## What This Is

Flow is a local-first task manager that delegates work to configurable CLI agents. Users create Tasks, design versioned Flows on a node canvas, and start Runs. A persistent scheduler executes Agent and Check blocks, pauses at Decision blocks, and finishes through explicit Result blocks. SQLite data lives in `.flow/` in the repository root.

The supported V1 blocks are **Begin, Agent, Check, Decision, Result, and Note**. Runtime state belongs to Runs and Attempts, never to canvas columns. The work UI uses five fixed operational views: **Backlog, Ready, Active, Needs Attention, and Finished**.

## Commands

```bash
bun install
bun run dev
bun --watch packages/backend/src/index.ts
cd packages/frontend && bun run dev

bun run test
cd packages/flow-core && bun test
cd packages/backend && bun test
cd packages/frontend && bun run test
cd packages/frontend && bunx tsc --noEmit
bun run build

cd packages/backend && bun test src/flow/engine.test.ts
cd packages/frontend && bunx vitest run src/components/FlowEditor.test.tsx
```

## Architecture

```
packages/
├── flow-core/       Shared, pure TypeScript Flow contract
│   └── src/
│       ├── types.ts       Typed block/config/connection definitions
│       ├── catalog.ts     Agent presets and stable prompt compilation inputs
│       ├── validation.ts  Graph invariants and cycle validation
│       ├── compiler.ts    Immutable published execution definition
│       └── defaults.ts    Minimal and recommended Flow templates
├── backend/         Bun + Hono + SQLite
│   └── src/
│       ├── app.ts         Hono app and route mounting (safe to import in tests)
│       ├── index.ts       Process lifecycle, lock, recovery, scheduler, static UI
│       ├── db/database.ts Greenfield `flow` schema; migrates the previous schema-family label and rejects legacy DBs
│       ├── flow/
│       │   ├── engine.ts      Persistent scheduler and block execution
│       │   ├── repository.ts  Parsed Flow and derived Task queries
│       │   ├── events.ts      Persist-then-publish event helper
│       │   └── workspaces.ts  Task-scoped worktree lifecycle and dirty checks
│       ├── agents/cli-adapter.ts  Detached CLI execution
│       ├── sse/broadcaster.ts    Persisted Last-Event-ID replay
│       └── routes/           Tasks, Flows, Runs, Attempts, Workspaces, config, init
└── frontend/        React 19 + Vite + Zustand + @xyflow/react
    └── src/
        ├── App.tsx                 Application shell and operational navigation
        ├── domain.ts               Frontend API types
        ├── hooks/useTaskStore.ts   App state and parallel bootstrap
        ├── hooks/useEventSource.ts Persisted event refresh handling
        └── components/
            ├── WorkBoard.tsx       Five fixed operational views
            ├── TaskPanel.tsx       Run timeline, Decisions, logs, cleanup actions
            ├── FlowLibrary.tsx     Version/default overview
            └── FlowEditor.tsx      Typed drag/drop graph, inspector, validation
```

## Core Semantics

- **Task**: desired outcome and queue placement. `queue_state` is `backlog` or `ready`; `resolution` is `open`, `completed`, or `cancelled`.
- **Flow**: stable identity with one default Flow and an active immutable published version.
- **Flow version**: a mutable draft guarded by `draft_revision`, or a compiled immutable published snapshot.
- **Run**: one traversal of one published Flow version for one Task. Only one active Run may exist per Task.
- **Attempt**: one entry into one executable block. Feedback loops create new Attempts; old Attempts are never overwritten.
- **Decision**: the only block that may bound a cycle. Resolving it is compare-and-set and idempotent for an identical retry.
- **Result**: explicit terminal meaning—`completed`, `paused`, or `cancelled`.
- **Workspace**: task-scoped and reused across Attempts/Runs. Clean completed worktrees are removed; dirty, paused, failed, or stopped work is retained.

## Runtime and Data Flow

1. REST mutation commits to SQLite.
2. `emitEvent()` inserts the event and then publishes the same database ID over SSE.
3. The frontend refreshes affected entities. Reconnects replay up to the last 1,000 persisted events; older cursors receive `stale`.
4. `startRun()` pins a published version, creates/reuses the Task Workspace, records Begin, and queues the first executable Attempt.
5. `pumpQueue()` claims persisted queued Attempts into one shared Agent/Check capacity pool. Non-Git projects are limited to one execution.
6. Agent and Check output is sanitized, buffered for 50ms, inserted into `logs`, and streamed as `attempt:log`.
7. Startup marks any `running` Attempt `interrupted`, moves its Run to `attention`, and resumes still-queued work.

## Important Constraints and Edge Cases

- CLI-only agent execution; there is no LLM HTTP adapter.
- Backend imports use `.js` extensions even though source files are TypeScript.
- The backend is validated by Bun tests; frontend TypeScript is checked with `bunx tsc --noEmit`.
- Check commands use argv parsing and reject shell operators. Their working directory must resolve inside the Workspace.
- Every automatic graph cycle is rejected unless it passes through a Decision.
- Notes cannot be connected. Begin has no inputs. Result has no outputs. One outcome cannot fan out to multiple targets in V1.
- Operational Task state is derived from Task resolution plus its active Run; it is not persisted as a draggable status.
- Stopping a Run persists `stopped` before aborting its OS process so late completion cannot overwrite user intent.
- Task deletion is blocked for active Runs. Dirty Workspace deletion needs an explicit force confirmation.
- A legacy database without `app_meta.schema_family = flow` is rejected and never modified. Move `.flow/tasks.db`, `-wal`, and `-shm` aside to initialize this version.
- `.flow/` self-ignores via its own `.gitignore`.

## Testing Patterns

Every behavior change must include tests in the same change.

### Backend

- Use `bun:test`; keep tests co-located.
- Create a temp repository root with `fs.mkdtempSync`, call `initDb`, and always `closeDb` plus recursive cleanup.
- Route tests use `createApp(root).request()` without opening a port.
- Engine tests must call `initEngine(root)` and `await shutdownEngine()` before closing the database.
- Seed a published, compiled Flow version before starting a Run.
- Prefer short real child processes for scheduler tests and assert persisted Run/Attempt/log state.

### Frontend

- Vitest + happy-dom + React Testing Library; CSS is disabled in tests.
- Mock `../api/client.js` at the module boundary.
- Seed Zustand with `useAppStore.setState()`.
- Flow canvas tests have `ResizeObserver`/`DOMMatrixReadOnly` shims in `src/test/setup.ts`.

## Styling

- Tailwind CSS v4 is available, but the product shell and canvas styling live in `index.css`.
- Dark control-room visual language: ink surfaces, mint operational accent, blue running state, amber attention, red danger.
- Plus Jakarta Sans for interface text and JetBrains Mono for IDs, state, commands, and logs.
- Inline SVG icons only. The Flow editor is lazy-loaded because `@xyflow/react` is the heaviest UI dependency.
- On small screens, operational views remain usable; Flow editing becomes an explicit read-only/wider-screen notice.

## API Surface

All routes return JSON except successful DELETE (`204`). Errors use `{ error, reason?, problems? }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Initialization, repo, scheduler capacity |
| GET | `/events` | SSE with persisted Last-Event-ID replay |
| GET/POST | `/tasks` | List/create Tasks; create may include `run: true` |
| GET/PATCH/DELETE | `/tasks/:id` | Read/edit/delete a Task |
| GET/POST | `/flows` | List/create Flows |
| GET | `/flows/:id` | Flow and version history |
| GET/PUT | `/flows/:id/draft` | Create/read and revision-save the draft |
| POST | `/flows/:id/publish` | Validate, compile, and publish |
| POST | `/flows/:id/default` | Set the default published Flow |
| GET/POST | `/runs` | List/start Runs |
| GET | `/runs/:id` | Run, Attempts, pinned Flow, Workspace |
| POST | `/runs/:id/stop` | Persist stop and cancel active execution |
| POST | `/runs/:id/retry` | Retry the latest block from attention |
| POST | `/runs/:id/decisions/:attemptId` | Resolve a waiting Decision |
| GET | `/attempts/:id` | Attempt with paginated logs |
| GET/DELETE | `/workspaces/:id` | Inspect or safely clean a Workspace |
| GET/PUT | `/agent-config` | CLI and shared concurrency settings |
| POST | `/agent-config/test` | Test CLI configuration |
| POST | `/init/save-prefix` | Initialize project plus recommended Flow |

## Dev Server Lifecycle

For Playwright/manual testing, start `bun run dev` in a saved background shell/session. When testing is complete, stop that shell **before doing anything else**. Then verify no `bun`, `vite`, or `concurrently` process survived and remove `.flow/.lock` only if stale.

## Planning Docs

Files in `doc/plans/` are append-only decision records. New decisions get new documents; superseded documents receive only a one-line banner. Once shipped, code is the source of truth. See [`doc/plans/README.md`](doc/plans/README.md).
