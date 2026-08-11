# Workspace preparation

## Decision

Flow has one project-level Workspace setup command. When it is configured, every Run executes that command inside the Task Workspace before entering Begin. This is runtime infrastructure, not a Flow block: Flow authors do not need to repeat dependency installation in every graph, and the first Run step remains the first meaningful step in the selected Flow.

The command uses argument parsing rather than a shell. Pipes, redirects, command chaining, and other shell operators are rejected. The project can leave the command empty to disable preparation. During onboarding and in Settings, Flow suggests a command from the repository lockfile but keeps the choice editable.

Each execution is stored as a Workspace preparation record with its own status, command snapshot, output, exit code, and sequence. A failed or timed-out preparation moves the Run to Needs Attention before Begin is recorded. Retrying creates a new preparation record and uses the command currently saved in Settings; the failed record remains intact.

## Interface

An active preparation labels the Task and Run as `Preparing workspace`. The Task panel shows preparation only while it is active or needs attention. Successful setup stays out of the Run-step timeline so it does not compete with Flow history. A failure shows its command and output once, followed by `Retry setup`; `Retry block` remains reserved for failed Flow Attempts.

Settings includes a setup test that creates a detached temporary Git worktree at the current `HEAD`, runs the proposed command there, returns its output, and removes the worktree. This tests the missing-dependencies condition without changing the main checkout or saving the candidate command.

## Local verification

The engine integration test starts a Run with a Check that requires a file created by Workspace preparation. It first records a failing setup, then changes the configured command, retries preparation, and proves that the Flow starts only after the dependency marker exists. Route tests exercise lockfile detection, command validation, temporary-worktree cleanup, and configuration persistence. Frontend tests cover onboarding, Settings testing, and the preparation failure/retry state in the Task panel.

For manual verification, use `Test setup` in Settings. A deliberately failing candidate can be saved temporarily to confirm that a newly started Task stops before Begin, exposes its output in Needs Attention, and resumes through `Retry setup` after the command is corrected.
