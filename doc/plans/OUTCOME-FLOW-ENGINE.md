> ⚠️ **Superseded by [REMOVE-READY-STATE.md](./REMOVE-READY-STATE.md)** for task queue semantics. This record retains the original Backlog/Ready design.

# Outcome-Driven Flow Engine

> **Status:** Implemented July 2026.
>
> **Supersedes:** [CUSTOM-WORKFLOW.md](./CUSTOM-WORKFLOW.md) in full; the task lifecycle, workflow, executor, event, and board portions of [ARCHITECTURE.md](./ARCHITECTURE.md); and the run ownership, recovery, and cleanup portions of [PARALLEL-AGENTS.md](./PARALLEL-AGENTS.md).

## Decision Summary

Replace the ordered Kanban workflow with a versioned graph. A task runs through one active execution path. Blocks emit named outcomes, and connections route those outcomes to the next block.

The first release has six canvas blocks:

- **Begin** starts a run.
- **Agent** invokes the configured CLI agent.
- **Check** runs a deterministic project command.
- **Decision** waits for a human choice.
- **Result** ends the run with a business outcome.
- **Note** documents the canvas and never executes.

Feedback cycles are allowed when every cycle passes through a Decision. Parallel branches, joins, general rules, timers, and integrations are deferred.

This is a clean replacement. Existing tasks, logs, workflow steps, and database contents will not be migrated. The application will use a new schema baseline and reject databases from the previous schema family with a clear reset instruction.

The repository, CLI adapter, process management, worktree creation, project initialization, styling, and test setup remain useful. The workflow domain, executor, task-state semantics, worktree ownership, and workflow UI are replaced.

## Goals

- Let a user build repository-work flows by dragging blocks and connecting named outcomes.
- Make execution durable across concurrency pressure and server restarts.
- Separate task planning state from run and block execution state.
- Preserve failed, interrupted, paused, and cancelled workspaces until the user decides what to do.
- Record every block visit as a separate attempt so feedback loops have an exact history.
- Keep the first runtime sequential while leaving room for forks and joins later.
- Share graph types and validation between frontend and backend.
- Make deterministic checks first-class rather than asking an agent to infer their result from prose.

## Non-Goals

- Migrating the current SQLite database or preserving existing tasks and logs.
- Running several branches of the same run at once.
- Joining parallel branches.
- Routing from arbitrary agent stdout.
- General expression evaluation or a Condition block.
- Timers, schedules, webhooks, or external triggers.
- Per-block model or CLI-provider selection.
- Automatic retries of blocks with side effects.
- Enforcing declared block permissions at the operating-system level.
- Mobile-first graph authoring.

## Product Vocabulary

| Term             | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| **Task**         | The desired result, such as fixing a bug or adding a feature.                   |
| **Flow**         | A reusable graph that describes how work proceeds.                              |
| **Flow version** | An immutable published snapshot of a Flow.                                      |
| **Run**          | One Task executing against one Flow version.                                    |
| **Block**        | A configured unit on the canvas.                                                |
| **Attempt**      | One visit to a Block during a Run. Re-entering a Block creates another Attempt. |
| **Outcome**      | The named result emitted by a Block.                                            |
| **Connection**   | A route from one Block outcome to another Block.                                |
| **Workspace**    | The repository checkout or worktree used by the Task.                           |
| **Result**       | An intentional terminal conclusion for the Task.                                |

Avoid using `step` for new domain APIs because it implies a total order. Avoid using `status` without a qualified noun such as `runStatus` or `attemptStatus`.

## Execution Model

The runtime is an outcome-driven state machine:

```text
Task + Flow version + Workspace
             |
             v
            Run
             |
             v
Block Attempt -> Outcome -> Connection -> Next Block Attempt
```

Version one permits one active Attempt per Run. Each emitted Outcome has at most one connected target. A future fork can allow several targets without changing the meaning of an Attempt or Connection.

Entering a Block creates an Attempt. An Attempt is never reused. A retry or feedback loop creates another Attempt for the same Block ID.

An unhandled operational outcome does not finish the Task. It places the Run in Needs Attention. For example, an Agent failure with no connected `failed` outcome waits for the user to retry or stop the Run.

## Task and Operational State

A Task does not store the current Block. It stores only planning and resolution state:

```typescript
type TaskQueueState = "backlog" | "ready";
type TaskResolution = "open" | "completed" | "cancelled";
```

The main work view derives its buckets from the Task and latest Run:

| View                | Rule                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| **Backlog**         | Task is open, queue state is `backlog`, and no Run is active.             |
| **Ready**           | Task is open, queue state is `ready`, and no Run needs display elsewhere. |
| **Active**          | Latest Run is queued or running.                                          |
| **Needs Attention** | Latest Run is waiting for a Decision, failed, timed out, or interrupted.  |
| **Finished**        | Task resolution is completed or cancelled.                                |

Users may drag Tasks between Backlog and Ready and reorder Tasks within those views. The engine owns Active and Needs Attention. A Result or explicit task action controls Finished.

Starting a Run changes an open Task to Ready if necessary. Reaching a Completed Result resolves the Task. A Paused Result or user stop returns the open Task to Ready and retains its Workspace.

## Run and Attempt State

```typescript
type RunStatus = "queued" | "running" | "waiting" | "attention" | "finished" | "stopped";

type AttemptStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "interrupted"
  | "cancelled";
```

`finished` means the Run reached a Result. The Result category determines the Task resolution. `stopped` means the Run ended without resolving the Task.

Each Attempt records its parent Attempt, incoming Connection, emitted Outcome, timestamps, process identity when applicable, and structured result data. The current execution position is derived from nonterminal Attempts. It is not stored on the Task.

Only one nonterminal Run is allowed per Task. Enforce this with a partial unique index and a transaction in the start-run operation.

## Block Contracts

Every executable Block implements a shared backend contract:

```typescript
interface BlockHandler<TConfig, TResult> {
  execute(input: BlockExecutionInput<TConfig>): Promise<BlockExecutionResult<TResult>>;
}

interface BlockExecutionResult<TResult> {
  outcomeId: string;
  result?: TResult;
}
```

The engine, rather than a handler, owns persistence, transitions, cancellation state, scheduling, and event publication. Handlers own the work needed to produce one valid Outcome.

Every node includes `typeVersion`. Publishing rejects types or versions the runtime does not understand.

### Begin

- Exactly one per Flow.
- No incoming Connections.
- One `started` outcome with exactly one target.
- No configuration and no execution slot.
- Creates a succeeded Attempt and advances immediately.

### Agent

Agent presets in the first release:

- Planning
- Development
- Visual QA
- Open PR
- Custom

Presets are configuration templates, not Block types. An Agent Block stores the preset key, preset configuration, additional instructions, and effect level.

Stable outcomes:

- `completed`
- `failed`
- `timed_out`

`completed` must be connected. Failure and timeout Connections are optional. If absent, the Run enters Attention.

The published version stores a compiled execution specification alongside the editable definition. The compiler resolves preset defaults and prompt instructions at publish time. Later changes to a built-in preset do not alter an in-flight or previously published Run.

Agent stdout is a log stream. It is not parsed to select an outcome.

### Check

A Check runs one trusted project command in the Workspace.

Configuration includes:

- Display name.
- Command.
- Working directory relative to the Workspace.
- Timeout.
- Optional environment entries with secret values excluded from Flow JSON.

Stable outcomes:

- `passed`
- `failed`
- `error`
- `timed_out`

`passed` and `failed` must be connected. Error and timeout Connections are optional and otherwise place the Run in Attention.

Commands use the existing safe command parsing and argv execution path. Shell interpretation is not implicit. A user who needs shell features must configure an explicit shell command.

### Decision

A Decision waits for the local user. It has between one and five configured choices. Each choice has:

- Stable ID.
- Label.
- Optional description.
- Whether a comment is required.
- Visual tone: neutral, positive, warning, or destructive.

Every choice must be connected. Selecting a choice and creating the next Attempt happen in one transaction. Repeating the same request is idempotent; a later conflicting choice returns 409.

The selected comment is stored on the Attempt and included in the next Agent prompt when that Agent is reached through the chosen Connection.

### Result

A Result has no outgoing Connections. It has a custom name and one system category:

| Category    | Effect                                                                         |
| ----------- | ------------------------------------------------------------------------------ |
| `completed` | Resolve the Task as completed.                                                 |
| `paused`    | Finish the Run, leave the Task open and Ready, retain the Workspace.           |
| `cancelled` | Resolve the Task as cancelled and retain the Workspace until explicit cleanup. |

Failure is not a Result category. Infrastructure and Agent failures put a Run in Attention unless the graph routes them deliberately.

### Note

A Note stores text, size, position, and color. It has no handles, does not participate in validation reachability, and never creates an Attempt.

## Outcomes, Connections, and Cycles

Connections originate at a named Outcome port. Each Outcome has zero or one target in version one.

Feedback cycles are valid only when every cycle contains at least one Decision. A practical validator removes Decision nodes and verifies that the remaining executable graph is acyclic.

Valid:

```text
Development -> Check -> Decision -> Development
```

Invalid:

```text
Development -> Check -> Development
```

The engine also caps immediate automatic transitions in one advancement call at 100. Reaching the cap puts the Run in Attention with a configuration error rather than recursing indefinitely.

## Flow Definition and Publishing

Use a discriminated TypeScript union shared by frontend and backend. A simplified persisted document is:

```typescript
interface FlowDefinition {
  schemaVersion: 1;
  nodes: FlowNode[];
  connections: FlowConnection[];
  viewport?: { x: number; y: number; zoom: number };
}

interface FlowConnection {
  id: string;
  sourceNodeId: string;
  sourceOutcomeId: string;
  targetNodeId: string;
}
```

Node and Connection IDs are client-generated UUIDs. IDs need only be unique inside the Flow. Cloning a version preserves IDs for nodes that still represent the same logical Block.

Draft saves use optimistic concurrency with an integer `draftRevision`. A stale update returns 409 and does not overwrite the newer draft.

Publishing performs full validation, compiles every executable Block, and creates an immutable Flow version. Editing a published Flow creates or updates its draft. Runs always pin a published version.

### Publish Validation

- The graph is within the limits of 200 nodes and 400 Connections.
- Node, Outcome, and Connection IDs are unique in their scope.
- There is exactly one Begin and at least one Result.
- Begin has no input and its `started` Outcome has one target.
- Agent `completed` and Check `passed` and `failed` Outcomes are connected.
- Every Decision choice is connected and has a distinct, non-empty label.
- Result and Note nodes have no outgoing Connections.
- Every executable node is reachable from Begin.
- Every executable node has at least one path to a Result.
- Every automatic cycle is rejected; cycles that contain a Decision are accepted.
- All target nodes and source Outcomes exist.
- Each Block configuration passes its versioned schema.
- Relative workspace paths do not escape the Workspace root.
- The compiler can resolve every Agent preset.

Drafts may be incomplete. The editor displays validation problems continuously, but only publishing is blocked.

## Fresh Database Baseline

There is no legacy data migration. Replace the current migration chain with a fresh schema for new databases.

Add an application identity record:

```text
schema_family = outcome-flow
schema_version = 1
```

If a non-empty database does not contain this identity, startup stops with an explanation that the previous `.tasks_manager/tasks.db` must be moved or deleted. The application never deletes an unknown database automatically.

Continue using forward-only migrations after this baseline.

### Core Tables

`tasks`

- Identity, task key, title, description, and acceptance criteria.
- Queue state and resolution.
- One `sort_order` scoped to the Task's current Backlog or Ready view. Returning a Task to Ready appends it to that view.
- Created and updated timestamps.

`flows`

- Stable Flow identity and name.
- Default flag.
- Active published version ID.
- Created and updated timestamps.

`flow_versions`

- Flow ID and monotonically increasing version number.
- State: draft, published, or archived.
- Draft revision.
- Editable definition JSON.
- Compiled execution JSON for published versions.
- Created and published timestamps.
- At most one draft per Flow.

`runs`

- Task, Flow version, and Workspace IDs.
- Status and terminal Result category.
- Stop or attention reason.
- Created, started, and finished timestamps.
- Partial unique index preventing two nonterminal Runs for one Task.

`attempts`

- Run, Block, parent Attempt, and incoming Connection IDs.
- Attempt sequence and per-Block attempt number.
- Status and emitted Outcome ID.
- Structured result JSON and Decision comment.
- PID, process start time, and timestamps where applicable.
- Indexes by Run sequence and status.

`workspaces`

- Task ID, repository root, worktree path, and branch.
- State: active, retained, cleanup-required, removed, or orphaned.
- Last-known dirty state and timestamps.
- One active or retained Workspace per Task in version one.

`logs`

- Task, Run, and Attempt IDs.
- Timestamp, level, and message.
- Index by Attempt and monotonically increasing ID.
- Buffered writes remain, but an Attempt ID is always present for new execution logs.

`events`

- Global monotonic ID.
- Topic, entity type, entity ID, and payload JSON.
- Created timestamp.
- Written in the same transaction as the state change it announces.

Keep `agent_config` and `project_config`, adjusting their fields to the new semantics. Rename the concurrency setting to `max_concurrent_executions` because Agent and Check processes both use the execution pool.

## Persistent Scheduler

SQLite is the execution source of truth. The in-memory map only holds operating-system processes that this server currently owns.

The scheduler:

1. Finds queued Attempts whose Runs are still active.
2. Claims an Attempt with a conditional transaction.
3. Starts the matching handler when capacity is available.
4. Records the PID and start time.
5. Completes the Attempt and creates the next Attempt in one transaction.
6. Pumps the queue again after capacity is released.

Call the scheduler on startup, after any transition, after configuration changes, and from a low-frequency safety interval. Do not recursively call the executor to advance a Run.

Begin and Result are advanced synchronously without taking a process slot. Decision waits without taking a process slot. Agent and Check share `max_concurrent_executions`.

In a non-git repository, the concurrency limit is forced to one because all Tasks share the repository directory.

## Transition Transactions and Races

State transitions use compare-and-set updates. A transition succeeds only if the Attempt and Run are still in the expected state.

Required race behavior:

- Two start requests create one Run; the repeated request returns the existing active Run.
- Two identical Decision submissions return the same recorded choice.
- Conflicting Decision submissions return 409.
- A stop request persists intent before aborting the process.
- Agent completion cannot overwrite a persisted stop request.
- A scheduler cannot claim an Attempt twice.
- Completion and next-Attempt creation cannot be separated by a crash.
- Retrying creates a new Attempt and never rewrites the failed Attempt.
- Publishing cannot overwrite a draft saved from another tab.

## Interruption and Recovery

On startup:

1. Prune Git's stale worktree registrations without removing valid task worktrees.
2. Find Attempts recorded as running.
3. Verify PID identity using both PID and process start time.
4. Kill matching orphaned process groups.
5. Mark their Attempts interrupted and Runs as Attention.
6. Retain their Workspaces unchanged.
7. Resume queued Attempts.
8. Leave waiting Decisions untouched.

Interrupted Attempts are never retried automatically. The process may have changed files before it died.

Shutdown first stops accepting new work, persists stop intent for owned processes, aborts them, waits for process completion, flushes logs, and only then closes SQLite.

## Workspace Lifecycle

A Workspace belongs to a Task and may be reused by several Runs. In Git mode it uses branch `agent/<task-key>` and the current worktree location.

Rules:

- Create or reuse the Workspace when a Run first needs an executable Block.
- Agent, Check, Decision, failure, timeout, stop, and interruption do not remove it.
- Retry and a later Run reuse it.
- A Completed Result checks whether the Workspace is clean.
- A clean Workspace may be removed according to project cleanup settings.
- A dirty Workspace becomes cleanup-required and is retained.
- A Cancelled or Paused Result retains the Workspace.
- Branch deletion is always explicit unless the system has verified that every branch commit exists on a configured remote.
- Deleting a Task with a retained or dirty Workspace requires a specific confirmation.
- No cleanup path uses `git worktree remove --force` against a dirty Workspace without explicit user approval.

The UI exposes Workspace state, path, branch, last dirty check, and actions to inspect, retain, or discard it.

## Prompt and Context Construction

An Agent prompt includes:

- Workspace path, branch, and main branch.
- Task title, description, and acceptance criteria.
- Compiled Block instructions.
- The Decision comment on the incoming Connection, when present.
- Relevant structured artifacts produced by prior Attempts on the executed path.
- A short run-path summary with Block names and Outcomes.

Do not include the full stdout of earlier Agents by default. It is available in logs and can grow without bound.

Block results may write typed facts and artifacts:

```typescript
interface FlowArtifact {
  kind: "plan" | "report" | "file";
  path: string;
  includeInCommit?: boolean;
  producingAttemptId: number;
}
```

Open PR instructions derive commit exclusions from artifacts produced on the path that actually executed. They do not scan every Block in the Flow.

## Side Effects and Retry Policy

Executable Blocks declare an effect level:

```typescript
type EffectLevel = "read_only" | "workspace_write" | "external_write";
```

The editor and Run view display this level. Version one uses it for warnings and retry confirmation; it does not claim operating-system enforcement.

- Read-only Blocks may be retried with a simple confirmation.
- Workspace-write Blocks warn that the previous Attempt may have left partial changes.
- External-write Blocks require a stronger confirmation because they may push commits or create duplicate external resources.
- There are no automatic retries in version one.

The Open PR Agent preset is `external_write`. A future dedicated GitHub integration should replace it with an idempotent operation.

## Events and SSE

State mutations insert an `events` row in the same transaction. SSE streams these persisted events.

Initial topics:

- `task.updated`
- `task.deleted`
- `flow.updated`
- `flow.published`
- `run.updated`
- `attempt.updated`
- `attempt.log`
- `workspace.updated`
- `toast`

`Last-Event-ID` refers to the persisted global event ID, so IDs survive a server restart. Retain a bounded recent window, such as 10,000 events. If a client requests an older event, emit `stale` and make it refetch Tasks, active Runs, default Flow metadata, and runner capacity.

The Run, Attempt, and log tables remain the audit history. Pruning delivery events does not remove execution history.

## API Surface

All mutating operations return the updated resource and use structured error reasons.

### Flows

| Method | Path                           | Purpose                                                          |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/flows`                       | List Flows and their active published versions.                  |
| POST   | `/flows`                       | Create a Flow with Begin and Result defaults.                    |
| GET    | `/flows/:id`                   | Get Flow metadata and its current draft or published definition. |
| PUT    | `/flows/:id/draft`             | Save the whole draft with an expected revision.                  |
| POST   | `/flows/:id/validate`          | Return structured validation errors without publishing.          |
| POST   | `/flows/:id/publish`           | Validate, compile, and publish an immutable version.             |
| GET    | `/flows/:id/versions/:version` | Read a published version.                                        |
| PUT    | `/flows/:id/default`           | Make a Flow the default for new Runs.                            |

The first UI manages one default Flow, while the schema and API permit more than one.

### Tasks and Runs

| Method | Path                   | Purpose                                                             |
| ------ | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/tasks`               | List Tasks with derived operational state and active Run summary.   |
| POST   | `/tasks`               | Create a Task in Backlog or Ready.                                  |
| PATCH  | `/tasks/:id`           | Update Task content, queue state, resolution, or sort order.        |
| DELETE | `/tasks/:id`           | Delete an inactive Task after Workspace safety checks.              |
| POST   | `/tasks/:id/runs`      | Start the default or selected published Flow.                       |
| GET    | `/tasks/:id/runs`      | List the Task's Run history.                                        |
| GET    | `/runs/:id`            | Get Run state, Attempts, selected path, and Workspace summary.      |
| POST   | `/runs/:id/stop`       | Stop a nonterminal Run and return the open Task to Ready.           |
| POST   | `/attempts/:id/retry`  | Create a new Attempt for a failed, timed-out, or interrupted Block. |
| POST   | `/attempts/:id/decide` | Select one Decision outcome with optional comment.                  |
| GET    | `/attempts/:id/logs`   | Page logs for one Attempt.                                          |

### Workspaces and Runner

| Method | Path                    | Purpose                                                |
| ------ | ----------------------- | ------------------------------------------------------ |
| GET    | `/workspaces/:id`       | Inspect Workspace state and last dirty check.          |
| POST   | `/workspaces/:id/check` | Refresh Git cleanliness information.                   |
| DELETE | `/workspaces/:id`       | Remove a safe Workspace or explicitly discard it.      |
| GET    | `/runner`               | Return capacity, owned processes, and queued Attempts. |

## Frontend Information Architecture

Primary navigation:

- **Work**: operational Task views.
- **Flows**: graph editor and published-version history.
- **Settings**: Agent, concurrency, project, and cleanup configuration.

### Work View

Use fixed Backlog, Ready, Active, Needs Attention, and Finished views. These may appear as columns on wide screens and compact tabs or sections on narrow screens.

Cards show Task key, title, operational state, active Block name, Flow version, and Workspace warning. Only Backlog and Ready support drag-and-drop movement. Active and Needs Attention are controlled through explicit actions.

### Flow Editor

Use `@xyflow/react` for canvas mechanics. Its official API supports typed custom nodes, custom outcome handles, and connection validation, which match this editor's requirements: [custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [TypeScript usage](https://reactflow.dev/learn/advanced-use/typescript), and [connection validation](https://reactflow.dev/examples/interaction/validation).

Editor layout:

```text
+-------------------------------------------------------------+
| Flow name       Draft v5      Validate       Publish         |
+-------------+-----------------------------------+-----------+
| Block       |                                   | Inspector |
| palette     |              Canvas               |           |
|             |                                   |           |
+-------------+-----------------------------------+-----------+
| Validation problems / save state                            |
+-------------------------------------------------------------+
```

- The palette contains Agent, Check, Decision, Result, and Note. Begin is created automatically.
- Blocks use custom React components with named outcome handles.
- The inspector edits the selected Block rather than placing large forms inside nodes.
- Autosave writes the draft with a debounced optimistic-revision request.
- Publish is explicit and disabled while validation errors exist.
- Deleting a connected outcome requires confirmation and removes its Connection atomically in draft state.
- Undo and redo cover local canvas edits before the next successful save.
- Keyboard users can add a Block from the palette, select it in an outline, edit it in the inspector, and connect outcomes through a target selector. Canvas dragging is not the only authoring path.
- The desktop editor is the supported authoring surface for version one. Small screens get a read-only graph and version summary.

### Run View

Task detail includes:

- A read-only graph with the selected execution path and active Block indicated.
- An Attempt timeline that preserves repeated visits to the same Block.
- Attempt-scoped logs.
- Decision choices and comment form.
- Retry, stop, and Workspace actions with effect-aware confirmation.
- Flow version and terminal Result details.

The graph shows attempt counts on repeated nodes. The timeline, rather than the graph alone, is the exact historical record.

### Initialization

The initialization wizard keeps Agent configuration and task-prefix setup. Replace the ordered workflow selector with a default-Flow choice:

- Start from the recommended software-development Flow.
- Start from a minimal `Begin -> Development Agent -> Completed Result` Flow.
- Create an empty valid Flow containing Begin and Result.

## Default Flow

The recommended Flow created during initialization is:

```text
Begin
  |
  v
Planning Agent <--------------------------+
  |                                       |
  v                                       |
Plan Decision -- changes requested -------+
  |
  | approved
  v
Development Agent <-----------------------+
  |                                       |
  v                                       |
Test Check -- failed --> Test Failure Decision
  |                         |             |
  |                         | retry ------+
  |                         |
  |                         +-- pause --> Paused Result
  |
  | passed
  v
Final Decision -- changes requested ------+
  |
  | approved
  v
Open PR Agent
  |
  v
Completed Result
```

Open PR failure and timeout are initially unconnected and therefore enter Needs Attention. The user can edit the draft to route them to a Decision later.

## Backend Structure

Create a shared workspace package:

```text
packages/flow-core/
  package.json
  src/types.ts
  src/catalog.ts
  src/schema.ts
  src/validation.ts
  src/compiler.ts
  src/traversal.ts
  src/index.ts
```

`flow-core` has no Bun, database, filesystem, or React dependencies.

Backend additions:

```text
packages/backend/src/flow/
  engine.ts
  scheduler.ts
  transitions.ts
  prompt.ts
  recovery.ts
  handlers/agent.ts
  handlers/check.ts
  handlers/decision.ts
  handlers/result.ts

packages/backend/src/routes/
  flows.ts
  runs.ts
  attempts.ts
  workspaces.ts
  runner.ts
```

Reuse the CLI adapter behind the Agent handler. Refactor worktree functions behind a Workspace service. The old executor and workflow utilities are not imported into the new engine.

## Frontend Structure

```text
packages/frontend/src/flow/
  types.ts
  editor/FlowEditor.tsx
  editor/BlockPalette.tsx
  editor/BlockInspector.tsx
  editor/ValidationPanel.tsx
  editor/nodes/BeginNode.tsx
  editor/nodes/AgentNode.tsx
  editor/nodes/CheckNode.tsx
  editor/nodes/DecisionNode.tsx
  editor/nodes/ResultNode.tsx
  editor/nodes/NoteNode.tsx
  run/RunGraph.tsx
  run/AttemptTimeline.tsx
  run/DecisionPanel.tsx
  run/WorkspacePanel.tsx
```

Import Flow unions and validation results from `@tasks-manager/flow-core`. Frontend-only types describe selection, viewport, undo state, and inspector forms.

## Removal Scope

Delete the old workflow implementation once the new vertical path works:

- Backend workflow step catalog, configuration renderer, utilities, routes, and executor.
- Frontend duplicated step catalog, Workflow Editor, and Workflow Settings modal.
- Dynamic workflow columns and status-based agent triggers.
- `requires_review`, workflow slugs, and task-level agent process fields.
- Tests whose only purpose is to preserve ordered-step behavior.

Retain and adapt:

- CLI adapter and process-tree cancellation.
- Worktree creation and Git helpers.
- Hono server, lock, initialization, and graceful shutdown.
- Buffered log writing.
- SSE connection transport.
- Task CRUD fields and task-key generation.
- Frontend theme, toasts, API wrapper, global store, and task forms.

## Implementation Plan

Each phase includes its tests. Do not postpone test updates to a later cleanup phase.

### Phase 1: Shared Flow Core

1. Add the `@tasks-manager/flow-core` workspace package.
2. Define the discriminated node union, Outcomes, Connections, Flow definition, compiled definition, and validation error format.
3. Add the Agent preset catalog and versioned configuration schemas.
4. Implement structural validation, reachability, path-to-Result checks, Decision-gated cycle validation, and graph limits.
5. Implement compilation of editable Agent presets into immutable execution specifications.
6. Add unit tests for valid and invalid graphs, including feedback loops and malformed outcome handles.

**Exit condition:** A complete Flow can be constructed, validated, compiled, serialized, and read without backend or frontend code.

### Phase 2: Fresh Persistence Model

1. Replace database initialization with the new schema baseline and schema-family guard.
2. Add repository modules for Tasks, Flows, Runs, Attempts, Workspaces, logs, and events.
3. Make each state transition and its event insertion transactional.
4. Add the one-active-Run-per-Task constraint and indexes for scheduler and log queries.
5. Update test database helpers to create only the new schema.
6. Add database tests for constraints, immutable published versions, optimistic draft revisions, and event ordering.

**Exit condition:** State can be persisted and recovered without any workflow-step table or legacy task status.

### Phase 3: Engine and Scheduler

1. Implement start, advance, stop, decide, retry, and complete transitions with compare-and-set writes.
2. Implement the persisted queue and capacity-aware scheduler.
3. Add injectable fake handlers for deterministic engine tests.
4. Implement immediate Begin and Result advancement with the automatic-transition cap.
5. Add Agent and Check process handlers using the shared cancellation contract.
6. Move PID ownership from Task to Attempt.
7. Add process-safe shutdown and startup recovery.
8. Test concurrency saturation, duplicate claims, completion-versus-stop races, restart interruption, queued resumption, and waiting Decision preservation.

**Exit condition:** A Flow can execute end to end through fake handlers and real short-lived Check commands, survive restart simulation, and never strand a queued Attempt.

### Phase 4: Workspace and Prompt Semantics

1. Wrap worktree creation and inspection in a Workspace service.
2. Reuse valid task worktrees across Attempts and Runs.
3. Preserve Workspaces on failure, stop, timeout, and interruption.
4. Block automatic removal of dirty Workspaces and expose cleanup-required state.
5. Build Agent prompts from the compiled Block, incoming Decision, executed path, and typed artifacts.
6. Add effect-aware retry confirmation metadata.
7. Test dirty, clean, missing, corrupt, Git, and non-Git Workspace cases.

**Exit condition:** No automatic failure or recovery path can discard uncommitted work.

### Phase 5: APIs and Persistent Events

1. Add Flow draft, validation, publication, version, and default-selection endpoints.
2. Replace status-based Task transitions with queue-state and resolution updates.
3. Add Run, Attempt, Decision, retry, stop, Workspace, and runner endpoints.
4. Stream persisted events through SSE and implement Last-Event-ID replay.
5. Update initialization endpoints to create the new default Flow.
6. Add route tests for validation failures, stale draft revisions, idempotent Decisions, structured conflicts, and Workspace safeguards.

**Exit condition:** The complete runtime can be controlled through HTTP without importing the old workflow routes.

### Phase 6: Flow Editor

1. Add `@xyflow/react` and typed custom node unions.
2. Build the canvas, Block palette, inspector, outcome handles, and connection validation.
3. Add draft autosave, optimistic conflict handling, validation display, publish, and version readback.
4. Add keyboard and outline alternatives for adding and connecting Blocks.
5. Add focused component tests for Block editing, outcome deletion, invalid Connections, stale saves, and publish errors.
6. Add one browser test for creating, connecting, saving, and publishing a Flow.

**Exit condition:** A user can create and publish the default Flow from an empty draft without editing JSON.

### Phase 7: Work and Run UI

1. Replace workflow-generated columns with Backlog, Ready, Active, Needs Attention, and Finished views.
2. Update Task cards and creation actions to use derived operational state.
3. Replace Task Detail step actions with Run controls, Decision choices, Attempt history, scoped logs, and Workspace status.
4. Add the read-only Run graph and repeated-Attempt timeline.
5. Update SSE store handlers for Tasks, Runs, Attempts, Workspaces, and capacity.
6. Test derived placement, run controls, Decision forms, retry warnings, stale-event rehydration, and repeated-node history.

**Exit condition:** The old board and Task Detail are no longer needed for any supported operation.

### Phase 8: Cutover and Removal

1. Remove workflow-step code, routes, catalog duplication, executor, and tests.
2. Remove legacy database migrations and establish the outcome-flow schema as version 1.
3. Add the old-database detection message and reset instructions.
4. Remove unused API client and Zustand fields.
5. Update initialization, README, AGENTS.md architecture, command documentation where needed, and screenshots.
6. Run backend tests, frontend tests, frontend typecheck, production build, and browser smoke tests.

**Exit condition:** Searching the application for `workflow_steps`, `requires_review`, and step-slug status logic returns no production references.

## Test Strategy

### Shared Core

- Table-driven tests for every Block configuration and outcome contract.
- Property-style graph tests for missing references, unreachable nodes, dead ends, and cycles.
- Snapshot tests for compiled Agent execution specifications.
- Round-trip serialization tests for all node types.

### Backend

- Repository tests with fresh temporary SQLite databases.
- Engine tests with fake handlers and controlled completion promises.
- Scheduler tests at capacity zero, one, and several.
- Route tests through Hono's `app.request()`.
- Short real-process tests outside CI when timing or process groups are involved.
- Recovery tests for PID reuse protection and retained Workspaces.
- Transaction tests for duplicate starts, duplicate Decisions, and stop/completion races.

### Frontend

- Component tests for every custom Block and inspector form.
- Store tests for derived Task placement and persisted-event handling.
- Flow editor tests for connection rules and draft revision conflicts.
- Task Detail tests for each Run and Attempt state.
- Browser tests for publishing a Flow and running a fake deterministic Flow.

### Required Verification

```bash
bun run test
cd packages/frontend && bunx tsc --noEmit
bun run build
```

Backend correctness continues to rely on Bun tests rather than a standalone backend typecheck.

## Acceptance Criteria

- A fresh project can initialize with a minimal or recommended default Flow.
- A user can add, move, configure, connect, and remove all first-release Block types.
- Invalid drafts can be saved but cannot be published.
- Published Flow versions are immutable, and an active Run is unaffected by later edits.
- An Agent can complete into a Check, Decision, or Result through named Outcomes.
- A Check can route Passed and Failed along different paths.
- A Decision can route backward to an earlier Agent and create a new Attempt.
- No cycle without a Decision can be published.
- Concurrency saturation leaves Attempts queued and starts them when capacity becomes available.
- Restart marks running Attempts interrupted, retains their Workspaces, preserves Decisions, and resumes queued work.
- Stop, failure, timeout, and interruption never remove a dirty Workspace.
- Duplicate starts and Decision submissions are idempotent or return a structured conflict.
- The Work view derives Backlog, Ready, Active, Needs Attention, and Finished correctly.
- Attempt-scoped logs and repeated visits are visible in Task Detail.
- SSE replay survives a server restart within the retained event window.
- The application rejects an old database with a clear, non-destructive reset message.
- No production code depends on ordered workflow steps or task-status slugs after cutover.

## Risks and Responses

| Risk                                          | Response                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Canvas state diverges from saved draft        | Treat server draft revision as authoritative; use optimistic concurrency and an explicit conflict state. |
| Feedback loop runs forever                    | Require every cycle to pass through a Decision and cap immediate automatic transitions.                  |
| Scheduler strands work                        | Persist queued Attempts and pump on startup, transitions, slot release, and a safety interval.           |
| Agent changes files before failing            | Retain the Workspace and warn on retry.                                                                  |
| External-write retry duplicates a PR or push  | No automatic retries; require stronger confirmation and show the previous Attempt.                       |
| Dirty Workspace is lost                       | Never force-remove it without explicit approval.                                                         |
| Persistent delivery events grow indefinitely  | Prune a bounded delivery window; keep Runs and Attempts as history.                                      |
| Prompt grows after many feedback rounds       | Include structured path summaries and recent Decision input, not prior stdout.                           |
| Check command is surprising or unsafe         | Display the exact command and effect level; treat Flow editing as trusted local configuration.           |
| Graph authoring is inaccessible by keyboard   | Provide palette, outline, inspector, and target-selector operations outside the canvas gesture model.    |
| A new preset changes old behavior             | Compile preset instructions into immutable published versions.                                           |
| Non-Git execution allows directory collisions | Force execution concurrency to one outside Git repositories.                                             |

## Deferred Design Work

Future plans should cover these independently:

- Parallel forks, execution tokens, child Workspaces, and Join semantics.
- Rule blocks over typed facts.
- Dedicated GitHub publishing with idempotency keys.
- Timers, schedules, webhooks, and external triggers.
- Per-Block agent and model selection.
- Operating-system enforcement for effect levels.
- Flow import, export, and reusable templates.
- Run-level resource budgets and approval policies.
