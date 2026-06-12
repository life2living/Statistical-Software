# Pareto Platform

## JMP Observation

JMP quality workflows expose Pareto-style cause ranking through launch-dialog roles and report-level options. StatFlow implements the interaction pattern with clean-room frequency aggregation and cumulative percentages.

## Scope

- Roles: Cause, Freq, By.
- Output: count bars sorted descending by cause and optional cumulative percent line.
- Red triangle menu: show/hide cumulative percent line.
- By is accepted in the API and output groups; the first UI slice renders the first group.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "pareto",
  "columns": ["defect_type"],
  "parameters": {
    "count": "defect_count",
    "by": "line"
  }
}
```

Returns `outputs.pareto`:

- `category`: cause column.
- `count`: optional frequency column.
- `by`: optional grouping column.
- `groups`: grouped totals and sorted cause rows.
- `missing`: rows skipped because cause or frequency was missing/invalid.

## Math

Pareto counts use public quality-control frequency ranking:

- Count defaults to 1 per valid row unless a nonnegative Freq value is supplied.
- Causes are sorted by descending count with category-name tie break.
- Percent is `100 * count / total`.
- Cumulative percent is the running count divided by total.
