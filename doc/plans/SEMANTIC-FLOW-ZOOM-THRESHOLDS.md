# Semantic Flow Zoom Thresholds

Date: 2026-07-31

## Decision

- Overview applies from the 20% minimum zoom through 24%.
- Compact begins at 25% and applies through 65%.
- Detail begins at 66% and applies through the 160% maximum zoom.

The thresholds are inclusive at the start of each richer presentation level: exactly 25% is Compact and exactly 66% is Detail.

## Verification

Boundary tests cover the value immediately below each threshold, the threshold itself, and the maximum zoom. Browser verification confirms the canvas changes presentation at 25% and 66%.
