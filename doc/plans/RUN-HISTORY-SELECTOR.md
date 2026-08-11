# Run history selector

## Decision

Tasks with more than one Run expose a Run history selector in the task panel. The active Run is selected by default; when there is no active Run, the newest Run is selected. Runs are listed newest first and identified by their Run number and outcome. The Run number already communicates chronology, so the UI does not add `Latest` or `Initial` labels.

Selecting a historical Run replaces the complete Run detail view: status, Attempts, logs, pinned Flow version, reason, and Workspace. Historical Runs remain immutable and selecting one does not change the Task or start another Run.

Tasks with a single Run do not show the selector because it would add a control without adding a choice.

## Rationale

Reopening a finished Task preserves its previous Runs, so that history needs a direct path from the Task itself. Keeping the selector inside the Run card makes the scope clear and avoids introducing a separate history screen. Swapping the entire detail prevents information from different Runs from appearing together.

## Data and API impact

No persisted shape or API changes are required. The existing task-filtered Run list already returns Runs newest first, and the existing Run detail endpoint provides each immutable snapshot.
