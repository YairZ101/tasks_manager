# Finished Task Reopening

## Decision

Finished tasks are read-only. A user may explicitly reopen a completed or cancelled task, which returns it to Backlog without changing its previous Runs, Attempts, logs, or pinned Flow versions.

Reopening does not start a Run. Once the task is open again, the user may edit it, choose a published Flow, and start a new Run from Begin. Retry remains reserved for recovering a block in an unfinished Run.

## Why

Editing a finished task would change the apparent scope after its recorded Run completed. Making the finished state read-only keeps that result understandable, while reopening provides a clear recovery path for regressions or work that was closed too early.

Task resolution and operational state remain separate. `open` means the desired outcome is unresolved; an open task with no active Run appears in Backlog. `completed` and `cancelled` appear in Finished.

## Reopen behavior

- Reopen sets `resolution` to `open` and places the task at the end of Backlog.
- Reopen is idempotent when the task is already open. Finished tasks do not normally have an active Run; an inconsistent terminal task with one is rejected.
- Previous execution history and the task-scoped Workspace lifecycle are unchanged.
- Reopening a completed task may make open dependent tasks blocked again. The UI names those tasks before it proceeds.
- The task panel stays open after reopening, switches the operational view to Backlog, and exposes Edit and Start run.

## API

`POST /tasks/:id/reopen` owns the state transition. Ordinary task updates return `409 task_finished` while the task resolution is terminal.

This changes behavior only. It does not change a persisted shape, so existing disposable `.flow/` databases do not need to be reinitialized.
