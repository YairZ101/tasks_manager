# Responsive Flow Editor

> Superseded in part by [NARROW-WINDOW-FLOW-EDITOR.md](./NARROW-WINDOW-FLOW-EDITOR.md), which removes the 768-pixel minimum.

Date: 2026-07-31

This decision refines the three-column Flow Editor described in [OUTCOME-FLOW-ENGINE.md](./OUTCOME-FLOW-ENGINE.md). It preserves the Block palette, canvas, and inspector model while replacing the rule that disables editing below 960 pixels.

## Context

The Flow Editor is a primary authoring surface. The product is intended for laptop and desktop use, but the existing editor disappears in compact desktop windows, including the 779-pixel viewport available in the Codex in-app browser.

## Decision

- Entering a Flow opens a focused editor workspace. Global navigation and the page header yield their space to the editor until the user returns to the Flow library.
- The canvas is always the primary surface on supported desktop widths.
- Wide windows dock the Block palette on the left and inspector on the right.
- Compact desktop windows keep the same palette, canvas, and inspector, but show one side panel at a time as an overlay drawer.
- Selecting or creating a Block opens its inspector. Escape, the drawer close action, or the backdrop returns focus to the canvas.
- Palette items support click-to-add at the canvas center as well as drag-to-position. Dragging is never the only authoring path.
- The minimum supported editor width is 768 CSS pixels. Narrower layouts may show an unsupported-width notice because mobile use is outside V1 scope.

## Responsive Behavior

Panel placement changes with available space; information architecture and control names do not. Save, validation, and publish status remain visible in the editor toolbar. Compact layouts may split that toolbar into context and action rows rather than removing actions.

## Verification

Component tests cover panel controls, click-to-add, inspector opening, and existing save/publish behavior. Browser verification covers the compact Codex viewport and a wide desktop viewport.
