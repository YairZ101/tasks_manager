# Flow Zoom Indicator

Date: 2026-07-31

## Decision

The canvas control group displays the current zoom as a rounded percentage beneath Zoom In, Zoom Out, and Fit View. The readout is non-interactive, uses tabular numerals, and announces changes as status text for assistive technology.

## Verification

The component test asserts the percentage format and confirms the value increases after Zoom In. Browser verification checks the indicator within the rendered control group and its updates across semantic zoom levels.
