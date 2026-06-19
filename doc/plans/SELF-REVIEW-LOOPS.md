# Self-Review Loops

Depends on: [CUSTOM-WORKFLOW.md](./CUSTOM-WORKFLOW.md), [INTER-STEP-STATE.md](./INTER-STEP-STATE.md)

> **Scope note.** This plan owns the **review buffer** — the intra-step working memory of a single step's action → review → fix loop (category 3 in [INTER-STEP-STATE.md](./INTER-STEP-STATE.md)). Cross-step state (intent, deferrals, findings a step wants _later_ steps to act on) flows through the **journal** defined in that plan, **not** through review files. Self-review files are scoped to one step, deleted when the step completes successfully, and are **never injected into downstream steps' prompts**.

## Problem

An agent runs once per step and moves on. If it makes mistakes, those surface later — during a review step or Visual QA — and the task gets sent back to Development for another full run. This round-trip is slow and wastes human attention on issues the agent could have caught itself.

## Goal

Let the agent review its own work within a step before the step completes. A Development step configured with 2 self-review rounds does: implement → review own work → fix issues → review again → fix → done. The agent polishes its output before anyone else sees it.

## How It Works

A `selfReviewRounds` config option (number, default 0) is available on code-producing workflow steps (`planning`, `development`, and any future custom steps). It is **not** added to `todo`, `done`, `open-prs`, or `visual-qa` — those steps either don't run agents, produce no reviewable code changes, or are observation-only. When set to N, the executor runs the agent up to 2N+1 times within a single step:

1. **Action run** — the agent executes the step's normal task (implement, plan, etc.) using the step's standard prompt.
2. **Review run** — the agent reviews what it just did, writes findings to a review file.
3. If the review finds no issues, the loop stops early. Otherwise:
4. **Fix run** — the agent reads the review findings and fixes the issues.
5. Steps 2–4 repeat up to N times total.

So `selfReviewRounds: 2` means at most: action → review → fix → review → fix. Five agent spawns within one step. If the first review finds nothing, it short-circuits to just 2 spawns (action + review). `selfReviewRounds: 0` (default) is the current behavior — action only, no self-review.

The step completes after the last fix run (or after a clean review). If the step has `requires_review: false`, it auto-advances. If `requires_review: true`, it waits for the human.

## Design

### Config Schema Addition

Add `selfReviewRounds` to the `configSchema` of steps where self-review is meaningful — currently `planning` and `development`:

```typescript
{ key: 'selfReviewRounds', label: 'Self-review rounds', type: 'number', default: 0 }
```

Validated: integer, min 0, max 3. Zero means no self-review (current behavior).

Steps that do **not** get this option:

- `todo` and `done` — fixed steps, no agent runs
- `open-prs` — commits and pushes; self-reviewing a PR creation is not useful
- `visual-qa` — observation-only ("do not modify code"); self-review of a QA report doesn't produce value

The config UI should show the spawn count implication: "2 rounds = up to 5 agent runs per step."

### Executor: Loop Inside `executeAgent()`

The current `executeAgent()` flow from CUSTOM-WORKFLOW.md:

```
executeAgent() → run adapter → handleAgentResult() → finally cleanup → chain if needed
```

With self-review, the adapter call becomes a loop:

```typescript
async function executeAgent(taskId: number, stepSlug: string, ...) {
  const stepInfo = getStepInfo(stepSlug);
  const config = JSON.parse(stepInfo.config);
  const rounds = config.selfReviewRounds ?? 0;

  let chainResult: { nextSlug: string } | null = null;
  try {
    // Round 0: action
    const actionPrompt = buildPrompt(task, {
      stepName, stepDescription, stepConfig, journal, // cross-step context via the journal (INTER-STEP-STATE.md)
      workingDir, ...
    });
    await runAdapter(actionPrompt, ...);

    // Self-review rounds
    for (let i = 1; i <= rounds; i++) {
      // Review sub-round: agent reviews its own work
      const reviewPrompt = buildReviewPrompt(task, {
        stepName, stepConfig, round: i, totalRounds: rounds,
        workingDir, ...
      });
      await runAdapter(reviewPrompt, ...);

      // Check if the review found issues
      const reviewContent = readReviewFile(repoRoot, task.task_key, stepSlug, runNumber, i);
      if (!reviewContent) {
        // Agent didn't write the review file — treat as clean review
        queueLog('warn', `Self-review round ${i}/${rounds}: review file not found — treating as clean.`);
        break;
      }
      if (reviewContent.trim().startsWith('NO_ISSUES_FOUND')) {
        queueLog('info', `Self-review round ${i}/${rounds}: no issues found — skipping remaining rounds.`);
        break;
      }

      // Fix sub-round: agent reads findings and fixes
      const fixPrompt = buildFixPrompt(task, {
        stepName, stepConfig, round: i, totalRounds: rounds,
        reviewContent,
        workingDir, ...
      });
      await runAdapter(fixPrompt, ...);
    }

    // All rounds complete — reaching here means success
    // (any sub-round failure throws and lands in the catch block)
    const result = handleAgentResult({ success: true, summary: '' }, task, stepSlug, ...);
    if (result.nextAction === 'chain') {
      chainResult = { nextSlug: result.nextSlug };
    }
  } finally {
    activeRuns.delete(taskId);
    await removeWorktree(...);
  }

  if (chainResult) {
    startAgent(taskId, chainResult.nextSlug).catch(...);
  }
}
```

Each sub-round (review, fix) is a separate `runAdapter()` call — a separate agent process spawn with its own prompt. The adapter is the same CLI adapter used for regular runs. The agent process starts, does its work, exits. Then the next sub-round starts.

### Short-Circuit on Clean Review

The review prompt instructs the agent to write `NO_ISSUES_FOUND` as the first line of the review file if everything looks good. After each review sub-round, the executor reads the review file and checks for this sentinel. If found, the loop breaks — no fix run, no further rounds. This prevents wasting spawns when the agent's work is already clean.

### Aggregate Step Timeout

The `timeout_ms` from `agent_config` applies per agent spawn (per `runAdapter()` call). Without a step-level cap, a 2-round loop with 30-minute timeouts could run for 150 minutes.

The executor sets a single aggregate timer for the entire loop: `stepTimeoutMs = timeout_ms * (2 * selfReviewRounds + 1)`, capped at a maximum of 2 hours. If the timer fires, it aborts the current spawn via the `AbortController`. The current `runAdapter()` call throws, the loop exits through the `catch` block, and the task is marked as **failed** — not as a partial success. The rationale: an incomplete self-review loop means the agent's work hasn't been validated. Better to fail explicitly than to silently advance with unreviewed changes. The error log reads: "Step timeout reached after {elapsed} — aborting remaining self-review rounds."

For `selfReviewRounds: 0`, the aggregate timeout equals the per-spawn timeout — no behavior change.

### `runAdapter()` Extraction

Currently the adapter call, output streaming, and log writing are inline in `executeAgent()`. For the loop to work, this needs to be extracted into a reusable `runAdapter(prompt, ...)` function that:

1. Spawns the CLI adapter with the given prompt
2. Streams output to the task log (with a sub-round label)
3. Awaits completion
4. Returns the exit code

This extraction is a prerequisite refactor. It doesn't change behavior — it just makes the adapter call callable multiple times within one `executeAgent()` run.

The per-spawn flush logic (`clearTimeout(timeoutTimer)`, `flushLogBuffer()`, lost-log warning) stays **outside** `runAdapter()` — it runs once after the full loop completes (or on failure), not after each spawn. The aggregate timeout replaces the per-spawn timeout for the loop case.

### Prompts

Three prompt types within a self-review loop:

**Action prompt** — the step's normal prompt. No changes from CUSTOM-WORKFLOW.md. The agent implements/plans/tests as usual. Includes step config and prior review feedback.

**Review prompt** — tells the agent to review what it just did. Includes the step config so the agent can check whether config-specific instructions were followed:

```
## Step: {stepName} — Self-Review (round {i} of {N})

Review the changes you made in this step. Look for:
- Bugs, logic errors, edge cases
- Missing tests or test coverage gaps
- Code style issues, unclear naming
- Incomplete implementation relative to the task requirements

### Step Configuration
{rendered config instructions — same as the action prompt received}

If you find issues, describe them clearly in the file below.
If everything looks good, write `NO_ISSUES_FOUND` as the first line.

Write your findings to {absolute_path_to_repo}/.tasks_manager/reviews/{task_key}-{step_slug}-run{n}-self-review-round{i}.md.

## Task: {task_key} — {title}
{description}
{acceptance criteria}
```

The agent runs in the same worktree, sees all the files it just created/modified, and writes a review file to the main repo's `.tasks_manager/reviews/` (absolute path, same as cross-step review files — see CUSTOM-WORKFLOW.md).

**Fix prompt** — tells the agent to fix what the review found. Also includes step config:

```
## Step: {stepName} — Fix Issues (round {i} of {N})

Your self-review found the following issues:

{contents of the review file}

Fix these issues.

### Step Configuration
{rendered config instructions}

## Task: {task_key} — {title}
{description}
{acceptance criteria}
```

The fix prompt includes the review findings inline — the agent doesn't need to find and read the file itself.

### Review File Naming

Self-review files include the `run_number` and round to avoid stale files contaminating retries:

- Self-review findings: `{task_key}-{step_slug}-run{n}-self-review-round{i}.md`

Example for task PROJ-5, Development step, run 2, round 1:

- `PROJ-5-development-run2-self-review-round1.md`

Including `run{n}` means each retry produces new files. Old self-review files from previous runs remain on disk but don't interfere — within a loop, the fix prompt reads the exact file for the current run and round (`*-run2-self-review-round1.md`), never a glob.

**Self-review files are intra-step only — never injected downstream.** They are the step's private working memory, describing issues the agent already found and fixed within the loop. The journal (see [INTER-STEP-STATE.md](./INTER-STEP-STATE.md)) — not review files — is the channel that carries information to later steps. There is no "Feedback from previous steps" review-file glob; that cross-step review-file mechanism from the original draft is removed in favor of the journal. If a step's self-review surfaces something a _later_ step should know, the step records it as a `handoff` (or `review-summary`) journal entry, not by leaving review files behind.

**Retry inclusion:** On retry (new `run_number`), the executor includes the **prior runs'** self-review files for **this same step** in the action prompt, so the agent knows what the previous attempt's self-review found and avoids repeating mistakes. This is still intra-step context (same step, earlier run) — the executor reads these files directly by their `{task_key}-{step_slug}-run*-self-review-*` pattern; it is not the journal injection and not a cross-step channel. The `run{n}` in the filename distinguishes prior-run files (included on retry) from the current run's files.

Self-review files are written to the **main repo root's** `.tasks_manager/reviews/`, not the worktree, with an absolute path in the prompt — for the reasons given in [INTER-STEP-STATE.md](./INTER-STEP-STATE.md#why-state-files-live-in-the-main-repo-root-not-the-worktree) (they are gitignored and thus not part of the worktree checkout; the executor owns their lifecycle; it works uniformly in non-git mode).

The executor must ensure `.tasks_manager/reviews/` exists before the review sub-round starts (via `fs.mkdirSync(reviewDir, { recursive: true })`). The directory may not exist on a fresh project.

### Log Separation

Each sub-round within the loop writes to the same task log (same `run_number`), but with clear separators so the user can follow what happened:

```
═══ Development: Action ═══
[agent output...]

═══ Development: Self-Review (round 1/2) ═══
[agent output...]

═══ Development: Fix Issues (round 1/2) ═══
[agent output...]

═══ Development: Self-Review (round 2/2) ═══
[agent output...]

═══ Development: Fix Issues (round 2/2) ═══
[agent output...]
```

These separators are written to the task log by the executor before each `runAdapter()` call as `info`-level log lines (not agent output), so the frontend can style them differently from regular agent output.

### Cancellation

If the user cancels mid-loop, the current `runAdapter()` call's process gets killed (via the `AbortController`, same as current cancellation). The loop breaks — no further sub-rounds run. The `finally` block cleans up as normal. The task stays in the current step with `agent_status = 'failed'`.

The cancellation doesn't need to know which sub-round it's in. The abort signal propagates to the spawned process, the adapter throws, the loop's `try` block exits, and cleanup runs.

### Failure

If any sub-round fails (non-zero exit, crash, timeout):

- The loop stops. No further sub-rounds run.
- `agent_status` is set to `'failed'`.
- The task stays in the current step.
- The user sees which sub-round failed in the task log (because of the separators).
- The user can click Retry, which restarts the entire loop from the action run — not from the failed sub-round. Partial retry (resume from round 2) adds significant complexity for marginal benefit.
- Self-review files from the failed run persist in `.tasks_manager/reviews/` (they're in the main repo, not the worktree). On retry, prior-run self-review files are included in the action prompt via `buildPrompt()`, so the agent starts with knowledge of what the previous attempt's self-review found (see "Review File Naming" for the current-run vs. prior-run distinction).

### Worktree Lifecycle

The worktree is created once when the step starts and removed once when the step completes (or fails). All sub-rounds within the loop share the same worktree. This is important — the review round needs to see the files the action round created, and the fix round needs to modify what the review flagged.

This matches the existing design: one worktree per `startAgent()` call, cleaned up in `executeAgent()`'s `finally` block. The loop doesn't change the worktree lifecycle.

### Concurrency

The entire loop (action + N review/fix pairs) holds one concurrency slot. A Development step with 2 self-review rounds occupies one slot for the full duration (up to 5 agent spawns). This is the right behavior — the task owns the worktree and the concurrency slot for the duration of the step.

The slot is released in `finally` after all sub-rounds complete (or on failure/cancellation). Chaining to the next step happens after the slot is freed, same as in CUSTOM-WORKFLOW.md.

## Files Requiring Changes

All changes build on the CUSTOM-WORKFLOW.md implementation. These are incremental additions.

### Backend

| File                       | Changes                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executor/executor.ts`     | Extract `runAdapter()` from inline adapter code. Add loop logic inside `executeAgent()` with short-circuit check. Add aggregate step timeout. Write separator log lines (as `info` level) between sub-rounds. Broadcast `agent:status` with `subRound` info before each sub-round. Ensure `.tasks_manager/reviews/` directory exists before review sub-rounds. |
| `workflow/step-config.ts`  | Add review and fix prompt generation. Integrate into `buildPrompt()` via a `mode` parameter (`'action'                                                                                                                                                                                                                                                         | 'review' | 'fix'`, default `'action'`), rather than separate functions — the task context assembly is identical across modes. Both review and fix modes include step config. |
| `workflow/step-catalog.ts` | Add `{ key: 'selfReviewRounds', label: 'Self-review rounds', type: 'number', default: 0 }` to `configSchema` of `planning` and `development` steps only.                                                                                                                                                                                                       |

### Frontend

| File                                   | Changes                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/WorkflowSettingsModal.tsx` | Render the `selfReviewRounds` number input in step config forms (only for steps that have it in their schema). Show spawn count hint ("2 rounds = up to 5 agent runs").                                                              |
| `components/TaskDetail.tsx`            | Detect separator log lines (matching the `═══` pattern) and render them as visually distinct section headers within a run's log output. Consider making sub-round sections collapsible — with 5 sub-rounds the log can be very long. |
| `components/Column.tsx`                | Optionally show a badge or indicator when a step has self-review configured (e.g., "2 review rounds"). Low priority.                                                                                                                 |

### Tests

- Executor tests: loop with 0/1/2 rounds, short-circuit on clean review, cancellation mid-loop, failure on review round, failure on fix round, aggregate timeout.
- Prompt tests: verify review and fix prompts include correct round numbers, step config, and review file contents.
- Config validation: `selfReviewRounds` must be integer 0–3.

## Implementation Order

1. **Extract `runAdapter()`** — pull the adapter spawn/stream/log logic into a reusable function. No behavior change. Run existing tests to verify.
2. **Add `selfReviewRounds` to catalog config schemas** — schema only, no executor logic yet. Default 0 means no behavior change.
3. **Review and fix prompt modes** — add `mode` parameter to `buildPrompt()` (`'action' | 'review' | 'fix'`). Include step config in all modes.
4. **Loop logic in `executeAgent()`** — the core feature. Read `selfReviewRounds` from config, ensure `.tasks_manager/reviews/` directory exists, loop with review/fix sub-rounds, short-circuit on `NO_ISSUES_FOUND` or missing review file, write separator log lines, aggregate step timeout.
5. **Frontend config UI** — number input for `selfReviewRounds` in workflow settings with spawn count hint.
6. **Frontend log viewer** — detect `═══` separator lines in `TaskDetail.tsx`, render as section headers.
7. **SSE sub-round progress** — extend `agent:status` events with optional `subRound` info (e.g., `{ subRound: 'self-review', round: 1, totalRounds: 2 }`). Display in the task detail panel header near the "Live" indicator.
8. **Tests** — executor loop tests (0/1/2 rounds, short-circuit, missing review file, cancellation mid-loop, failure per sub-round, aggregate timeout), prompt mode tests, config validation.

## Risks

- **Cost and time** — each self-review round adds up to 2 agent spawns. A step with 2 rounds runs up to 5 times. With expensive API-backed agents, this adds up. The max of 3 rounds (7 spawns) and the aggregate step timeout (capped at 2 hours) are guardrails. The short-circuit on clean review helps — if round 1 finds nothing, only 2 spawns run instead of 5.
- **Diminishing returns** — after 1–2 review rounds, the agent is reviewing its own fixes to its own fixes. Quality improvements taper off. The default of 0 is intentional. Most users should try 1 round first.
- **Review quality** — the agent reviewing its own work has the same blind spots it had when writing the code. Self-review catches mechanical errors (missing null checks, typos, untested paths) but not design problems. It's not a substitute for human review or a second agent's review.
- **Retry restarts the whole loop** — if the agent fails on the second review round (sub-round 4 of 5), retry starts from scratch (action round). The code changes from earlier sub-rounds are lost (worktree removed). But the self-review findings persist in `.tasks_manager/reviews/` and get included in the new action prompt, so the agent starts with context about what went wrong.
- **Short-circuit reliability** — the `NO_ISSUES_FOUND` sentinel depends on the agent following the prompt instruction. If the agent writes "No issues found, everything looks great!" without the exact sentinel, the loop doesn't short-circuit and runs an unnecessary fix round. Acceptable — the fix round with "no issues" findings is cheap (agent exits quickly), and the sentinel works with most agents that follow instructions literally.
- **Missing review file** — if the agent completes the review sub-round but doesn't write the review file (ignored the prompt, wrote to the wrong path), the executor treats it as a clean review and stops the loop with a warning log. This is more graceful than failing the entire step for an instruction-following issue.
