# Custom Workflow Steps

## Problem

The board has three hardcoded columns: Todo, In Progress, Done. Every project gets the same workflow. But real projects vary — some need a "Code Review" step between development and done, others want a "Planning" phase before the agent starts coding. There's no way to customize this without changing source code.

## Goal

Let users build a custom workflow by picking from a catalog of predefined steps. The board always starts with Todo and ends with Done — those are fixed. Everything in between is configurable. Every step runs the agent; a per-step `requires_review` toggle controls whether the task auto-advances or pauses for human approval.

## Decisions

### Backlog
Stays as a special status, separate from the board workflow. It's a parking lot for ideas, not part of the active pipeline.

### Fixed columns
**Todo** and **Done** are permanent. They can't be removed, reordered, or renamed. Todo is always first, Done is always last. The "workflow" is the sequence of steps between them.

### Predefined step catalog
Users don't type free-text step names. They pick from a fixed list of predefined steps, each with a slug that matches its display name. No renaming. The catalog is defined in code — adding new options is a code change, not a DB operation.

### Step behavior

Every workflow step runs the agent. Each step has a `requires_review` boolean (configurable per step by the user) that controls what happens after the agent finishes:

- **`requires_review: false`** — the task auto-advances to the next step on success.
- **`requires_review: true`** — the task stays put. The user reviews the agent's output and clicks "Approve & Continue" to advance, or "Send Back" to return the task to a previous step.

### Step catalog

| Slug | Display Name | Default requires_review | Description |
|---|---|---|---|
| `planning` | Planning | true | Breaks down the task, drafts acceptance criteria, identifies affected files. |
| `development` | Development | false | Implements the task — writes code, runs tests, fixes issues. Auto-advances on success. |
| `visual-qa` | Visual QA | true | Opens the app in a browser, explores the UI, and reports visual or functional issues. |
| `open-prs` | Open PRs | false | Creates pull request(s) for the agent's work. Auto-advances on success. |

This catalog covers a realistic software workflow: **Planning → Development → Code Review → Visual QA → Open PRs**. Users can pick any subset and reorder as needed. The simplest workflow is just **Development** (one step, mirrors current behavior).

### Agent trigger steps
Every workflow step triggers the agent when a task enters it. The `requires_review` setting only affects what happens after the agent finishes — it doesn't change whether the agent runs.

### Step deletion with tasks
When a user removes a step that has tasks in it, show a dialog: "N tasks are in this step. Move them to: [dropdown of remaining steps]." The user picks where they go.

Deleting the last remaining workflow step is blocked — the minimum is 3 total columns (Todo + 1 workflow step + Done).

### Default workflow
During project init, the user picks their workflow steps. The init wizard shows the predefined catalog and lets the user select which steps to include and in what order. Default suggestion: just "Development" (mirrors current single-step behavior, for users who want to get going fast). This step appears after the prefix/agent config steps — workflow selection is low-stakes and easily changed later.

### Step count limits
- Minimum: 3 total columns (Todo + at least one workflow step + Done)
- Maximum: 10 total columns

### Task advancement
- **Step completes successfully (requires_review: false)** → task auto-advances to the next step. If the next step also doesn't require review, the agent starts again (chaining). The chain stops at a step with `requires_review: true` or at Done.
- **Step completes successfully (requires_review: true)** → task stays. User reviews, then clicks "Approve & Continue" to advance to the next step, or "Send Back" to return the task to a previous step. If the next step is a workflow step, the agent starts automatically on advance.
- **Any step fails** → task stays in the current step with `agent_status='failed'`. User clicks a "Retry" button to re-run the agent on the same step, or drags the task elsewhere.
- **Last workflow step completes** → task moves to Done (auto-advance if `requires_review: false`, after approval if `requires_review: true`).

### Buttons

Three task action buttons replace the current "Run Agent" button:

| Button | Visible when | Action |
|---|---|---|
| **Start Workflow** | Task is in `todo` | Moves the task to the first workflow step and starts the agent. |
| **Retry** | Task is in a workflow step with `agent_status = 'failed'` | Re-runs the agent on the current step (new run_number). |
| **Approve & Continue** | Task is in a step with `requires_review: true` and `agent_status = 'completed'` | Advances the task to the next step. The agent starts on the next step. |
| **Send Back** | Task is in a step with `requires_review: true` and `agent_status = 'completed'` | Opens a dropdown to pick which previous step to return the task to. The agent restarts there. |

"Start Workflow" only appears on `todo` tasks. It does not appear on tasks already mid-workflow — those use Retry (on failure) or drag-and-drop (to reposition). "Approve & Continue" and "Send Back" appear together in the TaskDetail panel (not on the compact TaskCard).

### Drag-and-drop
Users can drag a task to any column, not just the next one. Dragging to any workflow step starts the agent. Dragging away from a step while the agent is running triggers the existing cancellation confirmation dialog.

For boards with many columns (6+), dragging across the full width becomes impractical due to horizontal scrolling. The "Send Back" dropdown and the ability to change status from TaskDetail (via a step picker) provide alternatives that don't require dragging.

### Status in the database
`tasks.status` stores the step slug as a string (e.g., `'code-review'`, `'development'`). The predefined catalog guarantees unique, stable slugs. The existing CHECK constraint on `tasks.status` gets dropped — validation moves to the application layer.

---

## Design

### Database

New table:

```sql
CREATE TABLE workflow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  requires_review INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`requires_review` controls whether the task pauses for human review after the agent finishes. User-configurable — the catalog provides a default, but users can toggle it per step.

`config` is a JSON column holding step-specific options. Each step defines its own config schema in the catalog (see below). The backend validates incoming config against the catalog schema. The agent receives the resolved config as specific instructions in the prompt.

`todo`, `done`, and `backlog` are NOT rows in this table. They're hardcoded statuses that exist outside the workflow. The table only holds the configurable steps between Todo and Done.

Migration (version 3, after the parallel-agents v2 migration):

```sql
-- 1. Create workflow_steps table
CREATE TABLE workflow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  requires_review INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed with default step only if existing tasks use 'in-progress' status
INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order)
  SELECT 'in-progress', 'In Progress', 0, '{}', 1.0
  WHERE EXISTS (SELECT 1 FROM tasks WHERE status = 'in-progress');

-- 3. Recreate tasks table without the status CHECK constraint.
--    Must disable foreign keys first — task_logs references tasks(id).
--    Must recreate the tasks_updated_at trigger (dropped with the old table).
--    Must include all columns from v1 + v2 migrations.
PRAGMA foreign_keys = OFF;

ALTER TABLE tasks RENAME TO tasks_old;

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) <= 200),
  description TEXT DEFAULT '' CHECK (length(description) <= 5000),
  acceptance TEXT DEFAULT '' CHECK (length(acceptance) <= 5000),
  status TEXT NOT NULL DEFAULT 'backlog',
  sort_order REAL NOT NULL DEFAULT 0,
  agent_status TEXT CHECK (agent_status IN ('running', 'completed', 'failed')),
  agent_pid INTEGER,
  agent_started_at TEXT,
  run_number INTEGER NOT NULL DEFAULT 0,
  agent_worktree TEXT DEFAULT NULL,
  agent_branch TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tasks SELECT * FROM tasks_old;
DROP TABLE tasks_old;

-- Recreate the trigger (lost when the old table was dropped)
CREATE TRIGGER tasks_updated_at
  AFTER UPDATE ON tasks
  FOR EACH ROW
  BEGIN
    UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
  END;

PRAGMA foreign_keys = ON;

-- 4. Bump version
PRAGMA user_version = 3;
```

Note on foreign keys: SQLite resolves FK references by table name at query time, not at table creation time. After renaming `tasks` → `tasks_old` and creating the new `tasks`, the FK on `task_logs` resolves to the new table. Disabling `foreign_keys` during the swap prevents FK enforcement from blocking the `DROP TABLE tasks_old` (which cascades deletes would fire on).

Note on existing data: existing projects keep `in-progress` as their workflow step slug. `in-progress` is not in the new catalog (replaced by `development`), but it works — the system reads active steps from `workflow_steps`, not from the catalog. Legacy `in-progress` steps continue to function. If the user removes it, they'd add `development` from the catalog instead.

### Predefined Step Catalog

Defined in code as a constant:

```typescript
export const STEP_CATALOG = [
  {
    slug: 'planning',
    name: 'Planning',
    requiresReview: true,
    description: 'Breaks down the task, drafts acceptance criteria, identifies affected files.',
    configSchema: [
      { key: 'planLocation', label: 'Plan file location', type: 'string', default: 'doc/plans/' },
      { key: 'trackInGit', label: 'Commit plan file', type: 'boolean', default: true },
    ],
  },
  {
    slug: 'development',
    name: 'Development',
    requiresReview: false,
    description: 'Implements the task — writes code, runs tests, fixes issues.',
    configSchema: [],
  },
  {
    slug: 'visual-qa',
    name: 'Visual QA',
    requiresReview: true,
    description: 'Opens the app in a browser, explores the UI, and reports visual or functional issues.',
    configSchema: [],
  },
  {
    slug: 'open-prs',
    name: 'Open PRs',
    type: 'agent' as const,
    description: 'Creates pull request(s) for the agent\'s work.',
    configSchema: [
      { key: 'draft', label: 'Create as draft PR', type: 'boolean', default: false },
    ],
  },
] as const;
```

Each catalog entry includes:
- `requiresReview` — default value for whether the step pauses for human review. Users can toggle this per step.
- `description` — shown in the workflow settings and init wizard.
- `configSchema` — defines the configurable options for the step. Each option has a `key`, display `label`, `type` (`string`, `boolean`, `number`, or `select`), and `default` value. `select` options also have an `options` array of allowed values. Steps with no options have an empty array.

**Config defaults are written to the DB at step creation time** — when a user adds a step via `POST /workflow-steps`, the backend populates the `config` column with each `configSchema` entry's default value, and `requires_review` with the catalog's `requiresReview` default. Users can change both after creation.

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/workflow-steps` | List active steps (sorted by sort_order) |
| POST | `/workflow-steps` | Add a step from the catalog (slug, position). Returns 400 if slug not in catalog or already active. Returns 400 if adding would exceed 10 total columns. |
| PATCH | `/workflow-steps/:id` | Reorder a step (change sort_order) or update its config |
| DELETE | `/workflow-steps/:id` | Remove a step (body includes `move_tasks_to` slug). Returns 400 if this is the last workflow step (minimum 1 required). |
| GET | `/workflow-steps/catalog` | Return the full predefined catalog with which steps are already active |

The `/workflow-steps` response includes `requires_review` and description so the frontend knows which steps pause for review.

### Status Validation

Valid statuses for a task are: `backlog`, `todo`, `done`, plus whatever slugs exist in `workflow_steps`. The backend caches this list on startup and invalidates when steps change.

```typescript
function getValidStatuses(): string[] {
  const steps = db.query<{ slug: string }, []>(
    'SELECT slug FROM workflow_steps ORDER BY sort_order'
  ).all();
  return ['backlog', 'todo', ...steps.map(s => s.slug), 'done'];
}
```

### Executor Changes

**Status-setting ownership:** Currently `startAgent()` both sets `status = 'in-progress'` and starts the agent. After the refactor, the **caller** (route handler or auto-advance logic) sets the status, and `startAgent()` only starts the agent. `startAgent()` receives the target step slug and validates it's a workflow step, but doesn't write the status — that's already done before `startAgent()` is called.

**Review file loading:** Before calling `buildPrompt()`, the executor reads all review files matching `.tasks_manager/reviews/{task_key}-*.md`, parses the step name and run number from the filename, reads the content, and passes them as the `reviewFiles` array. This happens for every step, not just Development.

```typescript
function isWorkflowStep(slug: string): boolean {
  const step = db.query<{ id: number }, [string]>(
    'SELECT id FROM workflow_steps WHERE slug = ?'
  ).get(slug);
  return !!step;
}

function stepRequiresReview(slug: string): boolean {
  const step = db.query<{ requires_review: number }, [string]>(
    'SELECT requires_review FROM workflow_steps WHERE slug = ?'
  ).get(slug);
  return step?.requires_review === 1;
}
```

When a task moves to a workflow step, the agent starts. After the agent finishes, the executor checks `requires_review` to decide whether to auto-advance or wait.

**`handleAgentResult()` changes:** currently hardcodes `status = 'done'`. New logic depends on step type:

```typescript
function getStepInfo(slug: string): { type: string; sort_order: number; config: string } | null {
  return db.query<{ type: string; sort_order: number; config: string }, [string]>(
    'SELECT type, sort_order, config FROM workflow_steps WHERE slug = ?'
  ).get(slug);
}

function getNextStep(currentSlug: string): string {
  const current = getStepInfo(currentSlug);
  if (!current) return 'done';

  const next = db.query<{ slug: string }, [number]>(
    'SELECT slug FROM workflow_steps WHERE sort_order > ? ORDER BY sort_order LIMIT 1'
  ).get(current.sort_order);

  return next?.slug ?? 'done';
}
```

On agent completion:
1. Check the current step's `requires_review`.
2. If `requires_review: false` → auto-advance to `getNextStep()`. If next step is a workflow step, start the agent again (chaining).
3. If `requires_review: true` → stay put. Set `agent_status = 'completed'`. Task waits for user action.

**sort_order in target column:** When auto-advancing, the task needs a `sort_order` in the target column. Use the same pattern as the current `handleAgentResult`: query `MAX(sort_order)` for the target status and add 1. This places the task at the bottom of the target column.

### Auto-advance Chaining

**The concurrency slot problem:** `handleAgentResult()` runs inside `executeAgent()`'s async closure, before the `finally` block that cleans up `activeRuns`. If it calls `startAgent()` for the next step, the current task's slot is still occupied — the task would fail with "task already running."

**Solution:** Auto-advance chaining does NOT call `startAgent()` from within `handleAgentResult()`. Instead:

1. `handleAgentResult()` writes the new status to DB and returns a `{ nextAction: 'chain', nextSlug: string }` result (or `{ nextAction: 'done' }` / `{ nextAction: 'wait-for-review' }`).
2. The `executeAgent()` function reads this result after the adapter finishes.
3. The `finally` block cleans up the current run's `activeRuns` entry and worktree.
4. **After** the `finally` block, if the result was `chain`, `executeAgent()` calls `startAgent()` for the next step. The old slot is already freed, so no deadlock.

```typescript
async function executeAgent(taskId: number, stepSlug: string, ...) {
  let chainResult: { nextSlug: string } | null = null;
  try {
    // ... run adapter ...
    const result = handleAgentResult(task, stepSlug, ...);
    if (result.nextAction === 'chain') {
      chainResult = { nextSlug: result.nextSlug };
    }
  } finally {
    // Clean up: remove from activeRuns, remove worktree, etc.
    activeRuns.delete(taskId);
    await removeWorktree(...);
  }

  // Chain AFTER cleanup — slot is freed
  if (chainResult) {
    startAgent(taskId, chainResult.nextSlug).catch(err => {
      // Concurrency limit reached — task stays in current step.
      // Log the stall so it's visible in the task log.
      writeTaskLog(taskId, `Auto-advance to ${chainResult.nextSlug} delayed: ${err.message}`);
    });
  }
}
```

If `startAgent()` fails due to concurrency limits, the task stays in the step it was moved to (the status was already written by `handleAgentResult`). The user sees the task in the right column with no running agent. They can retry manually, or the system can retry when a slot frees up (v2 improvement — not designed here).

Each agent run in a chain is independent — it gets its own `run_number`, its own concurrency slot, and its own worktree.

### Prompt Changes

`buildPrompt()` needs to know which step the agent is executing. At minimum, the step name and description are included so the agent understands its role:

```typescript
export function buildPrompt(task: Task, opts: {
  workingDir: string;
  stepName?: string;        // e.g. "Code Review"
  stepDescription?: string; // e.g. "Reviews code changes for bugs..."
  stepType?: string;        // 'agent' or 'agent-review'
  stepConfig?: Record<string, unknown>; // e.g. { planLocation: 'doc/plans/', trackInGit: true }
  reviewFiles?: Array<{ stepName: string; runNumber: number; content: string }>;
  branchName?: string;
  mainBranch?: string;
  recentCommits?: string;
}): string
```

The prompt template includes:

```
## Step: {stepName}
{stepDescription}

### Step Configuration
{rendered config instructions}

## Task: {task_key} — {title}
...
```

The step config is rendered as specific instructions for the agent. For example, a Planning step with `{ planLocation: 'doc/plans/', trackInGit: true }` produces:

```
### Step Configuration
- Save the plan as a markdown file in `doc/plans/`
- Commit the plan file to git
```

Each step type has a config-to-prompt renderer that translates the JSON config into natural language instructions. Steps with no config (empty `{}`) skip this section entirely. This keeps the prompt clean while giving users control over step behavior without writing prompt templates.

The renderers live in a dedicated module (`executor/step-config.ts`) — a single `renderStepConfig(slug: string, config: Record<string, unknown>): string[]` function that returns an array of instruction lines. It dispatches by slug with a switch-case. This keeps all config-to-prompt logic in one place, close to `buildPrompt()`. The executor calls `getStepInfo()` (which now returns `config`) and passes the parsed config to `buildPrompt()`.

### Step Review Files

`agent-review` steps produce findings that other steps need to see. These are persisted as markdown files in `.tasks_manager/reviews/` **in the main repo root** (not inside the worktree), named `{task_key}-{step_slug}-run{n}.md` (e.g., `PROJ-5-code-review-run1.md`). The directory is inside `.tasks_manager/` which already has a self-ignoring `.gitignore`, so review files are never committed to the repo.

**Writing:** The prompt for `agent-review` steps includes an instruction to write findings using an **absolute path** to the main repo's `.tasks_manager/reviews/`:

```
Write your findings to {absolute_path_to_repo}/.tasks_manager/reviews/{task_key}-{step_slug}-run{run_number}.md.
```

The executor resolves the absolute path and inserts it into the prompt. This is necessary because the agent runs in a worktree (a different directory), and review files must persist outside the worktree so they survive worktree removal on failure and are accessible to future steps running in different worktrees.

Each run produces a separate file — nothing gets overwritten. The executor creates `.tasks_manager/reviews/` if it doesn't exist before starting the agent.

**Reading:** When *any* step starts (not just Development), `buildPrompt()` scans `.tasks_manager/reviews/{task_key}-*.md` **in the main repo root**, sorts by filename (which sorts chronologically due to the run number), and includes all found files in the prompt:

```
## Feedback from previous steps

### Code Review (run 1)
[contents of PROJ-5-code-review-run1.md]

### Visual QA (run 1)
[contents of PROJ-5-visual-qa-run1.md]

### Code Review (run 2)
[contents of PROJ-5-code-review-run2.md]
```

This means every step has full context of all prior review feedback — the Development agent sees Code Review and Visual QA findings, and the Visual QA agent can check whether Code Review issues were fixed.

For v1, all review files are included regardless of age. If prompt bloat becomes a problem (many review rounds), a future optimization can trim to only the most recent run per step, or only files written after the task's last run on the current step.

**`agent` steps do not write review files** — they produce code, not findings. Only `agent-review` steps include the write instruction in their prompt.

**Cleanup:** When a task moves to `done`, all review files matching `{task_key}-*` are deleted from `.tasks_manager/reviews/`. They've served their purpose — no further steps will read them. This cleanup is triggered from a shared helper function called by both the route handler (for user-driven moves to `done` via drag, "Approve & Continue", etc.) and `handleAgentResult()` / `executeAgent()` (for auto-advance to `done` when the last step is an `agent` type). Similarly, when a task is deleted via `DELETE /tasks/:id`, the same cleanup runs — review files for deleted tasks should not linger on disk.

If a done task is re-opened (moved back to a workflow step), review files are already gone — the agent starts fresh.

### Transition Rules

The current rule "can't move back to backlog from in-progress or done" changes to:

- Can always move to `todo` (sending back to the board start).
- Can always move to `backlog` from `todo`. Cannot move to `backlog` from any workflow step or `done`.
- Can move from `done` to `todo` or any workflow step (re-opening a task). Cannot move from `done` to `backlog`.
- Can move to any workflow step or `done` from any other workflow step or `todo`.
- Moving to a workflow step starts the agent. Moving away from a step while the agent is running triggers cancellation.
- When a task moves to `todo` or `backlog`, `agent_status` is reset to `null`.

### Frontend Changes

**Board columns** — instead of the hardcoded `COLUMNS` array, the board reads from the Zustand store:

```typescript
const columns = [
  { id: 'todo', title: 'Todo', type: 'fixed' },
  ...workflowSteps.map(s => ({ id: s.slug, title: s.name, type: s.type })),
  { id: 'done', title: 'Done', type: 'fixed' },
];
```

**Step review toggle** — each step in the workflow settings has a "Pause for review" toggle switch. Users can enable/disable review per step.

**Task action buttons** — see the Buttons section above. "Approve & Continue" and "Send Back" appear in TaskDetail. The TaskCard shows a review-needed badge for tasks awaiting approval.

**StatusBadge** — currently has hardcoded colors for `backlog`, `todo`, `in-progress`, `done`. Needs a dynamic color lookup: workflow steps get colors assigned from a palette based on their position or type, with a fallback for unknown slugs.

**Workflow settings** — a settings panel (accessible from the board header or project settings) where users:
- See the current workflow as an ordered list with step descriptions
- Add steps from the predefined catalog (grayed out if already active)
- Remove steps (with the task-relocation dialog if tasks exist)
- Reorder steps via drag-and-drop
- See which steps are `agent` vs `agent-review`
- Configure step options via a gear icon per step (only shown for steps that have `configSchema` entries). Opens an inline form with the step's configurable fields.

**Column header config** — columns for steps with config options show a small gear icon in the header. Clicking it opens the step's config form (same as in workflow settings). This gives quick access without leaving the board.

**Mobile board layout** — the current board stacks columns vertically on small screens (`max-sm:flex-col`). With 5+ columns this becomes an endless vertical scroll. Replace with horizontal snap-scrolling: one column visible at a time, swipe left/right to navigate. A dot indicator at the bottom shows total columns and current position. Adjacent columns peek at the edges to communicate "there's more."

```css
@media (max-width: 640px) {
  .board {
    scroll-snap-type: x mandatory;
    overflow-x: auto;
  }
  .column {
    scroll-snap-align: start;
    min-width: 100%;
  }
}
```

This keeps the spatial left-to-right model of the board intact — users build a mental map of column positions, which matters when the workflow has 5+ steps. Pure CSS, no JS needed for the core behavior.

**Init wizard** — during project setup, after picking the task prefix, the user picks their workflow steps from the catalog. Default selection: just "Development." This is the last step of the wizard.

### SSE

New event type: `workflow:updated` — broadcast when steps are added, removed, or reordered. All connected clients refresh their column layout.

No other SSE changes. `task:updated` already carries the full task object with its status slug.

---

## Files Requiring Changes

### Backend

| File | Changes |
|---|---|
| `db/database.ts` | Migration v3: create `workflow_steps` table, recreate `tasks` without CHECK, recreate trigger, handle FK pragma |
| `types.ts` | `Task.status` becomes `string`. Add `WorkflowStep` type. `TaskStatus` type becomes `string`. |
| `executor/executor.ts` | `startAgent()` takes step slug, doesn't set status itself. `handleAgentResult()` returns chain instruction. `executeAgent()` handles chaining after cleanup. `buildPrompt()` gets step context params + review files. Loads review files from `.tasks_manager/reviews/` before building prompt. Creates reviews dir if missing. |
| `routes/tasks.ts` | Replace hardcoded `validStatuses` with `getValidStatuses()`. Replace `status === 'in-progress'` checks with `isWorkflowStep()`. Update transition rules. Update sort_order calculation for auto-advance. |
| `routes/agent-control.ts` | `POST /tasks/:id/agent/start` — pass step slug to `startAgent()`, set status before calling it |
| `routes/init.ts` | Add `POST /init/save-workflow` endpoint for persisting workflow step selections during init |
| `index.ts` | Register new `/workflow-steps` route module (`app.route(...)`) |
| `recovery.ts` | No status-based changes needed (recovery checks `agent_status`, not `status`). Mention in plan for completeness. |
| `sse/broadcaster.ts` | Add `workflow:updated` event type |
| New: `routes/workflow-steps.ts` | CRUD routes for workflow step management |
| New: `executor/step-config.ts` | Config-to-prompt renderers — `renderStepConfig(slug, config)` returns instruction lines per step type. For `agent-review` steps, includes instruction to write findings to `.tasks_manager/reviews/{task_key}-{step_slug}-run{n}.md`. |

### Frontend

| File | Changes |
|---|---|
| `components/Board.tsx` | Replace `COLUMNS` with store-driven columns. Update `handleDragEnd` to accept any workflow slug (remove hardcoded status array guard). Update cancellation check from `=== 'in-progress'` to `isWorkflowStep()`. Mobile: replace `max-sm:flex-col` with horizontal snap-scroll. |
| `components/TaskCard.tsx` | "Run Agent" quick button (currently `status === 'todo'` only) → "Start Workflow". Add review-needed badge. |
| `components/TaskDetail.tsx` | Replace hardcoded action buttons with dynamic buttons (Start Workflow, Retry, Approve & Continue, Send Back). Replace hardcoded `StatusBadge` colors with dynamic lookup. |
| `components/Backlog.tsx` | `handleRunNow` sends first workflow step slug instead of `'in-progress'`. |
| `hooks/useTaskStore.ts` | `Task.status` type becomes `string`. Add `workflowSteps` array to store. Add actions for fetching/updating workflow steps. |
| `api/client.ts` | Add `getWorkflowSteps()`, `addWorkflowStep()`, `removeWorkflowStep()`, `reorderWorkflowStep()`, `getWorkflowCatalog()` |
| `hooks/useEventSource.ts` | Handle `workflow:updated` event |
| `components/Column.tsx` | Accept step `type`, `description`, and config props. Render type indicator icon, description tooltip, and gear icon for configurable steps. |
| `components/Sidebar.tsx` | Add workflow settings entry point (new nav item or extend existing settings). |
| `components/InitWizard.tsx` | Add workflow step selection as final wizard step. Catalog picker UI with default pre-selected. |
| `components/CreateTaskModal.tsx` | "Create & Run" flow sends first workflow step slug instead of hardcoded `'in-progress'`. |
| New: `components/WorkflowSettingsModal.tsx` | Workflow step management UI with per-step config forms |

### Tests

All test files with hardcoded status values need updating. Key files:
- `executor/executor.test.ts` — status assertions, `buildPrompt` tests
- `db/database.test.ts` — task creation with statuses
- `routes/routes.test.ts` — status transition tests (these need the most rework — new transition rules)
- Frontend test files: `Board.test.tsx`, `Backlog.test.tsx`, `TaskDetail.test.tsx`, `TaskCard.test.tsx`

Test setup helpers that insert tasks with hardcoded statuses need to seed `workflow_steps` first.

---

## Implementation Order

1. **Predefined catalog constant** — define `STEP_CATALOG` in both packages (small enough to duplicate).
2. **Database migration (v3)** — create `workflow_steps` table, seed default, recreate `tasks` table without status CHECK, recreate trigger, handle FK pragma.
3. **Backend types** — update `Task.status` to `string`, add `WorkflowStep` interface.
4. **Backend: workflow-steps routes + SSE** — CRUD for managing active steps with validation (catalog membership, min/max count, duplicate prevention). Broadcast `workflow:updated` on changes. Register route in `index.ts`.
5. **Backend: status validation refactor** — replace hardcoded status arrays with `getValidStatuses()` DB lookups.
6. **Backend: executor refactor** — decouple status-setting from `startAgent()`, implement `getNextStep()`, add chaining logic after cleanup in `executeAgent()`, update `buildPrompt()` with step context. Create `executor/step-config.ts` for config-to-prompt renderers.
7. **Backend: transition rules** — update status change logic in task routes, replace `'in-progress'` checks with `isWorkflowStep()`.
8. **Backend: tests** — update all backend tests for new status model, seed `workflow_steps` in test setup.
9. **Frontend: types + store + API** — update `Task` type, add workflow steps to Zustand store, add API client methods.
10. **Frontend: dynamic board columns** — replace `COLUMNS` constant, update drag-and-drop handlers, update status guards.
11. **Frontend: task action buttons** — Start Workflow, Retry, Approve & Continue, Send Back. Dynamic StatusBadge colors.
12. **Frontend: workflow settings UI** — add/remove/reorder steps from catalog.
13. **Frontend: tests** — update all frontend tests.
14. **Init wizard update** — add workflow step selection as last wizard step (frontend `InitWizard.tsx` + backend `init.ts`).

## Risks

- **Table recreation migration** — recreating `tasks` to drop the CHECK constraint risks data loss if it fails mid-migration. The entire rename/create/copy/drop sequence runs inside a transaction with `PRAGMA foreign_keys = OFF`. The trigger and all columns (including v2's `agent_worktree`/`agent_branch`) must be explicitly recreated. Test with a populated DB before shipping.
- **Auto-advance concurrency stalls** — after an `agent` step completes and the task is moved to the next step, `startAgent()` may fail if all concurrency slots are full. The task sits in the next step with no running agent. For v1, this is logged and the user retries manually. A retry-on-slot-free mechanism is a v2 improvement.
- **Agent prompt per step** — v1 includes the step name and description in the prompt, which gives the agent basic context. This is enough for "Development" vs "Code Review" but may not be enough for nuanced steps. Step-specific prompt templates are a future addition.
- **Legacy `in-progress` slug** — existing projects keep `in-progress` as their workflow step. It's not in the new catalog, so removing it is a one-way door (they'd add `development` instead). This is fine — the step functions identically.
- **Board width with many columns** — 6+ columns trigger horizontal scrolling. Drag-and-drop across the full width is impractical. The "Send Back" dropdown and TaskDetail step picker provide non-drag alternatives. Worth capping at a lower max (6-7) if usability testing shows problems with 10.

## Future: Self-Review Loops

See [SELF-REVIEW-LOOPS.md](./SELF-REVIEW-LOOPS.md) for the full plan.

A follow-up feature that builds on this infrastructure: `agent` and `agent-review` steps gain a `selfReviewRounds` config option (integer 0–3). When set to N, the executor runs the agent in a loop: action → review → fix, up to N times, before the step completes. The loop short-circuits early if a review finds no issues (`NO_ISSUES_FOUND` sentinel). An aggregate step timeout (capped at 2 hours) prevents unbounded runtime.

This requires:
- Extracting `runAdapter()` from inline adapter code so it can be called multiple times
- Per-round prompt switching (action, review, fix) within a single step
- Per-round log separation via `info`-level separator lines
- Loop state management in the executor (current round, total rounds)
- Short-circuit check after each review sub-round
- Interaction with cancellation (cancel mid-loop) and failure (fail on which round?)
- Self-review findings written to `.tasks_manager/reviews/` (with `run{n}` in filename), excluded from downstream "Feedback from previous steps" prompts since they're internal to the step

The current plan's architecture supports this: the executor already handles step-aware prompts, review file I/O, and chaining. The loop adds an inner loop inside `executeAgent()` before `handleAgentResult()` runs. The step config system (`configSchema` with `number` type) can express `selfReviewRounds` without schema changes.
