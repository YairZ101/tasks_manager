# Semantic Flow Zoom

> Superseded by [Shared App Icon System](SHARED-APP-ICON-SYSTEM.md) for icon selection and ownership.
> Zoom thresholds superseded by [Semantic Flow Zoom Thresholds](SEMANTIC-FLOW-ZOOM-THRESHOLDS.md).

The Flow canvas changes the information shown inside blocks as the user zooms, so the graph remains useful at every supported desktop window size.

- **Overview below 34%:** emphasize block identity, type color, name, and graph shape. Configuration, outcome text, and note copy are hidden; ports remain usable.
- **Compact from 34% to 77%:** show block type and name. Hide configuration details and outcome labels while preserving every connection handle.
- **Detail at 78% and above:** show the complete block summary, including configuration and outcome labels.

The thresholds are stable buckets applied after a viewport movement finishes. This avoids rerendering all nodes continuously during pan and zoom. Selecting a block opens its full inspector at every zoom level, and hover/accessibility labels always expose the block type and name.

Block geometry is fixed across all three modes. Hidden content keeps its layout space, so blocks and connection anchors do not jump when a zoom threshold is crossed.

Overview presents a counter-scaled outline icon unique to each block type. Compact presents the same icon, type, and block name with counter-scaled text. Detail presents the complete summary and outcomes. The minimum zoom is 20%, which keeps overview blocks large enough to select with a desktop pointer.

Decision uses the open branch symbol rather than a framed diamond, keeping its icon weight and construction consistent with the other block types.
