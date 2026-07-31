# Narrow-window Flow Editor

> Superseded in part by [DIRECT-BLOCK-SETTINGS.md](./DIRECT-BLOCK-SETTINGS.md), which removes the redundant Inspector toolbar button.

Date: 2026-07-31

This decision supersedes the 768-pixel minimum in [RESPONSIVE-FLOW-EDITOR.md](./RESPONSIVE-FLOW-EDITOR.md).

## Context

Flow is intended for laptop and desktop use, but a desktop window can be narrower than a conventional mobile breakpoint. Screen width should change the editor's density and panel placement without removing its authoring capability.

## Decision

- The Flow editor has no hard width blocker. Its compact desktop layout is optimized and tested from 520 CSS pixels upward; smaller windows degrade gracefully but are not a product target.
- The canvas remains available at every window width.
- Wide windows dock the Block library and inspector. Compact windows use overlay drawers, and very narrow windows make those drawers nearly full-width.
- The toolbar wraps into additional rows when needed. Blocks, Inspector, Save draft, and Publish version remain available.
- The minimap may be hidden in very narrow windows because it duplicates canvas navigation and obscures the graph. Zoom and fit controls remain available.
- This does not add mobile-device support. The supported usage context remains a laptop or desktop with keyboard and pointer input; touch targets, phone navigation, and portrait-device ergonomics are outside scope.

## Verification

Component coverage keeps the graph and click-to-add behavior available at 520 pixels. Browser verification exercises the editor below the former 768-pixel cutoff and confirms the toolbar, canvas, drawers, and clean draft state remain usable. A 320-pixel stress check confirms graceful degradation without making that width a supported product target.
