# Parallel Agent Execution via Git Worktrees

## Problem

The executor uses a global in-memory mutex that allows only one agent to run at a time. This exists because two agents working in the same directory would overwrite each other's files. But it also means agents sit idle while another finishes — even when the tasks touch completely unrelated code.

## Solution

Use `git worktree` to give each running agent its own isolated working directory on its own branch. The OS-level filesystem isolation removes the collision risk, so multiple agents can run simultaneously.

Each agent run does:

```
git worktree add .tasks_manager/worktrees/<task-key> -b agent/<task-key>
```

The agent's `cwd` is set to the worktree path instead of the repo root. When the run finishes, the worktree is cleaned up.

## Why Worktrees

| Alternative | Problem |
|---|---|
| Remove the mutex | Two agents write to the same files, producing corrupted state |
| Per-file locking | Agents modify unpredictable files — can't declare scopes upfront |
| Clone the repo | Slow for large repos, wastes disk, loses local state |
| Docker containers | Heavy setup, overkill for local dev tool |
| Git worktrees | Lightweight (shares `.git` objects), fast to create, full isolation |

Worktrees share the git object store, so creation is nearly instant regardless of repo size. Each worktree has its own index, working tree, and HEAD — agents can't interfere with each other.

## Design

### Concurrency Model

Replace the single `MutexState` object with a `Map<number, RunState>` keyed by task ID. Add a configurable concurrency cap (default: 3) enforced by a semaphore counter.

```typescript
interface RunState {
  taskId: number;
  taskKey: string;
  runNumber: number;
  pid: number | null;
  abortController: AbortController;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
  cancelling: boolean;
  worktreePath: string;
}

const activeRuns = new Map<number, RunState>();

// Read from DB on each check — no stale cache.
function getMaxConcurrent(): number {
  const config = getDb().query<{ max_concurrent_agents: number }, []>(
    'SELECT max_concurrent_agents FROM agent_config WHERE id = 1'
  ).get();
  return config?.max_concurrent_agents ?? 3;
}
```

The concurrency limit is read from the `agent_config` table on every `startAgent()` call — a single-row primary-key lookup that's always in SQLite's page cache. No module-level constant to go stale.

The 409 response changes from "agent is busy" to "concurrency limit reached" when `activeRuns.size >= getMaxConcurrent()`. Starting an agent on a task that already has a run in progress still returns 409.

### Worktree Lifecycle

New module: `src/worktree/worktree.ts`

All git commands use `execFile` with an argv array — never string interpolation — to prevent shell injection from task keys.

```typescript
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export async function detectMainBranch(repoRoot: string): Promise<string> {
  // Try the remote HEAD symref first (most reliable for repos with a remote)
  try {
    const { stdout } = await git(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], repoRoot);
    const branch = stdout.trim().replace(/^origin\//, '');
    if (branch) return branch;
  } catch {}
  // Fall back to checking if common branch names exist
  for (const name of ['main', 'master']) {
    try {
      await git(['rev-parse', '--verify', name], repoRoot);
      return name;
    } catch {}
  }
  // Last resort: whatever HEAD points to
  try {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
    return stdout.trim() || 'main';
  } catch {
    return 'main';
  }
}

export async function createWorktree(taskKey: string, repoRoot: string, mainBranch: string): Promise<string> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);
  const branchName = `agent/${taskKey}`;

  // Clean up stale worktree and branch from previous runs.
  // Must remove worktree before branch — git refuses to delete a branch
  // that a worktree is checked out on.
  await git(['worktree', 'remove', worktreePath, '--force'], repoRoot).catch(() => {});

  // If the branch has unmerged commits (from a prior successful run the user
  // hasn't merged yet), rename it to preserve the work instead of deleting it.
  // Compare against mainBranch (not HEAD) to avoid false negatives when the
  // user is on a feature branch.
  const unmerged = await git(
    ['log', mainBranch+'..'+branchName, '--oneline'],
    repoRoot
  ).catch(() => ({ stdout: '' }));
  if (unmerged.stdout.trim()) {
    const timestamp = Date.now();
    await git(['branch', '-m', branchName, `${branchName}-prev-${timestamp}`], repoRoot).catch(() => {});
  } else {
    await git(['branch', '-D', branchName], repoRoot).catch(() => {});
  }

  await git(['worktree', 'add', worktreePath, '-b', branchName, mainBranch], repoRoot);

  // Initialize submodules if the repo uses them
  const gitmodulesPath = path.join(repoRoot, '.gitmodules');
  if (fs.existsSync(gitmodulesPath)) {
    await git(['submodule', 'update', '--init'], worktreePath);
  }

  return worktreePath;
}

export async function removeWorktree(taskKey: string, repoRoot: string): Promise<void> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);
  await git(['worktree', 'remove', worktreePath, '--force'], repoRoot).catch(() => {});

  // Branch is intentionally kept — it contains the agent's committed work.
  // The user merges or deletes it at their discretion.
}

// Check for uncommitted changes the agent left behind.
// Returns a warning message if changes exist, or null if the worktree is clean.
export async function checkUncommittedChanges(taskKey: string, repoRoot: string): Promise<string | null> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);

  const { stdout } = await git(['status', '--porcelain'], worktreePath).catch(() => ({ stdout: '' }));
  if (!stdout.trim()) return null;

  const fileCount = stdout.trim().split('\n').length;
  return `Agent left ${fileCount} uncommitted file(s) in the worktree. These will be lost when the worktree is removed.`;
}

export async function cleanupStaleWorktrees(repoRoot: string): Promise<void> {
  await git(['worktree', 'prune'], repoRoot);
}
```

The `.tasks_manager/worktrees/` directory is already gitignored (`.tasks_manager/` contains a self-ignoring `.gitignore`).

### Executor Changes

`startAgent()` modifications:

1. Check `activeRuns.size < getMaxConcurrent()` instead of `mutex.held`
2. Check `!activeRuns.has(taskId)` to prevent double-running the same task
3. **Insert into `activeRuns` immediately** (with `pid: null`, `worktreePath: ''`) before any async work. This prevents a race where two near-simultaneous requests for the same task both pass the `!activeRuns.has(taskId)` check before either inserts.
4. Call `createWorktree()` (passing the detected `mainBranch`)
5. Write `agent_worktree` and `agent_branch` to the task row (`UPDATE tasks SET agent_worktree = ?, agent_branch = ? WHERE id = ?`) — needed for crash recovery
6. Pass the worktree path as `workingDir` to the adapter
7. On completion/failure/cancel: the `finally` block in `executeAgent()` first calls `checkUncommittedChanges()` (this runs in all paths — success, failure, and cancellation, since it's in `finally`, not after the adapter call). If uncommitted files exist, it writes a warning to the task log and broadcasts it via SSE so it's visible in the log viewer. Then it calls `removeWorktree()`, clears `agent_worktree`/`agent_branch`, and deletes from `activeRuns`. The `finally` block is the single owner of cleanup — `cancelAgent` and `shutdownAllAgents` abort and await but never clean up directly
8. **Error rollback**: if `startAgent()` fails *after* `createWorktree()` but *before* `executeAgent()` fires (DB error, config missing, etc.), the outer catch block must call `removeWorktree()` and `activeRuns.delete(taskId)` to clean up

`cancelAgent()` modifications:

1. Look up the specific `RunState` from `activeRuns` by task ID instead of reading the global mutex
2. Check `!runState.cancelling` to determine if this caller is the first canceller (same logic as the current `isCanceller` check at `executor.ts:367`). Only the first canceller aborts and writes the "cancelled by user" log. Subsequent concurrent cancel calls just await the completion promise. This prevents duplicate cancel logs — tested explicitly in `executor.test.ts`.
3. Abort that specific run's `AbortController`
4. Await only that run's `completionPromise`
5. Does NOT call `removeWorktree` — cleanup is owned by `executeAgent`'s finally block

`shutdownAgent()` becomes `shutdownAllAgents()`:

1. `shutdownAllAgents()` is `async` and must be awaited by the shutdown handler
2. Iterate all entries in `activeRuns`: for each, atomically update only non-completed tasks using `UPDATE tasks SET agent_status = 'failed' WHERE id = ? AND agent_status != 'completed'` — this avoids a race where an agent finishes right as shutdown fires. No SELECT-then-UPDATE; a single conditional write.
3. Write shutdown log for each active run, then abort each run's `AbortController`
4. Await all completion promises with `Promise.allSettled` (not `Promise.all` — one worktree cleanup failure must not block the others). **All promises must resolve before `closeDb()` is called**, because each run's `finally` block accesses the DB
5. By the time `Promise.allSettled` resolves, all agent processes have exited (the adapter awaits process exit, and the `finally` block runs after). **PID polling is not needed** — `shutdownAllAgents` returns void, not PIDs. The current PID-polling loop in `index.ts:136–153` is replaced entirely by the `await shutdownAllAgents()` call.
6. The shutdown handler in `index.ts` must become async. Since `process.on('SIGINT')` does not await async callbacks, use an explicit pattern: set a flag to stop accepting requests, call `await shutdownAllAgents()`, then `closeDb()`, then `process.exit()`

`RunState` includes a `pid` field, initially `null`. The adapter sets it via a callback: add an `onPid?: (pid: number) => void` parameter to `CliAdapter.execute()`. The adapter calls `onPid(proc.pid)` after spawn (current `cli-adapter.ts:88`). The executor wires this in `executeAgent` to update `runState.pid`. This avoids the adapter needing to know about `RunState` while keeping the PID available for `shutdownAllAgents`.

**Cleanup ownership clarification:** `shutdownAllAgents` and `executeAgent`'s `finally` block both touch the DB and the `activeRuns` map, which looks like a conflict. The split is:
- `shutdownAllAgents` owns the **status writes** (`agent_status = 'failed'`, shutdown log) because these must happen synchronously before abort, while the DB is still open.
- `executeAgent`'s `finally` block owns **worktree cleanup** (`removeWorktree`) and removal from `activeRuns`. After the abort signal fires, the adapter throws, the finally block runs, cleans up the worktree, and resolves the completion promise.
- The `finally` block must tolerate the DB being in a "shutdown" state: its status-update code (which would normally write `completed` or `failed`) is already wrapped in a try/catch (current `executor.ts:301–303`). During shutdown, `shutdownAllAgents` already wrote the status, so the `finally` block's DB write is a harmless no-op or silently fails. The `removeWorktree` call and `activeRuns.delete` still execute.

`awaitCompletion()` becomes `awaitAllCompletions()`:

The current `awaitCompletion()` is exported and used in tests (`executor.test.ts:18`). Replace with:
```typescript
export async function awaitAllCompletions(): Promise<void> {
  await Promise.allSettled(
    [...activeRuns.values()].map(r => r.completionPromise)
  );
}
```

`ensureMutexReleased()` test helper must also be updated. The current helper at `executor.test.ts:9–26` calls `getMutexState()`, checks `.held`, and cancels a single task. Replace with a version that iterates `getRunnerState().runs` and cancels each, then awaits `awaitAllCompletions()`.

`getMutexState()` becomes `getRunnerState()`:

```typescript
export function getRunnerState(): RunnerState {
  return {
    activeCount: activeRuns.size,
    maxConcurrent: getMaxConcurrent(),
    runs: [...activeRuns.values()].map(r => ({ taskId: r.taskId, taskKey: r.taskKey })),
  };
}
```

### Prompt Changes

The current `buildPrompt(task: Task, workingDir: string)` is exported and has 7 unit tests in `executor.test.ts:44–108`. The signature changes to:

```typescript
export function buildPrompt(task: Task, opts: {
  workingDir: string;
  branchName?: string;      // e.g. "agent/PROJ-5"
  mainBranch?: string;      // e.g. "main"
  recentCommits?: string;   // output of `git log --oneline -10`
}): string
```

`branchName`, `mainBranch`, and `recentCommits` are optional so the function works in both worktree mode and legacy (non-git) mode. When present, the prompt includes branch context and git guidelines:

```
You are working in a git worktree at: {workingDir}
You are on branch: {branchName}
The main branch is: {mainBranch}

## Task: {task_key} — {title}

### Description
{description}

### Acceptance Criteria
{acceptance}

Please implement the changes needed to complete this task.

## Git Guidelines

- When you are done, commit your changes on this branch. Do not leave uncommitted files.
- If the task involves multiple distinct logical changes, use separate commits for each. Otherwise, a single commit is fine.
- Write clear commit messages: a short summary line (imperative mood), optionally followed by a blank line and a longer explanation of why the change was made.
- Match the commit message style used in this repo. Recent commits for reference:
```
{recentCommits}
```
```

**Conditional rendering rules:**
- The header lines (worktree path, branch, main branch) are only included when `branchName` is provided.
- Empty description/acceptance sections are stripped (same as current `buildPrompt`).
- The "Recent commits for reference" bullet and code fence are stripped when `recentCommits` is empty (e.g., brand-new repo with no commits).
- `## Git Guidelines` is rendered as an h2 (sibling of `## Task`, not nested under it) because it's meta-instructions for the agent, not part of the task specification.

**Legacy (non-git) mode:** When `branchName` is absent, the worktree header lines are omitted and the prompt uses `You are working in the repository at: {workingDir}`. The Git Guidelines section is still included (without the branch-specific line and without `recentCommits`) since legacy mode still runs in a git repo — the agent should still commit its work. Existing tests must be updated to pass `{ workingDir: '/repo' }` instead of a bare string — the signature changes from positional to options object.

The production call site at `executor.ts:145` (`buildPrompt(updatedTask, workingDir)`) must be updated. The `detectMainBranch` call and `buildPrompt` call should both happen inside `executeAgent` (the fire-and-forget async function), not in the `startAgent` preamble — `detectMainBranch` runs up to 4 git subprocesses and would add latency to the HTTP response if awaited in the preamble.

```typescript
// Inside executeAgent():
const mainBranch = await detectMainBranch(repoRoot);
const { stdout: recentCommits } = await git(['log', '--oneline', '-10'], repoRoot).catch(() => ({ stdout: '' }));
const prompt = buildPrompt(updatedTask, {
  workingDir: worktreePath,
  branchName: `agent/${task.task_key}`,
  mainBranch,
  recentCommits: recentCommits.trim(),
});
```
In legacy (non-git) mode, omit `branchName` and `mainBranch` but still pass `recentCommits` (the agent is still in a git repo and should follow commit conventions).

### What Happens to Finished Work

When an agent completes successfully, the work lives on branch `agent/<task-key>`. Three options for what the system does next, in order of increasing automation:

1. **Nothing (MVP)** — the branch exists. The user merges it however they want (`git merge`, PR, cherry-pick). The worktree is removed but the branch is kept.
2. **Auto-merge to main** — after the agent finishes, the system runs `git merge agent/<task-key>` on the main worktree. If it conflicts, mark the task as needing manual resolution.
3. **Open a PR** — if a GitHub remote is configured, use `gh pr create` from the worktree before cleanup.

Start with option 1. The branch name convention (`agent/<task-key>`) makes it easy to find and manage agent work.

### Database Changes

Add `max_concurrent_agents` to `agent_config` (not `project_config` — the config UI already reads/writes `agent_config` via `GET/PUT /agent-config`, so this avoids a second endpoint).

All new columns are added inside a `if (version < 2)` migration block, matching the existing pattern in `database.ts`:

```typescript
if (version < 2) {
  // Run each ALTER individually — ALTER TABLE in SQLite is implicitly committed
  // and can't be rolled back. If one fails, the others already applied.
  // Only set user_version after all succeed.
  db.exec(`ALTER TABLE agent_config ADD COLUMN max_concurrent_agents INTEGER NOT NULL DEFAULT 3`);
  db.exec(`ALTER TABLE tasks ADD COLUMN agent_worktree TEXT DEFAULT NULL`);
  db.exec(`ALTER TABLE tasks ADD COLUMN agent_branch TEXT DEFAULT NULL`);
  db.exec(`PRAGMA user_version = 2`);
}
```

### Type Definitions

Add to `types.ts`:

```typescript
// Extend Task
agent_worktree: string | null;
agent_branch: string | null;

// Extend AgentConfig
max_concurrent_agents: number;

// New export
export interface RunnerState {
  activeCount: number;
  maxConcurrent: number;
  runs: Array<{ taskId: number; taskKey: string }>;
}
```

### Crash Recovery Changes

`recovery.ts` currently sweeps tasks with `agent_status = 'running'` and kills orphaned PIDs. The current recovery is **synchronous** (`Bun.sleepSync` for PID polling). Worktree cleanup must match: use `Bun.spawnSync` (not async `execFile`) for git commands during recovery.

Changes:

1. Run worktree prune **unconditionally** at startup, before checking for orphaned tasks. Use `Bun.spawnSync({ cmd: ['git', 'worktree', 'prune'] })`. This catches worktrees orphaned by a crash that happened *after* `git worktree add` but *before* writing `agent_worktree` to the DB.
2. For each recovered task where `agent_worktree` is non-null: if the path exists on disk, run `Bun.spawnSync({ cmd: ['git', 'worktree', 'remove', path, '--force'] })`. Wrap each task's worktree cleanup in its own try/catch so one failure doesn't abort recovery for the remaining tasks — matching the existing per-task pattern in `recovery.ts`.
3. Update the recovery SQL to clear the new columns:
   ```sql
   UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL,
     agent_worktree = NULL, agent_branch = NULL WHERE id = ?
   ```
4. Agent branches (`agent/<task-key>`) are intentionally left behind — they may contain committed work the user hasn't merged yet.

### API Changes

| Change | Details |
|---|---|
| `POST /tasks/:id/agent/start` | Returns 409 only if this specific task is already running OR concurrency limit is reached. Response body distinguishes the two cases. The route in `agent-control.ts` (error handler at line 22) forwards `err.busyTaskKey` from the executor — after the executor uses the new error shape, verify the destructuring doesn't drop unknown properties. |
| `POST /tasks` (with `run=true`) | Currently calls `getMutexState()` at `tasks.ts:72` to pre-check the mutex before creating a task. Must switch to `getRunnerState()` and check both `activeCount < maxConcurrent` and `!runs.some(r => r.taskId === ...)`. |
| `PATCH /tasks/:id` (status → in-progress) | This route at `tasks.ts:217` calls `startAgent()` directly when the status changes to `in-progress`. The executor handles the concurrency check, but the route's error handler at `tasks.ts:223` forwards `err.busyTaskKey` in the old 409 shape — must update to the new `{ reason, ... }` format. |
| `GET /status` | Add `activeRuns` and `maxConcurrentAgents` to the response so the frontend knows capacity |
| `GET /agent-config` | Already exposes `agent_config` fields — `max_concurrent_agents` comes along for free after the migration |
| `PUT /agent-config` | Accept `max_concurrent_agents` updates (validated: integer 1–10) |

**409 response shape changes:**

The current `{ error: string, busyTaskKey: string }` format is used in `executor.ts:72`, `tasks.ts:76`, `tasks.ts:223` (PATCH to in-progress), and forwarded in `agent-control.ts:22`. Replace with:

```typescript
// When the specific task is already running
{ error: "AWSM-3 is already running", reason: "task_already_running", taskKey: "AWSM-3" }

// When concurrency limit is reached
{ error: "Concurrency limit reached (3/3 running)", reason: "concurrency_limit", activeRuns: [...] }
```

### SSE Changes

No structural changes to the broadcaster. It already supports multiple concurrent `task:log` streams — each event includes `taskId` so the frontend can route logs to the right panel.

`agent:status` events already carry `taskId`, so multiple running tasks are distinguishable.

**Store sync via SSE:** The `agent:status` handler in `useEventSource.ts` (line 37–48) currently only uses status changes to trigger log run separators. It must also update the `activeRuns` array in the Zustand store:
- On `status: 'running'` → add `{ taskId, taskKey }` to `activeRuns`
- On `status: 'completed'` or `status: 'failed'` → remove the entry with matching `taskId` from `activeRuns`

**Backend change required:** The current `agent:status` broadcasts (at `executor.ts:127`, `:250`, `:262`, `:295`, `:418`) only include `{ taskId, status }` — they do not include `taskKey`. Add `taskKey` to the `agent:status` payload so the frontend can populate `activeRuns` entries.

**`stale` event handling:** The `stale` SSE handler calls `fetchTasks()` which refreshes the task list but not `activeRuns`. After the refactor, the `stale` handler must also re-fetch runner state (call `GET /status` and update `activeRuns` + `maxConcurrentAgents` in the store), otherwise `activeRuns` goes stale after a reconnect.

This keeps the store in sync without polling.

### Frontend Changes

**Board:**
- Multiple cards in the "In Progress" column can have running spinners simultaneously.
- The 409 toast message changes from "agent is busy with X" to either "X is already running" or "concurrency limit reached (3/3 running)".
- Note: `TaskCard.tsx` already has no global busy check on play buttons — it only hides the button for the individual running task and relies on the server 409 for concurrency enforcement. No change needed there.

**Task Detail:**
- `TaskDetail.tsx` has `isAnyAgentBusy = tasks.some(t => t.agent_status === 'running')` which globally disables the Run Agent button. Replace with: `disabled={activeRuns.length >= maxConcurrentAgents || task.agent_status === 'running'}`.

**Agent Config:**
- Add a "Max Concurrent Agents" number input (1–10, default 3) in the advanced section.

**Zustand Store:**
- The current store has no `agentBusy` or `busyTaskKey` fields — busy state is derived inline via `tasks.some(t => t.agent_status === 'running')` in components.
- Add `activeRuns: Array<{ taskId: number; taskKey: string }>` and `maxConcurrentAgents: number` to the store, populated from the `GET /status` response and `agent:status` SSE events.
- `checkStatus()` in `useTaskStore.ts` (which calls `GET /status`) must be updated to parse and store the new `activeRuns` and `maxConcurrentAgents` fields from the response. Without this, `activeRuns` starts empty on page load and agents already running are invisible to the concurrency gate until the first SSE event arrives.
- The "can start agent" check becomes: `activeRuns.length < maxConcurrentAgents && task.agent_status !== 'running'`.

### Git Edge Cases

| Scenario | Handling |
|---|---|
| Branch `agent/<key>` already exists (with unmerged work) | `createWorktree` checks for unmerged commits via `git log <mainBranch>..agent/<key>` (comparing against the main branch, not HEAD, to avoid false negatives when the user is on a feature branch). If commits exist, the old branch is renamed to `agent/<key>-prev-<timestamp>` to preserve the work. If no unmerged commits, the branch is deleted and recreated. |
| Worktree creation fails (not a git repo) | Return 400 with "This directory is not a git repository. Parallel execution requires git." Fall back to single-agent mode. |
| Agent doesn't commit its work | After the agent exits, the executor runs `checkUncommittedChanges()`. If uncommitted files exist, a warning is written to the task log and broadcast via SSE (e.g., "Agent left 3 uncommitted file(s) in the worktree. These will be lost when the worktree is removed."). The worktree is then removed as normal. The system does not auto-commit — the agent may have intentionally left files uncommitted (build artifacts, temp files). If this warning appears frequently, the user should adjust their agent config or prompt. |
| Two tasks modify the same files on different branches | No conflict during execution. Conflict surfaces at merge time, which is the user's responsibility (option 1 above). |
| Dirty working tree in main repo | Worktree creation works fine — `git worktree add` creates from the specified main branch, ignoring unstaged changes in the main worktree. |
| Submodules | `git worktree add` does not initialize submodules by default. Add `git submodule update --init` after worktree creation if `.gitmodules` exists. |

### Non-Git Repos

The current system works in any directory. Worktree-based parallelism requires git.

Detection: at startup, run `git rev-parse --git-dir` in `process.cwd()`. Store the result in a module-level `isGitRepo: boolean`. This runs once, not per-request.

If not a git repo, keep the current single-mutex behavior. Log an info message at startup: "Parallel agents require a git repository. Running in single-agent mode." The `startAgent` code path branches on `isGitRepo`:
- `true` → worktree mode (create worktree, `Map<number, RunState>`, concurrency cap from DB)
- `false` → legacy mode (same `Map<number, RunState>` but `getMaxConcurrent()` returns 1, no `createWorktree`/`removeWorktree` calls, agent runs in `process.cwd()` directly)

`MutexState` is deleted entirely — legacy mode uses the same `Map` data structure with a hard cap of 1. `getRunnerState()` returns `maxConcurrent: 1` in legacy mode.

### Dependencies in Worktrees

A worktree gets a fresh working tree but does not share `node_modules/` or other installed dependencies. If the agent needs to build or run tests, each worktree needs its own dependencies.

Options:

1. **Symlink `node_modules`** — after worktree creation, symlink `<worktree>/node_modules` to the main repo's `node_modules`. Fast, zero disk cost. Works for flat dependency trees (most projects). Breaks if the agent runs `npm install` or modifies dependencies.
2. **Run install in worktree** — after worktree creation, run the project's install command (detect `bun.lockb`/`package-lock.json`/`yarn.lock`). Correct but slow for large projects and duplicates disk usage.
3. **Do nothing (MVP)** — most agent tasks edit source files, not dependencies. If an agent needs to install deps, it can do so itself. The prompt doesn't prohibit it.

Start with option 3. If agents frequently fail because of missing deps, add a configurable "post-worktree-create" hook (a shell command that runs in the worktree after creation).

### Lowering Concurrency at Runtime

If the user lowers `max_concurrent_agents` (e.g., from 3 to 1) while agents are running, existing runs continue until they finish. The new limit applies only to future starts. No running agents are killed.

## Implementation Order

1. **Schema migration** — add `max_concurrent_agents`, `agent_worktree`, `agent_branch` columns. Must come first because the executor refactor queries `max_concurrent_agents`.
2. **`worktree.ts` module** — create/remove/prune/detectMainBranch functions with tests
3. **Non-git detection** — run `git rev-parse --git-dir` at startup, store `isGitRepo` flag. This must exist before the executor refactor so `startAgent` can branch on it.
4. **Executor refactor** — replace single mutex with `Map<number, RunState>` + semaphore, wire in worktree creation (gated on `isGitRepo`), update all helper functions, update `buildPrompt` caller
5. **Crash recovery update** — clean up worktrees on startup
6. **Route updates** — adjust 409 responses, expose concurrency info in `/status`
7. **Frontend** — update store, `checkStatus()` parsing, SSE handlers, stale event, remove global busy gate, add concurrency config UI
8. **Prompt update** — include branch context, ask agent to commit

## Risks

- **Disk usage**: each worktree duplicates the working tree (not the `.git` objects). For a 500MB repo, 3 worktrees add ~1.5GB. Worth documenting the tradeoff.
- **Agent compatibility**: some agents may not handle being in a worktree gracefully (e.g., if they hardcode paths or check for `.git` directory). The `.git` file in a worktree points to the main repo's `.git/worktrees/<name>`, which most tools handle fine.
- **SQLite from worktrees**: the database lives in `.tasks_manager/` in the main repo root, not in the worktree. The agent should not be accessing the database directly, but if it does, the path won't resolve from the worktree `cwd`. This is actually a feature — agents shouldn't touch the task DB.
- **Merge conflicts**: deferred to the user. The system creates branches but doesn't merge them automatically in v1. Users who run unrelated tasks won't see conflicts. Users who run overlapping tasks will deal with them at merge time, same as human developers on separate branches.
- **Partial commits on failed runs**: if an agent makes commits on its branch and then fails (crash, timeout, non-zero exit), those commits persist on the `agent/<task-key>` branch. This is by design — partial work is often useful. The branch is clearly labeled and the task shows as failed, so there's no ambiguity.
- **Untracked files missing in worktrees**: `git worktree add` creates the worktree from the main branch, so only committed files exist. Gitignored files like `.env`, local config, or untracked agent config files won't be present. Tracked config files (`.crush.json`, `AGENTS.md`, `.cursorrules`) will be there. If users depend on untracked files, they'll need to handle this — either commit the files, or use the post-worktree-create hook described in "Dependencies in Worktrees."
