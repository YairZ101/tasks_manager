# Tasks Manager — Architecture & Implementation Plan

> **Platform:** macOS and Linux only. Windows is not supported in the MVP.

## Overview

A local, single-user tool with a Kanban-style UI that lets developers assign coding tasks to an AI agent. The agent picks up work, executes it, streams real-time progress back to the board, and updates task status automatically. The tool is run from a repo root and is both agent/model agnostic and repo agnostic.

---

## Key Design Decisions

### 1. Tech Stack

| Layer               | Choice                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**        | React + TypeScript + Vite + Tailwind CSS + Zustand | React has the richest ecosystem for drag-and-drop (dnd-kit) and real-time UIs. Vite gives fast dev iteration. TypeScript catches bugs early in a tool that has multiple moving parts (adapters, event streams, task state machines). Tailwind CSS provides utility-first styling with fast iteration and zero separate CSS files. Zustand manages global state (tasks, agent config, SSE events) — lightweight (~1KB), TypeScript-native, and supports state updates from outside React components (needed for SSE event handlers). |
| **Backend**         | Bun + Hono                                         | Bun runs TypeScript natively — no build step, no `ts-node`. It has built-in SQLite (no `better-sqlite3` dependency) and a fast test runner. Hono is a lightweight, Bun-first web framework — smaller and faster than Express with the same routing API. Hono has built-in SSE streaming helpers. For a local single-user tool, Bun's relative youth is a non-issue.                                                                                                                                                                 |
| **Database**        | SQLite via Bun's built-in `bun:sqlite`             | Zero external dependencies. Synchronous API avoids callback complexity. The DB file lives in the repo (`.tasks_manager/tasks.db`), making it portable and self-contained.                                                                                                                                                                                                                                                                                                                                                           |
| **Real-time**       | Server-Sent Events (SSE)                           | The user must see what the agent is doing in real time. HTTP polling would introduce latency and wasted requests. Since all communication is server→client push (commands go through REST), SSE is the natural fit — simpler than WebSocket, built-in browser auto-reconnect via `EventSource` with `Last-Event-ID`, and no upgrade handshake.                                                                                                                                                                                      |
| **Package manager** | Bun workspaces                                     | Monorepo with `packages/backend` and `packages/frontend`. Bun workspaces are built-in and require no extra tooling.                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Key dependencies:**

| Package                   | Layer    | Purpose                                                   |
| ------------------------- | -------- | --------------------------------------------------------- |
| `hono`                    | Backend  | HTTP framework with SSE helpers                           |
| `shell-quote`             | Backend  | Parse `cli_cmd` into argv array (handles quoted segments) |
| `@dnd-kit/core`           | Frontend | Drag-and-drop between columns                             |
| `@dnd-kit/sortable`       | Frontend | Drag-and-drop reordering within columns                   |
| `@tanstack/react-virtual` | Frontend | Virtualized log viewer rendering                          |
| `zustand`                 | Frontend | Global state management (tasks, config, SSE events)       |
| `sonner`                  | Frontend | Toast notifications                                       |
| `tailwindcss`             | Frontend | Utility-first CSS styling                                 |
| `concurrently`            | Dev      | Run backend + frontend dev servers in parallel            |

### 2. Project Structure

```
tasks_manager/
├── package.json                  # Root workspace config, bin entry, prepublishOnly script
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts          # Entrypoint (startup sequence, static file serving)
│   │       ├── db/               # SQLite schema, connection, migrations
│   │       ├── routes/           # REST API endpoints (tasks, agent config, agent control)
│   │       ├── agents/           # Adapter interface, CLI adapter, API adapter
│   │       ├── executor/         # Task runner / orchestrator (with global mutex + PID lock)
│   │       └── sse/              # SSE stream management (SSEBroadcaster)
│   └── frontend/
│       ├── src/
│       │   ├── components/       # Board, Column, TaskCard, TaskDetail, Backlog, AgentConfig
│       │   ├── hooks/            # useEventSource, useTaskStore (Zustand)
│       │   └── api/              # HTTP client for backend
│       └── dist/                 # Built frontend assets (generated by vite build)
├── .tasks_manager/               # Runtime data (auto-gitignored)
│   ├── tasks.db
│   └── .lock                     # PID + timestamp JSON file (prevents multiple instances)
└── PLAN.md
```

### 3. Database Schema

**Why these tables:**
- `tasks` — the core entity. Each task has a short JIRA-like ID with an AI-generated prefix (e.g., `AWSM-1`), a status that maps to board columns, and acceptance criteria the agent uses to know when it's done.
- `task_logs` — append-only log of agent output lines. Separated from tasks so we can stream them efficiently without loading the full task, and so log history survives restarts.
- `agent_config` — stores the user's chosen agent setup (CLI command or API endpoint). Single row, updated in place.
- `project_config` — stores the AI-generated task key prefix, the monotonic task counter, and other project-level settings. Single row, written during init.

**Connection initialization:**

Every database connection must run these pragmas before any other operation:

```sql
PRAGMA journal_mode = WAL;       -- allows concurrent reads during writes
PRAGMA busy_timeout = 5000;      -- wait up to 5s on lock contention instead of failing immediately
PRAGMA foreign_keys = ON;        -- enforce FK constraints (OFF by default in SQLite)
```

**Why:**
- WAL mode prevents `SQLITE_BUSY` errors when the SSE handler reads while the executor writes.
- Busy timeout adds resilience if a second tool instance is accidentally started.
- Foreign keys must be explicitly enabled per-connection in SQLite — without this, `REFERENCES` and `ON DELETE CASCADE` are decorative.

**Schema:**

```sql
CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key      TEXT UNIQUE NOT NULL,            -- e.g. "AWSM-1" (AI-generated prefix, max 5 chars)
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
  acceptance    TEXT NOT NULL DEFAULT '' CHECK (length(acceptance) <= 50000),
  status        TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog', 'todo', 'in-progress', 'done')),
  agent_status  TEXT DEFAULT NULL
                CHECK (agent_status IS NULL OR agent_status IN ('running', 'completed', 'failed')),
  agent_pid     INTEGER DEFAULT NULL,            -- PID of the running agent process (for crash recovery)
  agent_started_at TEXT DEFAULT NULL,            -- process start timestamp (for PID reuse detection)
  sort_order    REAL NOT NULL DEFAULT 0,         -- fractional index for ordering within columns
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL DEFAULT 1,         -- distinguishes logs from retry #1 vs #2 etc.
  timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
  level      TEXT NOT NULL DEFAULT 'info',       -- info | warn | error | agent
  message    TEXT NOT NULL
);

CREATE INDEX idx_task_logs_task_id ON task_logs(task_id, run_number, id);

CREATE TABLE agent_config (
  id                 INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
  type               TEXT NOT NULL DEFAULT 'cli',         -- cli | api
  -- CLI fields
  cli_cmd            TEXT DEFAULT NULL,                   -- e.g. "claude" or "aider"
  cli_prompt_mode    TEXT NOT NULL DEFAULT 'stdin'
                     CHECK (cli_prompt_mode IN ('stdin', 'argument', 'flag')),
  cli_prompt_flag    TEXT DEFAULT NULL,                   -- e.g. "--message" or "--print -p" (split on whitespace into argv)
  -- API fields
  api_url            TEXT DEFAULT NULL,                   -- e.g. "http://localhost:11434/v1/chat/completions"
  api_headers        TEXT DEFAULT NULL,                   -- JSON object of headers (validated as Record<string, string>, max 10KB)
  api_model          TEXT DEFAULT NULL,
  api_request_format TEXT NOT NULL DEFAULT 'openai'
                     CHECK (api_request_format IN ('openai', 'ollama')),
  api_stream_format  TEXT NOT NULL DEFAULT 'sse'
                     CHECK (api_stream_format IN ('sse', 'ndjson', 'none')),
  -- Shared fields
  timeout_ms         INTEGER NOT NULL DEFAULT 1800000,    -- 30 minutes default
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
  task_prefix       TEXT NOT NULL                       -- e.g. "AWSM" (AI-generated, max 5 chars)
                    CHECK (length(task_prefix) BETWEEN 1 AND 5 AND task_prefix GLOB '[A-Z0-9]*'),
  next_task_number  INTEGER NOT NULL DEFAULT 1,         -- monotonic counter, never decrements
  repo_name         TEXT NOT NULL,                      -- original repo dir name for reference
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keep updated_at accurate on every UPDATE
-- Note: relies on PRAGMA recursive_triggers being OFF (SQLite default) to avoid infinite recursion.
CREATE TRIGGER tasks_updated_at AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

**Key schema decisions:**
- **CHECK constraints on status fields** — prevents invalid states like `status='banana'` from entering the DB, whether from bugs or direct DB edits.
- **`title` length constraint** — enforced at the DB level (1-500 chars). Empty titles are rejected.
- **`description` and `acceptance` length constraints** — max 50,000 chars each. Prevents multi-MB strings from bloating API responses and agent prompts.
- **`agent_pid` + `agent_started_at`** — stores both the PID and the timestamp when the process was spawned. During crash recovery, both are verified before killing — this prevents accidentally killing an unrelated process if the OS recycled the PID. Verification mechanism: Linux uses `/proc/<pid>/stat` field 22 (start time in clock ticks); macOS uses `ps -o lstart= -p <pid>`. Fallback: if start time can't be determined, assume PID was recycled and skip the kill.
- **`sort_order REAL`** — enables persistent ordering within columns via fractional indexing. See "Sort order" below for initial values and insertion logic.
- **`ON DELETE CASCADE` on `task_logs`** — deleting a task automatically cleans up its logs. No orphaned rows.
- **`run_number` on `task_logs`** — distinguishes logs from different agent runs on the same task. The executor increments this on each new run. First run uses `run_number = 1`, computed as `COALESCE(MAX(run_number), 0) + 1`.
- **Index on `task_logs(task_id, run_number, id)`** — log queries filter by task and run. Without this index, every log fetch is a full table scan that degrades as logs grow.
- **`cli_prompt_mode` + `cli_prompt_flag`** — different CLI tools accept prompts differently: `stdin` (pipe), `argument` (positional arg), or `flag` (e.g., `--message "..."`). This makes the adapter actually work with real tools like `claude`, `aider`, and `codex`. `cli_prompt_flag` is split on whitespace into multiple argv elements (e.g., `"--print -p"` → `["--print", "-p"]`).
- **`api_headers` as JSON** — replaces a single `api_key` field. Validated on write as a flat `Record<string, string>`, max 10KB. Handles Bearer tokens, custom headers, multi-header APIs (Anthropic needs `x-api-key` + `anthropic-version`) without the adapter needing to understand auth semantics.
- **`api_request_format`** — OpenAI-compatible (`/v1/chat/completions` with `messages[]`) is the default since Ollama, LM Studio, vLLM all support it. Ollama's native format (`/api/generate` with `prompt`) is the other option.
- **`api_stream_format`** — SSE (`data:` prefixed lines), NDJSON (one JSON object per line), or no streaming. These require fundamentally different parsers.
- **`timeout_ms`** — configurable execution timeout. Prevents hung agents from blocking the tool forever. Default 30 minutes.
- **`next_task_number`** — monotonic counter that never decrements, even after task deletions. Atomically incremented in the same transaction as task creation.
- **`updated_at` trigger** — SQLite `DEFAULT` only fires on INSERT. Without a trigger, `updated_at` would show creation time forever. The trigger relies on `recursive_triggers` being OFF (SQLite default) to avoid infinite recursion.

**Sort order logic:**
- **New tasks:** `sort_order = COALESCE(MAX(sort_order in same status column), 0) + 1.0`. This appends new tasks to the bottom.
- **Status change (drag between columns, "Run Agent", etc.):** the backend auto-recalculates `sort_order` for the target column: `COALESCE(MAX(sort_order in target column), 0) + 1.0` (append to bottom). The frontend can optionally send a specific `sort_order` with the PATCH (for drag-to-specific-position within the target column), which overrides the auto-calculation.
- **Drop between two cards:** `sort_order = (above.sort_order + below.sort_order) / 2`.
- **Drop at top of column:** `sort_order = first_card.sort_order - 1.0`.
- **Drop at bottom of column:** `sort_order = last_card.sort_order + 1.0`.
- **Validation:** `sort_order` must be a finite number. `NaN`, `Infinity`, and `-Infinity` are rejected at the route level.

**Singleton row seeding:**

Singleton tables (`agent_config`, `project_config`) are seeded in the same transaction as `CREATE TABLE` to prevent half-initialized states:

```sql
INSERT INTO agent_config (id) VALUES (1) ON CONFLICT DO NOTHING;
```

`project_config` is seeded during the init flow (section 4) after the AI generates the prefix.

**Migration strategy:**

Schema versions are tracked via `PRAGMA user_version`. On startup, the backend compares the DB's `user_version` to the app's expected version and runs sequential migrations:

```typescript
const version = db.query("PRAGMA user_version").get();
if (version < 2) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0;");
}
db.exec("PRAGMA user_version = 2;");
```

This ensures post-MVP schema changes (new columns, new tables) are applied without data loss. The `.tasks_manager/tasks.db` file is gitignored and local — users have real task history that must survive upgrades.

### 4. Initialization Flow

The tool requires a one-time init process on first run:

1. **Agent setup** — the UI presents the agent configuration screen. Defaults to CLI mode with a single "Command" input (e.g., pre-filled with `crush run`). Advanced options (prompt mode, timeout) are hidden behind an "Advanced" accordion. API mode is a secondary tab. Preset buttons are available for common tools:

   | Preset      | `cli_cmd`   | `cli_prompt_mode` | `cli_prompt_flag` |
   | ----------- | ----------- | ----------------- | ----------------- |
   | Crush       | `crush run` | `argument`        | —                 |
   | Claude Code | `claude`    | `flag`            | `--print -p`      |
   | Aider       | `aider`     | `flag`            | `--message`       |
   | Codex       | `codex`     | `argument`        | —                 |
2. **Test connection** — the user clicks "Test Connection". The tool sends the prompt `"Respond with exactly: OK"` to the configured agent. Pass criteria: exit code 0 (CLI) or HTTP 2xx (API) within a 30-second timeout (separate from `timeout_ms`). Any response content is considered a pass — output is not shown to the user. The user cannot proceed until the test passes.
3. **Task prefix generation** — once the agent is configured and tested, the tool sends the following prompt to the agent:

   ```
   Respond with ONLY 2-5 uppercase letters, nothing else. Generate a short memorable abbreviation for a project called '{repoName}'. Output ONLY the letters.
   ```

   The agent's response is parsed leniently (extract first alphanumeric token, uppercase it) and validated (1-5 uppercase alphanumeric chars). If invalid, retry up to 3 times with the same prompt. If all retries fail, prompt the user to manually enter a prefix. The validated prefix is stored in `project_config.task_prefix`. If the directory name is empty or unusable (e.g., root `/`, or `.`), the user is prompted to provide a project name first, which is used in place of `{repoName}`.
4. **Board ready** — the Kanban board becomes available. All subsequent task IDs use the stored prefix.

The prefix is generated once and persisted — it never changes, even if the agent configuration changes later.

**Init state detection:**

The frontend checks `GET /status` on mount, which returns `{ initialized: boolean, projectConfig?: ProjectConfig, repoName: string }`. `initialized` is `true` if and only if `project_config` has a row. If `false`, the frontend renders the init wizard as a full-page view (not a modal). If agent config is saved but prefix generation hasn't completed (partial init), the wizard resumes at step 3.

**Error handling during init:**
- **Agent call fails entirely** (connection refused, CLI not found, timeout, HTTP 500): the init flow does NOT proceed. The error is displayed to the user on the test step, and they can click "Back" to return to agent configuration. A working agent is the backbone of the tool — there is no point setting up the board if the agent is unreachable. The user must fix their agent config and re-test until the agent responds successfully.
- **Agent responds but with bad output** (too long, non-alphanumeric, prose-wrapped): handled by the lenient parsing and retry logic described in step 3.

**Why AI-generated prefixes:**
- A deterministic algorithm (initials, truncation) produces forgettable or awkward prefixes. An AI can pick something meaningful and memorable — `AWSM` is better than `MAA` for `my-awesome-app`.
- The chicken-and-egg problem (needing an agent to create tasks) is solved by making agent setup the first step of init.

### 5. Task Lifecycle & Status Model

**State transition table:**

| From          | To            | `agent_status` behavior                                                                                                | Trigger                                      |
| ------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `backlog`     | `todo`        | Stays `null`.                                                                                                          | UI action ("Move to Todo")                   |
| `backlog`     | `in-progress` | Set to `running` (auto-triggers the agent)                                                                             | UI action or "Run Agent" button              |
| `backlog`     | `done`        | Stays `null` (manual close — "no longer relevant")                                                                     | UI action ("Mark as Done")                   |
| `todo`        | `backlog`     | Stays `null`.                                                                                                          | UI action ("Move to Backlog")                |
| `todo`        | `in-progress` | Set to `running` (auto-triggers the agent)                                                                             | Drag-and-drop or "Run Agent" button          |
| `todo`        | `done`        | Stays `null` (manual completion)                                                                                       | Drag-and-drop                                |
| `in-progress` | `todo`        | **If `running`: confirmation dialog, then cancel agent, set to `failed`.** Reset to `null`.                            | Drag-and-drop (with confirmation if running) |
| `in-progress` | `done`        | **If `running`: confirmation dialog, then cancel agent, set to `failed`. If already `completed`/`failed`: preserved.** | Drag-and-drop (with confirmation if running) |
| `done`        | `todo`        | Reset to `null`. Logs preserved.                                                                                       | Drag-and-drop                                |
| `done`        | `in-progress` | Set to `running` (auto-triggers the agent)                                                                             | Drag-and-drop or "Run Agent" button          |
| `in-progress` | `in-progress` | Set to `failed`                                                                                                        | Agent process exits non-zero or timeout      |
| `in-progress` | `done`        | Set to `completed`, `status` moves to `done`                                                                           | Agent process exits 0                        |

**Note:** `in-progress` with `agent_status = null` is unreachable — every entry into `in-progress` sets `agent_status = 'running'`. The only valid `agent_status` values while `in-progress` are `running` and `failed`.

**Blocked transitions:**
- `in-progress → backlog` — **blocked** (400). Backlog is for unstarted work. Use `in-progress → todo` instead.
- `done → backlog` — **blocked** (400). A completed/failed task has already been worked on. Use `done → todo` to reopen.

**On any status change**, the backend auto-recalculates `sort_order` for the target column (append to bottom), unless the frontend explicitly provides a `sort_order` in the request.

**Key rules:**
- **Drag between columns is always physically possible.** The backend validates the transition and may reject it (returning 409 if the mutex is held), in which case the card snaps back with a toast.
- **Dragging to `in-progress` auto-triggers the agent.** This board is exclusively for AI agent work — `in-progress` always means the agent is working on it. The "Run Agent" button is an equivalent alternative trigger. If the global mutex is held (another task is running), the drag is rejected — the card snaps back and a toast shows: *"Can't start — agent is busy with AWSM-2."*
- **Dragging a `running` task away from `in-progress` uses a deferred-commit pattern:** in `onDragEnd`, the drop is not committed (card snaps back visually). A confirmation dialog appears: *"Agent is running on AWSM-3. Cancel it and move?"* On confirm → the frontend calls the API to cancel the agent and update the status, then the card moves to the new column. On decline → the pending move is cleared, card stays in place. This is necessary because `@dnd-kit` does not support pausing a drag mid-flight.
- **`agent_status` resets to `null` when moved to `todo` or `backlog`** — clean slate.
- **`agent_status` is preserved when moved to `done`** — user can see whether it was agent-completed or manually completed.
- **Re-running the agent on any task** is allowed regardless of current `agent_status`. The executor increments `run_number` and appends new logs.

**Concurrency — two separate locks:**

The system uses two distinct locking mechanisms:
- **PID file** (`.tasks_manager/.lock`) — prevents multiple *server instances* in the same directory.
- **In-memory mutex** — prevents multiple *agent runs* at the same time.

**PID file (server instance lock):**
- The `.lock` file stores JSON: `{ "pid": <number>, "startedAt": "<ISO timestamp>" }`. On startup, the server reads the file. If a PID is present, the process is alive (`process.kill(pid, 0)` succeeds), **and** the start time matches the process's actual start time (verified via `/proc/<pid>/stat` on Linux or `ps -o lstart=` on macOS), the server refuses to start with a clear error: *"Another instance of tasks-manager is already running in this directory (PID: 12345)."* If the PID is stale (process dead or start time doesn't match — indicating PID reuse), the lock file is overwritten.
- The PID file is written with the server's own PID and `new Date().toISOString()` after acquiring the lock.

**In-memory mutex (agent execution lock):**

Only one agent can run at a time.
- When "Run Agent" is requested, if the in-memory mutex is held, the request is rejected with HTTP 409: `{ error: "Agent is busy with AWSM-2", busyTaskKey: "AWSM-2" }`. The frontend uses `busyTaskKey` to display the toast.
- Tasks are NOT auto-queued — the user must explicitly retry after the current run finishes. This keeps behavior predictable and avoids hidden queues.

**Why not auto-queue:** Auto-queuing creates invisible state ("where did my task go? why hasn't it started?"). For a single-user tool, explicit control is better — the user sees exactly what's running and decides what's next.

**Crash recovery:**

Crash recovery runs **synchronously before the HTTP server starts accepting requests**. No requests are served until recovery completes. This prevents a race where a user starts a new agent while an orphaned process is still being killed.

Steps:

1. Query all tasks with `agent_status = 'running'`.
2. For each, check if `agent_pid` is not NULL and is still alive (`process.kill(pid, 0)`). If `agent_pid` is NULL (API adapter — no process to kill), skip to step 4.
3. If the process is alive, verify `agent_started_at` matches the process start time (Linux: `/proc/<pid>/stat` field 22; macOS: `ps -o lstart= -p <pid>`). If verified, kill it (SIGTERM → wait 5s → SIGKILL). If the PID was recycled (timestamps don't match) or start time can't be determined, skip the kill — the original process is already gone.
4. Mark the task as `agent_status = 'failed'`.
5. Insert a `task_logs` entry: `"Server restarted — previous agent run was aborted."` with `level = 'error'`.
6. **Only after all recovery is complete**, start listening on the port.

This prevents perpetually-stuck tasks after crashes, OOM kills, or Ctrl+C.

**Why two status fields:**
- `status` controls which board column the task appears in — this is the user-facing state.
- `agent_status` tracks the agent execution lifecycle — this drives the logs UI and retry logic.
- Separating them means a user can manually move a task to "done" even if the agent failed, or move it back to "todo" to reset.

### 6. Agent Adapter System

**Interface:**

```typescript
interface AgentAdapter {
  execute(params: {
    task: Task;
    workingDir: string;                // repo root where tool was launched
    onOutput: (line: string) => void;  // stream each output line
    signal: AbortSignal;               // cancellation support
  }): Promise<AgentResult>;
}

interface AgentResult {
  success: boolean;
  summary: string;  // what the agent did
}
```

**Why this interface:**
- `onOutput` callback — enables real-time streaming without coupling the adapter to SSE internals. The task runner wires `onOutput` to the SSE broadcaster.
- `AbortSignal` — lets the user cancel a running agent from the UI. The CLI adapter kills the process tree; the API adapter aborts the HTTP request.
- `workingDir` — the agent always operates in the repo root. This keeps it repo-agnostic — the adapter doesn't need to know anything about the repo.

**CLI Adapter:**
- The `cli_cmd` string is **parsed using `shell-quote` into an argv array** (e.g., `"/path/to my/claude" --print` → `["/path/to my/claude", "--print"]`). Node.js `child_process.spawn` is always called with an array, never a shell string. The process is spawned with `detached: true` to create a new process group. The prompt is never interpolated into the command — it goes via stdin, positional arg, or flag value only. This prevents shell injection from prompt content.
- **Prompt delivery** is configurable via `cli_prompt_mode`:
  - `stdin` — pipes the prompt to the process's stdin.
  - `argument` — appends the prompt as a final element in the argv array.
  - `flag` — splits `cli_prompt_flag` on whitespace into argv elements and appends the prompt after them (e.g., `cli_prompt_flag = "--print -p"` → `["--print", "-p", "<prompt>"]`).
- Pipes stdout/stderr to `onOutput` line by line.
- **Output sanitization:** individual lines are truncated at 10KB before storing or streaming. Non-UTF-8 byte sequences are replaced with `[binary data, <size>]`. ANSI escape sequences (colored terminal output) are stripped via regex (`/\x1b\[[0-9;]*m/g`) before storing. This prevents binary output from bloating the DB and ANSI codes from cluttering the log viewer.
- Resolves the promise when the process exits; `success = exit code 0`.
- **Process tree kill:** the process is spawned in its own process group via `detached: true`. On cancellation, SIGTERM is sent to the entire process group (`-pid`), with a 5-second grace period before SIGKILL. This ensures child processes spawned by the agent (subshells, workers) are also terminated.
- **Timeout:** a timer starts when the process spawns. If `timeout_ms` elapses, the abort signal fires and the process tree is killed. A log entry records the timeout.
- The child PID and current timestamp are stored in `tasks.agent_pid` and `tasks.agent_started_at` for crash recovery.

**API Adapter:**
- Sends a POST request to the configured endpoint with the task as the prompt.
- **Request format** is configurable via `api_request_format`:
  - `openai` — `{ model, messages: [{ role: "user", content: "..." }], stream: true }` (compatible with OpenAI, Ollama's `/v1/chat/completions`, LM Studio, vLLM).
  - `ollama` — `{ model, prompt: "...", stream: true }` (Ollama's native `/api/generate` endpoint).
- **Headers** are sent from `api_headers` JSON — supports Bearer tokens, API keys, custom headers without hardcoded auth logic.
- **Streaming** is parsed based on `api_stream_format`:
  - `sse` — lines prefixed with `data:`, separated by `\n\n`. Standard for OpenAI-compatible APIs.
  - `ndjson` — each line is a full JSON object. Used by Ollama's native API.
  - `none` — waits for the full response body. Pipes the result to `onOutput` at the end.
- **Timeout:** the same `timeout_ms` applies. The fetch `AbortSignal` fires on timeout.
- **Success criteria:** `success = true` if the HTTP response status is 2xx. `AgentResult.summary` is the last line of streamed output (or the full response body if non-streaming), truncated to 500 chars.
- No `agent_pid` is stored — crash recovery skips the kill step for API adapter tasks (the HTTP request terminates with the server process).

**Why not a plugin directory with dynamic loading:**
- For the MVP, two adapters (CLI + API) cover the stated requirements. A plugin system adds complexity (file discovery, validation, sandboxing) without immediate value. The adapter interface is simple enough that adding a new one is a single file + a registry entry.

### 7. Task Runner / Executor

The task runner module is the orchestrator. It is the **single entrypoint** for starting an agent — both `POST /tasks/:id/agent/start` and `PATCH /tasks/:id` with `status: "in-progress"` delegate to the same executor function.

1. Receives a "run task" command.
2. **Acquires the in-memory mutex first** — if held, rejects with HTTP 409 **without modifying the DB**. This ensures atomicity: the status is never changed to `in-progress` without the agent actually starting.
3. Sets `agent_status = 'running'`, moves task to `in-progress` in the DB. Recalculates `sort_order` for the `in-progress` column (append to bottom).
4. Increments `run_number`: `COALESCE(MAX(run_number) FROM task_logs WHERE task_id = ?, 0) + 1`.
5. Loads the appropriate adapter from the registry.
6. Builds the prompt from task fields (title, description, acceptance criteria — see section 11).
7. Calls `adapter.execute()`, wiring `onOutput` to:
   - Insert into `task_logs` table (with current `run_number`). **On INSERT failure** (disk full, `SQLITE_FULL`): log to stderr, set a `logsFailing` flag to suppress further INSERT attempts, but **do not kill the agent** — it's doing real work in the repo. Continue broadcasting via SSE (streaming-only mode). On agent completion, insert a warning log: *"N log lines were lost due to storage error."*
   - Broadcast via the `SSEBroadcaster` to all connected clients.
8. Stores the child PID and start timestamp in `tasks.agent_pid` and `tasks.agent_started_at` (CLI adapter only).
9. On completion: sets `agent_status = 'completed'` or `'failed'`, moves to `done` on success (recalculating `sort_order` for the `done` column). Clears `agent_pid` and `agent_started_at`. Releases the mutex. Broadcasts a toast-friendly SSE event with the outcome.
10. **On any failure after mutex acquisition** (DB error, spawn failure, etc.): release the mutex, rollback the DB changes, return 500.

**Cancellation** is triggered via REST endpoint (`POST /tasks/:id/agent/cancel`):
1. Sends the abort signal to the adapter.
2. CLI adapter kills the process tree (SIGTERM → 5s → SIGKILL).
3. Sets `agent_status = 'failed'`, logs "Agent cancelled by user."
4. Releases the mutex.

**Why a separate executor layer:**
- Decouples "how to run an agent" from "how to store/stream results." Routes stay thin, adapters stay focused, and the executor handles the glue.

### 8. Real-Time Streaming

**Architecture:**

Server-Sent Events (SSE) handles all server→client push. All client→server commands (start agent, cancel agent, CRUD operations) go through REST endpoints. This ensures the app remains functional even if the SSE connection drops — the user can still create tasks, move cards, and start/cancel agents. SSE adds live updates on top.

**SSE Broadcaster:**

A singleton `SSEBroadcaster` in `src/sse/broadcaster.ts` manages all connected clients:
- `addClient(stream)` — called when a new `GET /events` connection opens. Adds the response stream to an internal `Set`.
- `removeClient(stream)` — called on connection close/error. Removes from the set. **Disconnect detection:** the server listens on the request's `AbortSignal` (`c.req.raw.signal`) to detect client disconnection. Heartbeat write failures serve as a fallback — if a `:heartbeat` write errors, the client is removed.
- `broadcast(event)` — iterates a snapshot of the set (`[...clients]`) and writes the event to each stream. Writes are fire-and-forget — if a stream errors, it's removed. The executor calls `broadcast()` **after** the synchronous DB insert, guaranteeing that any log row exists in the DB before the client receives the SSE event.

**SSE endpoint:**

```
GET /events   — SSE stream of all real-time events
```

**Event types:**

```
event: task:updated
data: { task: Task }
id: <event_id>

If the task was deleted, the `task` object includes a `_deleted: true` flag. The frontend uses this to remove the task from the store.

event: task:log
data: { taskId: number, log: { timestamp, level, message, runNumber } }
id: <event_id>

event: agent:status
data: { taskId: number, status: AgentStatus }
id: <event_id>

event: toast
data: { type: "success" | "error" | "info", message: string }
id: <event_id>

event: stale
data: {}
id: <event_id>
```

Each event includes an `id` field (monotonic integer, global across all event types, reset on server restart). This enables the browser's built-in `Last-Event-ID` reconnection — on reconnect, the server replays missed events from its buffer.

**SSE event buffer:**

The server maintains a **ring buffer of 1000 events**. On reconnect:
1. The browser sends `Last-Event-ID` header automatically.
2. If the requested ID is within the buffer, the server replays all events with `id > Last-Event-ID`.
3. If the requested ID is older than the buffer's oldest event (or the server restarted, resetting IDs), the server emits `event: stale`. The client detects this and triggers a full state rehydration via `GET /tasks`.

A `:heartbeat` comment is sent every 15 seconds to detect dead connections.

**Frontend SSE handling:**

The `useEventSource` hook listens for all event types:
- `task:updated` → updates the task in local state (board/backlog re-renders the affected card).
- `task:log` → appends to the log buffer (batched, flushed every 100ms to React state).
- `agent:status` → updates the agent status badge/spinner on the relevant card.
- `toast` → displays a toast notification.
- `stale` → triggers full state rehydration via `GET /tasks`.

**Why SSE over WebSocket:**
- All communication is server→client push — SSE is purpose-built for this pattern.
- **Built-in auto-reconnect** — the browser's `EventSource` API reconnects automatically and sends `Last-Event-ID`, so the server can replay missed events. No custom reconnection logic needed.
- **Simpler** — standard HTTP, no upgrade handshake, no ping/pong management, no custom heartbeat.
- **Graceful degradation** — if SSE drops, all functionality still works via REST. SSE only adds live push.

**Multi-tab handling:**

On page load, the app checks for other open tabs via `localStorage` events. If another tab is detected, a warning banner is shown: *"Another tab is already open. Real-time updates may be unreliable."* The app still works — this is informational, not blocking. (HTTP/1.1 allows only 6 concurrent connections per origin; each SSE connection consumes one permanently.)

### 9. REST API

**Global middleware:**
- **Body size limit:** `app.use('*', bodyLimit({ maxSize: '1mb' }))` via Hono's built-in middleware. Prevents OOM from oversized request bodies.
- **JSON error handling:** invalid JSON in request bodies returns `400 { error: "Invalid JSON" }` instead of a 500.

**Error response format:**

All error responses use a consistent schema:

```typescript
{ error: string }
```

Status codes:
- `400` — validation error (missing fields, bad values, invalid JSON)
- `404` — task or resource not found
- `409` — agent mutex conflict (body includes `busyTaskKey`), or action blocked (e.g., delete while running)
- `500` — unexpected server error

**Endpoints:**

| Method            | Path                      | Description                | Request Body                                                  | Response                                                                    |
| ----------------- | ------------------------- | -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET`             | `/status`                 | Init state detection       | —                                                             | `{ initialized: boolean, projectConfig?: ProjectConfig, repoName: string }` |
| `GET`             | `/events`                 | SSE event stream           | —                                                             | SSE stream                                                                  |
| **Tasks**         |                           |                            |                                                               |                                                                             |
| `GET`             | `/tasks`                  | List all tasks             | Query: `?q=<search>&status=<status>`                          | `{ tasks: Task[] }` (ordered by `sort_order ASC`)                           |
| `POST`            | `/tasks`                  | Create a task              | `{ title, description?, acceptance?, status?, run? }`         | `{ task: Task }`                                                            |
| `GET`             | `/tasks/:id`              | Get a single task          | —                                                             | `{ task: Task }`                                                            |
| `PATCH`           | `/tasks/:id`              | Update task fields         | `{ title?, description?, acceptance?, status?, sort_order? }` | `{ task: Task }`                                                            |
| `DELETE`          | `/tasks/:id`              | Delete a task              | —                                                             | `204 No Content` or `409` if running                                        |
| **Task Logs**     |                           |                            |                                                               |                                                                             |
| `GET`             | `/tasks/:id/logs`         | Paginated logs             | Query: `?before_id=N&limit=500&run_number=N`                  | `{ logs: Log[], hasMore: boolean }`                                         |
| **Agent Control** |                           |                            |                                                               |                                                                             |
| `POST`            | `/tasks/:id/agent/start`  | Start agent on a task      | —                                                             | `{ task: Task }` or `409`                                                   |
| `POST`            | `/tasks/:id/agent/cancel` | Cancel a running agent     | —                                                             | `{ task: Task }`                                                            |
| **Agent Config**  |                           |                            |                                                               |                                                                             |
| `GET`             | `/agent-config`           | Read agent configuration   | —                                                             | `{ config: AgentConfig }`                                                   |
| `PUT`             | `/agent-config`           | Update agent configuration | `AgentConfig fields`                                          | `{ config: AgentConfig }`                                                   |
| `POST`            | `/agent-config/test`      | Test agent connection      | —                                                             | `{ success: boolean, durationMs: number, error?: string }`                  |
| **Init**          |                           |                            |                                                               |                                                                             |
| `POST`            | `/init/generate-prefix`   | Trigger prefix generation  | `{ repoName: string }`                                        | `{ prefix: string }` or error                                               |
| `POST`            | `/init/save-prefix`       | Save the accepted prefix   | `{ prefix: string }`                                          | `{ projectConfig: ProjectConfig }`                                          |

**Task creation notes:**
- `POST /tasks` requires `title` (1-500 chars). `description` (max 50,000 chars) and `acceptance` (max 50,000 chars) are optional (default to `''`).
- `status` is optional and must be `backlog` (default) or `todo`. Creating directly into `in-progress` or `done` is not allowed.
- `run: true` (optional) — creates the task and immediately starts the agent on it in a single request. The mutex is acquired **before** the task is created — if held, the entire request fails with 409 and **no task is created**. If the DB transaction fails after the mutex is acquired, the mutex is released and 500 is returned. This powers the "Create & Run" button.
- Response includes the generated `task_key`.

**Agent config validation:**
- `PUT /agent-config` validates `api_headers`: must be valid JSON, must be a flat `Record<string, string>`, max 10KB. Malformed headers are rejected with 400.
- `sort_order` on `PATCH /tasks/:id`: must be a finite number (`Number.isFinite()`). `NaN`, `Infinity`, and `-Infinity` are rejected with 400.

**Status change side effects:**
- `PATCH /tasks/:id` with `status: "in-progress"` delegates to the executor (same code path as `POST /tasks/:id/agent/start`). The mutex is acquired **before** the DB update — if held, returns `409` without modifying the task.
- `PATCH /tasks/:id` with a status change away from `in-progress` while `agent_status = 'running'` auto-cancels the agent (the frontend shows a confirmation dialog before sending the PATCH).
- `PATCH /tasks/:id` with `status: "backlog"` from `in-progress` or `done` is rejected with `400` — backlog is for unstarted work only.
- Any valid status change recalculates `sort_order` for the target column (append to bottom) unless a specific `sort_order` is provided in the request body.

**Log pagination:**
- Default (no `before_id`): returns the latest 500 logs in ascending `id` order (chronological).
- With `before_id=N`: returns up to `limit` logs where `id < N`, in ascending order.
- `run_number` is an optional filter.
- `hasMore: true` if there are older logs matching the filters.

**Task list filtering:**
- `GET /tasks?q=<search>` filters by title and description (case-insensitive substring match via SQL `LIKE`).
- `GET /tasks?status=<status>` filters by status.
- Both are optional and combinable.

### 10. Frontend Design

**Navigation:**
- A **side navigation bar** (left sidebar) with links to Board and Backlog.
- The backlog link shows a task count badge.
- A settings icon at the bottom of the sidebar opens the agent config modal.
- The sidebar is collapsible for more board space.

**Board layout:**
- Three columns: Todo, In Progress, Done.
- Cards show: task key (e.g., `AWSM-3`), title, and a small status badge for `agent_status`.
- Cards have a hover state (elevation change, border highlight) to indicate clickability.
- Cards with `agent_status='running'` show a spinner.
- A small play button is visible on each `todo` card for quick "Run Agent" access without opening the detail panel.
- Drag-and-drop between columns (using `@dnd-kit/core`) updates task status via REST API.
- Drag-and-drop within a column reorders cards (updates `sort_order` via REST API).
- Clicking a card opens a detail panel.

**Backlog:**
- A separate list view accessible from the side navigation (not a board column). Tasks are created in the backlog by default.
- The backlog is for longer-term planning — tasks the user hasn't committed to working on yet.
- No drag-and-drop — the backlog is a plain list, not part of the Kanban board. Tasks are moved to the board via explicit UI actions: "Move to Todo", "Run Now" (moves directly to in-progress and starts the agent), "Mark as Done" (closes without running).
- The backlog supports client-side search and filtering by title/description.

**Task creation:**
- A "Create Task" button is available from both the board and the backlog.
- When created from the backlog, the task defaults to `backlog` status.
- When created from the board, the task defaults to `todo` status.
- A "Create & Run" button is available alongside "Create" — this creates the task and immediately starts the agent on it via `POST /tasks` with `run: true`. If the mutex is held, the task is not created and an error toast is shown.

**Task detail panel:**
- Full task info (editable when agent is not running; **read-only while `agent_status` is `running`** — enforced in the UI only, not server-side).
- "Run Agent" button (disabled if agent is already running on any task — global mutex).
- "Cancel" button (visible when agent is running on this task).
- "Delete" button (disabled while agent is running on this task; requires confirmation).
- Live log viewer — terminal-like area showing agent output in real time.
  - **Virtualized rendering** via `@tanstack/react-virtual` — only the ~50 visible lines are mounted in the DOM, regardless of total log size. Without this, the viewer is unusable past ~10,000 lines.
  - **Batched updates** — incoming SSE `task:log` events are buffered in a ref and flushed to React state every 100ms via `requestAnimationFrame`. This collapses high-throughput output (100+ events/sec) into ~10 renders/sec.
  - **Paginated history** — on panel open, only the last 500 lines are fetched via `GET /tasks/:id/logs?limit=500&before_id=...`. A "Load earlier logs" button fetches previous pages. Never loads all logs at once.
  - **Auto-scroll lock** — auto-scrolls only when the user is at the bottom. Scrolling up pins the viewport and shows a "Jump to bottom" button, so live output doesn't fight the user.
- Logs grouped by `run_number` with collapsible sections for previous runs.

**Agent config modal:**
- Accessible from the sidebar settings icon (not just during init).
- Shows a warning banner while an agent is running: *"Config changes apply to future runs only."*
- Defaults to CLI mode with a single "Command" input. Advanced options (prompt mode, flag, timeout) are behind an "Advanced" accordion.
- Preset buttons for common tools: "Crush", "Claude Code", "Aider", "Codex", "Custom CLI".
- API mode tab: URL, headers editor (key-value pairs), model name, request format (OpenAI/Ollama), stream format (SSE/NDJSON/none).
- "Test Connection" button that sends `"Respond with exactly: OK"` with a 30-second timeout. Pass = exit code 0 (CLI) or HTTP 2xx (API). Any response content is a pass. Shows pass/fail result only.

**Toast notifications:**
- Agent success: *"AWSM-3 completed successfully."*
- Agent failure: *"AWSM-3 failed: process exited with code 1."* / *"AWSM-3 failed: timed out after 30m."*
- Agent cancelled: *"AWSM-3 cancelled."*
- Mutex rejection: *"Can't start — agent is busy with AWSM-2."*
- Drag rejection: card snaps back + toast with reason.

**Empty states:**
- **Empty board:** centered prompt: *"No tasks on the board yet. Create a task or move one from the backlog."* with a "Create Task" button.
- **Empty columns:** ghost text: *"Drag tasks here"* (todo/done) or *"Tasks your agent is working on appear here"* (in-progress).
- **Empty backlog:** *"Your backlog is empty. Create tasks to plan future work."*
- **Empty log viewer:** *"No agent runs yet. Click 'Run Agent' to start."*

**Why @dnd-kit over react-beautiful-dnd:**
- `react-beautiful-dnd` is unmaintained (archived by Atlassian). `@dnd-kit` is actively maintained, more flexible, and has better TypeScript support.

### 11. Prompt Construction

When the agent is invoked, the executor builds a prompt from the task:

```
You are working in the repository at: {workingDir}

## Task: {task_key} — {title}

### Description
{description}

### Acceptance Criteria
{acceptance}

Please implement the changes needed to complete this task.
```

Empty sections are stripped — if `description` or `acceptance` is `''`, the corresponding `### header` and blank content are omitted entirely from the prompt.

**Why structured prompt, not raw fields:**
- Gives the agent clear context regardless of which model/CLI is behind it.
- The `workingDir` line tells the agent where it's operating (important for CLI agents that receive the prompt via stdin).

### 12. JIRA-like Task IDs

- The prefix is AI-generated during init (see section 4) and stored in `project_config.task_prefix`.
- Task IDs are `{prefix}-{n}`, e.g., `AWSM-1`, `AWSM-12`.
- Stored in the `task_key` column with a UNIQUE constraint.
- The counter uses `project_config.next_task_number` — a monotonic integer that is atomically incremented in the same transaction as the task INSERT. It never decrements, even after task deletions, so IDs are always unique and predictable.

```sql
-- Task creation transaction (sort_order computed for the target status column)
BEGIN;
UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1
  RETURNING next_task_number - 1 AS seq;
INSERT INTO tasks (task_key, title, status, sort_order, ...)
  VALUES (prefix || '-' || seq, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1.0 FROM tasks WHERE status = ?), ...);
COMMIT;
```

**Why not `MAX(id)`:**
- `MAX(id)` is ambiguous (evaluated before or after INSERT?), produces duplicates after deletions, and conflates the surrogate key with the user-visible sequence number. A dedicated counter avoids all three problems.

**Why not UUIDs:**
- The requirement is JIRA-like IDs. `AWSM-42` is short, human-readable, and repo-contextual. UUIDs are none of those.

### 13. Data Storage Location

- Runtime data lives in `.tasks_manager/` at the repo root.
- On first run, the backend creates `.tasks_manager/` (via `mkdirSync(..., { recursive: true })`) and initializes the DB.
- The init flow automatically appends `.tasks_manager/` to the repo's `.gitignore` file (if not already present) to prevent accidental commits of the SQLite DB, logs, and API keys.

### 14. Startup & Shutdown

**Startup sequence:**

```bash
# From the repo root
bunx tasks-manager
# or during development
bun run dev
```

The server follows a strict startup sequence:

1. **Create directory** — `mkdirSync('.tasks_manager', { recursive: true })`. Safe on first run and subsequent runs.
2. **Acquire PID lock** — read `.tasks_manager/.lock` (JSON: `{ pid, startedAt }`). If PID is present, alive, and start time matches, exit with error. Otherwise, write own PID + timestamp.
3. **Connect to DB** — open `.tasks_manager/tasks.db`, run pragmas, run migrations.
4. **Crash recovery** — synchronously sweep `agent_status = 'running'` rows, kill orphans (verifying PID + timestamp), mark failed. (See section 5.)
5. **Start HTTP server** — only now accept connections.

- The backend serves the pre-built frontend from `packages/frontend/dist/` as static files in production (single process).
- In development, Vite runs on a separate port with a proxy to the backend.
- The backend detects `process.cwd()` as the working directory and passes it to agents.
- **Port selection:** the server defaults to port 4200. If the port is taken, the server exits with an error message directing the user to free the port or use `--port <number>` to specify an alternative. The actual port is logged to the console on startup.

**Build & packaging:**

```json
// Root package.json
{
  "name": "tasks-manager",
  "bin": { "tasks-manager": "./packages/backend/src/index.ts" },
  "scripts": {
    "prepublishOnly": "cd packages/frontend && bun run build",
    "dev": "concurrently \"cd packages/backend && bun run dev\" \"cd packages/frontend && bun run dev\""
  }
}
```

- `prepublishOnly` runs `vite build` in the frontend package, outputting to `packages/frontend/dist/`.
- The `bin` entry points to the backend entrypoint, which Bun runs directly as TypeScript.
- On `bunx tasks-manager`, Bun executes the entrypoint, which serves `packages/frontend/dist/` as static files.

**Graceful shutdown:**

On `SIGTERM` or `SIGINT` (Ctrl+C), the server runs a shutdown handler:

1. **Stop accepting new requests** — close the HTTP listener.
2. **Kill running agent** — if an agent is active, send SIGTERM to the process tree, wait up to 5s, then SIGKILL. Mark the task as `agent_status = 'failed'` and insert a log entry: *"Server shutting down — agent run aborted."*
3. **Close SSE connections** — remove all clients from the broadcaster.
4. **Close DB** — flush WAL and close the connection.
5. **Release PID lock** — delete `.tasks_manager/.lock`.
6. **Exit.**

---

## Build Order

Implementation should follow this phased order:

1. **Skeleton** — project structure, `package.json` workspaces, DB schema + pragmas + migrations, PID lock, startup sequence.
2. **REST API** — task CRUD, agent config CRUD, status endpoint. No agent execution yet — just data management.
3. **Agent system** — adapter interface, CLI adapter (with shell parsing, prompt delivery, output sanitization, process group kill, timeout), executor with mutex. Wire to `POST /tasks/:id/agent/start` and `POST /tasks/:id/agent/cancel`.
4. **SSE** — broadcaster, event types, ring buffer, heartbeat, reconnect/stale logic. Wire to executor `onOutput` and task updates.
5. **Frontend shell** — sidebar navigation, board layout with 3 columns, backlog list, drag-and-drop (dnd-kit), task CRUD forms.
6. **Task detail** — detail panel, log viewer (virtualized + batched + paginated + auto-scroll), run/cancel buttons, confirmation dialog for running tasks.
7. **Init wizard** — agent config UI (presets, progressive disclosure), test connection, prefix generation, init state detection.
8. **API adapter** — request format, streaming parsers, header injection.
9. **Polish** — toasts, empty states, multi-tab detection, graceful shutdown, `.gitignore` auto-append.

---

## MVP Scope (What's In)

- First-run initialization wizard (agent setup, test connection, AI-generated task prefix)
- Kanban board with 3 columns (todo, in-progress, done) + backlog view
- Task CRUD (create, read, update, delete) with AI-generated JIRA-like IDs
- Drag-and-drop between and within columns (persistent ordering with auto-recalculation on status change)
- Backlog for longer-term task planning with search/filter
- Side navigation with board/backlog views
- Agent config (CLI or API) with presets, progressive disclosure, and flexible auth
- One-click "run agent" on a task (global mutex — one at a time)
- "Create & Run" shortcut for immediate agent execution
- Real-time log streaming to UI via SSE with virtualized rendering
- Agent cancellation with confirmation dialog and process tree cleanup
- Configurable execution timeout
- Toast notifications for agent outcomes and errors
- Empty states with guidance text
- Crash recovery on startup (orphaned agent detection, blocking startup)
- Graceful shutdown (agent cleanup, lock release)
- PID lock to prevent multiple instances (with timestamp for PID reuse detection)
- Multi-tab detection with warning
- SSE auto-reconnect with ring buffer replay (1000 events)
- Consistent REST API with documented endpoints, validation, and error format
- Schema migrations via `PRAGMA user_version`
- Request body size limit (1MB)
- Auto-append `.tasks_manager/` to `.gitignore`
- Port default (4200) with `--port` override

## Post-MVP (What's Out)

- Done column cleanup (auto-hide/archive old completed tasks)
- Log retention policy (configurable cleanup for old logs)
- Git branch/commit integration
- Multiple boards / projects
- Custom columns
- Task dependencies
- File diff viewer
- Agent output approval workflow
- Windows support
