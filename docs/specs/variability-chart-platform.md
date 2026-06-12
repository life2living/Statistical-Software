# Variability Chart Platform

## JMP Observation

JMP variability workflows use launch-dialog roles for a numeric response and grouping factors, then render raw measurements alongside group summaries. StatFlow implements the first clean-room slice with JMP-style roles and report options.

## Scope

- Roles: Y, X, By.
- Output: raw measurement points by X group, optional group mean line, and group summary table.
- Red triangle menu: show/hide group mean line.
- By is accepted by the API and returned on points/groups; the first UI slice renders the grouped X summaries in one panel.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "variability_chart",
  "columns": ["measurement"],
  "parameters": {
    "x": "batch",
    "by": "line"
  }
}
```

Returns `outputs.variability_chart`:

- `overall`: overall mean, sample standard deviation, and range.
- `groups`: per-X summaries with N, mean, sample standard deviation, min, max, and range.
- `points`: row-linked raw observations with group mean.

## Math

Variability summaries use public descriptive-statistics formulas:

- Group mean is arithmetic mean.
- Group standard deviation is sample standard deviation.
- Group range is `max - min`.
