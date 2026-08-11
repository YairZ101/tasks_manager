# Run-step log disclosure

The interface presents a Run's execution history as **Run steps**. Each row acts as a disclosure for its output. Runs open with every step collapsed. Clicking a row opens its output beneath it, clicking another row moves the output, and clicking the open row again closes it.

The first execution of a block has no count label. Later executions use `Retry 1`, `Retry 2`, and so on; `Retry 1` corresponds to the stored second block Attempt. **Attempt** remains the backend term for each immutable block entry, but the interface uses **Run steps** for the list and **Retry** when a block runs again.

Begin and Result rows omit structural outcomes such as `started` and `arrived`. Executable blocks keep their human-readable outcome beside any retry label.

Expanded state is local interface state. It does not change Run history or the API.
