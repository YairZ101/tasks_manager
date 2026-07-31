# Full-viewport App Shell

Date: 2026-07-31

## Context

At compact desktop widths, the responsive navigation row and workspace used separate viewport-height calculations. Their values did not match the navigation's rendered height, so the document became taller than the browser. The resulting vertical scrollbar also reduced the usable width. In the Flow editor, the closed empty inspector remained in grid flow and reduced the canvas to one row of the available editor space.

## Decision

- The app shell owns exactly one dynamic viewport height and one viewport width at every responsive state.
- Compact navigation and workspace use a two-row grid: the navigation takes its content height and the workspace receives the exact remaining space.
- The document does not scroll around the app shell. Individual product surfaces own their internal overflow.
- Compact editor drawers are removed from grid flow whether they contain an inspector form or the empty selection state.

## Verification

Browser measurements compare the app shell, editor, canvas, and document bounds with the browser viewport at compact and wide desktop sizes. Component coverage guards the compact grid and drawer positioning rules.
