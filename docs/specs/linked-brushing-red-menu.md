# Linked Brushing and Plot Options

## JMP Observation

JMP Graph Builder is launched from a data table and keeps row selection as a shared row state. Its builder surface places role drop zones around the plot area, keeps the column list visible on the left, and exposes graph tools for selection and brushing. This StatFlow slice implements the same interaction paradigm without copying JMP assets or implementation details.

## User Outcomes

- Selecting a row in the data preview highlights the corresponding rendered point/bar/line marker in the active chart.
- Clicking a chart mark toggles the corresponding row selection in the data preview.
- Selection state is stored by preview row index and remains independent of chart type, analysis output, or local rendering details.
- A red-triangle-style plot menu on the active graph exposes contextual display actions.
- For histograms, the plot menu can append or remove a normal curve overlay computed from the active numeric values.

## Scope

- Frontend-only interaction state for the current in-memory preview page.
- Graph Builder chart surface and data preview table.
- Histogram normal curve overlay uses sample mean and sample standard deviation. The curve is scaled to histogram bin counts by `n * bin_width * normal_pdf(x)`.

## Non-Goals

- Cross-window synchronization across multiple browser tabs.
- Persistent row-state storage in the backend.
- JMP text, icons, proprietary binaries, or private algorithms.

## Components and APIs

- `App.tsx`
  - Add `selectedRows: Set<number>` and `showNormalCurve`.
  - Extend `buildOption(chartType, rows, zones, selectedRows, showNormalCurve)`.
  - Add chart click handler that toggles row selection only from explicit mark `rowIndex` metadata.
  - Add `DataPreviewTable` to render the current preview and toggle row selection.
  - Add `RedTriangleMenu` to control chart-local overlays.
- Backend APIs are unchanged for this slice.

## Validation

- Unit tests continue to cover backend statistical math.
- Frontend TypeScript build must pass.
- Manual browser validation should verify table-to-chart and chart-to-table linked selection on the sample dataset.

## Algorithm Source

The normal density equation follows the public NIST/SEMATECH e-Handbook normal distribution definition and is implemented directly in TypeScript.
