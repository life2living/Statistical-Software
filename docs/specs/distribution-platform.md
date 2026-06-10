# Distribution Platform

## JMP Observation

JMP's analytical platforms launch from the data table with a column list and role boxes. Distribution follows that interaction pattern: users assign one or more response columns, optionally split results by a grouping column, and then operate on the output with a red-triangle menu to add or remove report sections and overlays. StatFlow implements the interaction pattern and recomputes all statistics with clean-room, open formulas.

## User Outcomes

- Users can open Analyze > Distribution from the main menu.
- Users drag columns from the left column pane into role boxes:
  - `Y`: one or more numeric response variables.
  - `By`: optional grouping variable for separate summaries.
  - `Freq`: optional non-negative numeric frequency column.
  - `Weight`: optional non-negative numeric analytical weight column.
- Running the platform calls the backend and returns durable numerical output.
- Each output panel has a red-triangle menu that toggles summary statistics, quantiles, and a normal curve overlay.
- Missing response values are excluded from calculations and reported.

## Backend Contract

`POST /analysis/run`

```json
{
  "dataset_id": "ds_mixer_timeseries",
  "method": "distribution",
  "columns": ["quality_score"],
  "parameters": {
    "by": "equipment_id",
    "freq": null,
    "weight": null
  }
}
```

The response stores `outputs.distribution.columns[]`, each with `groups[]`. Every group includes:

- `group`: group label or `All`.
- `n`: effective observation count after valid frequency and weight rules.
- `missing`: skipped rows for that response/group.
- `mean`, `std`, `stderr`, `min`, `max`.
- `quantiles`: `p0`, `p25`, `p50`, `p75`, `p100`.

## Algorithms

- Unweighted mean and sample standard deviation use the public NIST/SEMATECH descriptive statistics formulas.
- Frequency and weight roles are combined as a positive observation weight. Weighted sample variance uses the reliability-weighted unbiased denominator `sum(w) - sum(w^2) / sum(w)`.
- Quantiles use linear interpolation on the sorted empirical distribution, matching the app's current boxplot convention.

## Validation

- Backend unit tests cover missing values, grouping, frequency, and weight edge cases.
- Frontend build must pass.
- Manual browser validation must confirm launch roles, drag/drop assignment, red-triangle toggles, and report rendering with the sample dataset.
