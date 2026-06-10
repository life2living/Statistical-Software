# Fit Y by X Platform

## JMP Observation

JMP analytical platforms use a launch dialog with a column list and role boxes, then produce an output report controlled by red-triangle menus. Fit Y by X is the bivariate launch pattern: users assign a response to `Y` and a factor/continuous predictor to `X`; the output adapts to the variable types. This StatFlow slice implements the numeric-by-numeric clean-room subset.

## User Outcomes

- Users can open Analyze > Fit Y by X from the main menu.
- Users drag a numeric response into `Y, Response` and a numeric predictor into `X, Factor`.
- Running the platform calls the backend and renders:
  - scatterplot-ready point data,
  - Pearson correlation,
  - least-squares line coefficients,
  - fit metrics including R², RMSE, SSE, and degrees of freedom.
- Each output panel has a red-triangle menu to toggle:
  - fit line,
  - confidence band,
  - residual table.

## Backend Contract

`POST /analysis/run`

```json
{
  "dataset_id": "ds_mixer_timeseries",
  "method": "fit_y_by_x",
  "columns": ["quality_score", "pressure_bar"]
}
```

The first column is `Y`; the second is `X`. The response stores `outputs.fit_y_by_x`.

## Algorithms

- Pearson correlation and ordinary least squares use public NIST/SEMATECH formulas for simple linear regression and correlation.
- Confidence bands use the standard mean-response interval formula:
  `yhat +/- t * s * sqrt(1/n + (x - xbar)^2 / Sxx)`.
- The initial confidence level is 95%; the backend returns the standard error for each fit-line point and the frontend owns the display toggle.

## Non-Goals

- Categorical X one-way ANOVA.
- Logistic or contingency workflows.
- Exact JMP formatting or proprietary report text.

## Validation

- Unit tests cover perfect linear fits, missing values, and degenerate X values.
- Frontend build must pass.
- `data.xlsx` must run through the importer and backend Fit Y by X API.
