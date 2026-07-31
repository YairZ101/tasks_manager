# Direct Block Settings

Date: 2026-07-31

## Context

The compact Flow editor opened Block settings when a Block was selected, but also displayed a separate Inspector button that reopened the same panel. The extra control duplicated the direct canvas interaction and introduced an internal product term users had to interpret.

## Decision

- Clicking or keyboard-activating a Block opens its settings panel.
- Dragging a Block selects and repositions it without opening settings; only explicit activation opens the panel.
- Clicking the flow background closes Block settings and clears the Block selection.
- The toolbar does not include a separate Inspector or Block settings button.
- The Blocks button remains because adding a new Block has no equivalent target on the existing canvas.

## Verification

Component and browser tests cover the distinction between dragging and explicit activation, background dismissal, and the absence of the redundant Inspector button.
