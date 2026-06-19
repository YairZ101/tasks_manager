# Planning Docs — Conventions

The documents in `doc/plans/` are **decision records**, not living documentation. Each captures a design decision and its rationale at a point in time — what we decided to build and why, _then_. Treat them as append-only history.

## Rules

1. **Don't rewrite the substance of an existing plan to reflect a new decision.** Editing decisions in place destroys the record of what was originally chosen and why it changed. The new thinking belongs in a _new_ doc.

2. **A new decision that changes an old one gets its own doc**, which names what it supersedes (e.g. "Supersedes the review-file design in CUSTOM-WORKFLOW.md"). See `INTER-STEP-STATE.md` for an example.

3. **When a plan is superseded, mark it — don't gut it.** Add a one-line banner at the top of the affected section pointing to the new doc, and leave the body intact as a historical record:

   ```
   > ⚠️ **Superseded by [NEW-DOC.md](./NEW-DOC.md)**, which <one-line reason>. Section retained as a historical record.
   ```

4. **Once a feature ships, the code is the source of truth** — not the plan. Don't try to keep shipped plans in sync with the code; that's how docs rot. The plan's job is done at implementation; it stays as an archival record.

5. **Drafts may be edited freely.** A plan that hasn't been committed yet (still untracked / under active authoring) is not a record of anything — edit it however you like until it lands.

## Why

Plans answer "why did we build it this way?" months later. That value depends on them being faithful to the moment they describe. A plan that's been quietly rewritten is worse than no plan — it looks authoritative while misrepresenting history. Banners + new docs preserve the trail; in-place rewrites erase it.
