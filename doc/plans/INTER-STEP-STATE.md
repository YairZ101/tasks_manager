# Inter-Step State

Depends on: [CUSTOM-WORKFLOW.md](./CUSTOM-WORKFLOW.md)
Built on by: [SELF-REVIEW-LOOPS.md](./SELF-REVIEW-LOOPS.md)

## Problem

A task moves through a chain of workflow steps, and each step is a **stateless, fresh agent invocation** (see `executeAgent()` in `executor/executor.ts`). When a step's agent exits, everything in its working memory is gone — what it was trying to do, why it chose an approach, what it deliberately deferred, what it tried and abandoned, what it noticed but couldn't resolve.

The only thing that survives between invocations today is the **code on the `agent/<task-key>` branch**, which the persistent worktree carries forward. A diff tells the next step _what changed_ — but not the intent, rationale, or open questions behind it. There is no channel for that.

This plan defines the foundation for passing non-code information between steps. [SELF-REVIEW-LOOPS.md](./SELF-REVIEW-LOOPS.md) builds the intra-step self-review loop on top of it.

## Three categories of handoff information

Not all inter-step information is the same shape, and the mistake to avoid is forcing it all through one "review file" channel. There are three distinct categories:

1. **Deliverables** — artifacts whose format is dictated by an external destination and which exist whether or not a later step reads them:
   - the **plan** → `doc/plans/`, committed to git (the `planning` step already has `planLocation` + `trackInGit` config in `step-catalog.ts`)
   - the **PR description** → the pull request on GitHub (the `open-prs` step)
   - the **code** → the `agent/<task-key>` branch

   These already have homes. **They need no new mechanism** — a later step reads them in place (the plan is on the branch in the worktree; the PR is on GitHub). Do not route deliverables through the journal.

2. **Cross-step ephemeral state** — information with no home except the hand-off itself: what a step did, what it deferred, what it assumed, open questions, and short summaries of findings a step wants later steps to act on. This is what the **journal** (defined below) carries.

3. **Intra-step self-review critique** — the working memory of a single step's action → review → fix loop. This is the **review buffer**, owned entirely by [SELF-REVIEW-LOOPS.md](./SELF-REVIEW-LOOPS.md). It is scoped to one step, deleted when the step completes successfully, and **never read by other steps**.

This plan implements category 2 and the shared file-layout/cleanup substrate that category 3 also uses.

## Why state files live in the main repo root, not the worktree

All inter-step state files (the journal here, and the review buffer in the self-review plan) are written to the **main repo root's** `.tasks_manager/`, never inside the worktree. The agent runs in the worktree and is given an **absolute path** to the file. The reasons:

- **They are gitignored, so they cannot live in the worktree anyway.** `.tasks_manager/` is excluded from git (`*` in `.tasks_manager/.gitignore`). A worktree is a checkout of the branch's _tracked_ files, so `.tasks_manager/` is not part of it. Writing state there would create untracked, throwaway files in a directory whose purpose is to be disposable.
- **Lifecycle decoupling.** The worktree is removed when the task reaches `done`, and can be cleaned up by crash recovery. Tying state-file lifetime to worktree lifetime is fragile. Root storage lets the executor own the lifecycle explicitly (see Cleanup below).
- **Uniformity across git / non-git mode.** When `gitRepoDetected` is false there is no worktree at all — the agent runs directly in `workingDir`. A fixed root location works identically in both modes.

> Note: an earlier rationale (in CUSTOM-WORKFLOW.md / the original SELF-REVIEW draft) justified root storage as "accessible to future steps running in _different_ worktrees." That is outdated — the worktree now persists per task across steps. The reasons above are the accurate justification.

## The journal

A single append-only markdown file per task:

```
.tasks_manager/journal/{task_key}.md
```

One file per task, one entry appended per step (and, optionally, per self-review round that wants to leave a forward-looking note). It is short by construction — it carries only what a diff cannot.

### Entry format

The executor seeds the file and each entry is delimited by a typed header so the read policy can select slices later:

```
## [<step-slug> · run <n>] <type>
<body>
```

- `type` is one of:
  - `handoff` — freeform: what I did, what I deferred, assumptions made, open questions. Written by any agent step.
  - `review-summary` — a **standalone reviewer step** promoting its findings forward so a later step can act on them. This is how review findings travel between steps. (Raw, run-by-run self-review critique never travels — it stays in the intra-step review buffer.)

Example:

```
## [development · run 1] handoff
Implemented the retry wrapper in src/net/retry.ts. Deferred jitter (assumed
fixed backoff is acceptable for now — flag in PR). Did not add integration
tests; unit tests cover the backoff math.

## [code-review · run 1] review-summary
- src/net/retry.ts:42 — retry count is off-by-one on the final attempt.
- Missing test for the max-retries-exhausted path.
```

### Who writes it

The agent appends its own entry, instructed by the prompt with the **absolute path** and the exact header to use. The executor's responsibility is to **ensure the directory and file exist** before the step runs (`fs.mkdirSync(journalDir, { recursive: true })`, seed an empty file if absent) — the same "ensure dir exists" step the self-review plan already calls for.

Rationale for agent-appended (vs. executor reading a per-run scratch file and appending): it is the simplest mechanism, mirrors the reliability bet self-review already makes with its review files, and keeps the executor from owning a second file-shuffling path. If the agent malforms the header or skips the entry, the worst case is degraded context downstream, not a broken step — the read policy below tolerates arbitrary text.

> Considered alternative: executor owns all headers; the agent writes only a body to a per-run scratch file which the executor reads and appends with a stamped header. Cleaner structure, but adds an executor read/append/cleanup path and a second file per run. Deferred unless agent formatting drift proves to be a real problem in practice.

## Reading the journal into prompts (the injection policy)

`buildPrompt()` in `executor/executor.ts` gains a new option:

```typescript
export interface BuildPromptOpts {
  // ...existing fields...
  journal?: string; // contents of .tasks_manager/journal/{task_key}.md, or a curated slice
}
```

Before building a step's prompt, the executor reads the journal file (if present) and passes its contents. `buildPrompt()` injects it as a dedicated section placed **after** the task description and **before** the step-specific instructions:

```
## Context from previous steps
<journal contents>
```

**Policy — inject the whole journal, not a glob of many files.** Because the journal is a single short file (one entry per step), injecting it whole is fine for now and avoids the staleness/bloat trap of concatenating many independent review files into every prompt. If real workflows produce long journals, switch to a last-N-entries slice or an executor-side summarization pass — but that is a later optimization, explicitly out of scope here. The key invariant: **one file, curated forward-looking entries**, not a broadcast of every artifact ever written.

Deliverables are _not_ injected — the plan is read from its file on the branch, the code is the branch. The journal carries only category-2 state.

## Cleanup

The existing `cleanupReviewFiles(taskKey, repoRoot)` in `workflow/workflow-utils.ts` deletes the per-task review files. Generalize task-state cleanup to also remove the journal file:

- Add `cleanupJournal(taskKey, repoRoot)` (deletes `.tasks_manager/journal/{task_key}.md`), or fold both into a single `cleanupTaskState(taskKey, repoRoot)` that clears the journal **and** the review buffer.
- Call it from the same three sites that already call `cleanupReviewFiles`:
  - `routes/tasks.ts` — task moved to `done` (PATCH) and task deleted (DELETE)
  - `executor/executor.ts` — auto-advance reaching `done` (`handleAgentResult`, where `nextSlug === 'done'`)

Behavior on **reopen from done**: the journal is already gone, so a reopened task starts fresh — consistent with the existing review-file behavior.

## Relationship to the review buffer (SELF-REVIEW-LOOPS.md)

|                      | Journal (this plan)                                          | Review buffer (self-review plan)                                              |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Scope                | whole task                                                   | one step (read only within its own loop / that step's retries)                |
| Lifetime             | deleted at `done`/delete                                     | deleted at `done`/delete; prior-run files persist for same-step retry context |
| Location             | `.tasks_manager/journal/{task_key}.md`                       | `.tasks_manager/reviews/{task_key}-….md`                                      |
| Read by later steps? | **yes** (injected via `buildPrompt`)                         | **no** — never injected downstream                                            |
| Carries              | intent, deferrals, open questions, promoted review summaries | raw action→review→fix critique for one step                                   |

A standalone reviewer step that wants to influence a later step does so by writing a `review-summary` **journal entry** — not by leaving raw review files for the next step to glob. This supersedes the original SELF-REVIEW-LOOPS.md "Feedback from previous steps" design, where `buildPrompt()` globbed `{task_key}-*.md` and injected all matching review files. That cross-step review-file channel is removed; the journal replaces it.

## Files requiring changes

### Backend

| File                         | Changes                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `executor/executor.ts`       | Add `journal` to `BuildPromptOpts` and inject a "Context from previous steps" section in `buildPrompt()`. Before building a prompt, ensure `.tasks_manager/journal/` exists, seed `{task_key}.md` if absent, and read it. Call generalized cleanup when a task reaches `done`. |
| `workflow/step-config.ts`    | In the step instructions, add an instruction telling the agent to append a `handoff` entry to the journal at the given absolute path, using the exact header format. For an `agent-review`-style standalone reviewer step, instruct a `review-summary` entry instead.          |
| `workflow/workflow-utils.ts` | Add `cleanupJournal` (or generalize to `cleanupTaskState`) covering the journal file.                                                                                                                                                                                          |
| `routes/tasks.ts`            | Point the `done`/delete cleanup calls at the generalized cleanup.                                                                                                                                                                                                              |

### Tests

- Journal directory/file is seeded on first step when absent.
- An entry appended by step N is injected into step N+1's prompt ("Context from previous steps" present with the entry).
- Whole-journal injection (not a per-file glob); deliverables are not injected.
- Cleanup removes the journal on `done` and on delete; reopened task starts with no journal.
- Missing/empty journal is handled (no section, no error).
- Non-git mode (no worktree): journal still written to and read from the main root.

## Implementation order

1. **File layout + ensure-exists/seed helper** — `.tasks_manager/journal/{task_key}.md`, created/seeded by the executor before a step runs. No prompt or read wiring yet.
2. **Cleanup generalization** — `cleanupJournal`/`cleanupTaskState`, wired into the existing `done`/delete sites. No behavior change yet (nothing writes the journal).
3. **Journal injection** — add `journal` to `BuildPromptOpts`, read the file in the executor, inject the "Context from previous steps" section.
4. **Agent write instruction** — extend step instructions in `step-config.ts` to tell the agent to append its `handoff` entry (and `review-summary` for reviewer steps).
5. **Tests** — as above.

## Risks

- **Agent skips or malforms the entry.** Worst case is missing/degraded downstream context, never a broken step — the read policy treats the journal as opaque text. Same reliability bet as the self-review sentinel. Acceptable.
- **Journal growth / prompt bloat.** Mitigated by one-entry-per-step and the single-file design. If it grows, move to a last-N-entries slice or summarization — flagged above, out of scope for the first cut.
- **Staleness.** Forward-looking handoff notes (intent, deferrals) age more gracefully than backward-looking critique, and raw critique is deliberately kept out of the journal. Reviewer summaries are explicit and adjacent, limiting how far stale findings can travel.
