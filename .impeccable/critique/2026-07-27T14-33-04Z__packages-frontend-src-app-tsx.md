---
target: Flow application shell
total_score: 22
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-07-27T14-33-04Z
slug: packages-frontend-src-app-tsx
---
# Flow application shell critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Attention cards do not explain what needs action. |
| 2 | Match System / Real World | 3 | Core terms fit developers, but Attempt, Draft revision, and effect level lack context. |
| 3 | User Control and Freedom | 2 | Flow editing has no visible undo/redo or reversible block deletion. |
| 4 | Consistency and Standards | 3 | Rail state choices look like filters but leave every board column visible. |
| 5 | Error Prevention | 3 | Starting a Run hides the exact Flow version and write effects. |
| 6 | Recognition Rather Than Recall | 2 | Users must remember the default Flow and infer why a task needs attention. |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, batch triage, or focused attention queue. |
| 8 | Aesthetic and Minimalist Design | 2 | Rail and board duplicate five operational states; the fixed desktop width demands a broad scan. |
| 9 | Error Recovery | 2 | Run failures and next recovery steps are not summarized on the task card. |
| 10 | Help and Documentation | 1 | The operational shell has no in-context help for its core terms. |
| **Total** | | **22/40** | **Acceptable; substantial operational clarity work remains.** |

## Design Specificity Verdict

Flow's operating model is specific to local agent orchestration. Fixed task states, dirty workspaces, Runs, Attempts, Decisions, and typed Flow blocks map to actual developer work. The visual shell is less distinctive: its dark control-room treatment could fit many developer tools, so product character currently comes from content and states rather than composition.

The detector found eight CSS findings: one state-accent side border at `index.css:90`, a capacity-meter width transition at `index.css:57`, a board grid at `index.css:64`, and five duplicate Plus Jakarta Sans reports in `fonts.css`. The side border meaningfully encodes state, the grid is appropriate for the board surface, and the font is an explicit project choice. The width transition is real but has negligible scope.

## Overall Impression

The product's operational vocabulary is strong and the setup sequence earns trust. The main gap is action clarity: users can see that something needs attention, but not why or what will happen next until they open a dense panel.

## What's Working

- Dirty workspace state, active blocks, run status, and timelines make local agent work legible.
- The setup sequence proves the configured agent before it can affect a task.
- The Flow editor uses typed blocks, validation, outcome wiring, and accessible connection controls that match the product model.

## Priority Issues

### [P1] The Work rail promises filtering but only adds a faint focus treatment

**Why it matters:** Ready and Needs attention look like queue views, yet users still scan all five columns. The duplicate navigation model adds cognitive load.

**Fix:** Make rail selections switch to a single-queue view, or remove the duplicate rail state navigation. Keep Needs attention as a deliberate, focused triage route.

**Suggested command:** `$impeccable layout`

### [P1] Attention cards hide the reason and next action

**Why it matters:** Developers cannot tell whether a task needs a decision, recovery, or workspace cleanup before opening the panel.

**Fix:** Add a concise cause and next action to task cards: Decision required, Check failed, Run interrupted, or Workspace cleanup required, with the current block.

**Suggested command:** `$impeccable clarify`

### [P1] Starting a Run is opaque for a potentially write-capable action

**Why it matters:** The current generic default-Flow message asks users to trust an execution contract they cannot inspect.

**Fix:** Show the Flow name and published version, key blocks, workspace behavior, and likely write effects before the action. Label the action "Start this Flow."

**Suggested command:** `$impeccable harden`

### [P1] The fixed 1180px minimum does not suit constrained desktop work

**Why it matters:** Flow is likely to share a laptop screen with a terminal and editor. The current shell demands a broad scan or horizontal scrolling.

**Fix:** Add a compact work mode for laptop and split-screen use while keeping Flow editing as the wide-screen-only surface.

**Suggested command:** `$impeccable adapt`

### [P2] Expert speed is under-served

**Why it matters:** Regular triage requires repeated pointer work and full-board scanning.

**Fix:** Add shortcuts for New task, Needs attention, queue switching, and start/stop run actions. Add a quick path through multiple attention items.

**Suggested command:** `$impeccable optimize`

## Persona Red Flags

### Developer power user

- Needs attention is not a true focused queue, so triage still requires a broad scan or horizontal scrolling.
- No visible shortcuts or batch actions support repeated review.
- Start Run does not expose the selected Flow's contract before execution.

### First-time developer

- Flow, Run, Attempt, Draft revision, and effect level appear with little in-context explanation.
- Needs attention has no causal explanation or obvious next step on the card.
- The rail and board suggest two different navigation models.

## Minor Observations

- Finished mixes completed and cancelled work, which weakens the meaning of a successful result.
- An empty initialized board does not guide a new user toward creating and running a first task.
- The editor palette is drag-first; a click-to-place option would lower the barrier.

## Questions to Consider

- Is the Work board an all-state dashboard, or a queue a developer actively works through?
- What must a developer know within ten seconds of seeing Needs attention?
- Should Start Run read like a button, or like a small execution contract?
- Can Flow remain useful when a terminal, editor, and browser share a 13-inch screen?
