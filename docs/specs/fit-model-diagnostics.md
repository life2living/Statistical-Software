# Fit Model Diagnostics

## JMP Observation

Observed the Fit Model launch workflow with `data.xlsx` by assigning `EDAselectivity` to Y and `PIP100selectivity` as the model effect under Standard Least Squares. The resulting report exposes a red triangle menu for appending/removing Fit Summary, ANOVA, Parameter Estimates, Effect Tests, Lack Of Fit, predicted-vs-actual, predicted-vs-residual, row diagnostics, and saved diagnostic columns. The first clean-room StatFlow slice implements the shared interaction pattern and the least-squares diagnostic tables, leaving lack-of-fit and saved columns for a follow-up because they require pure-error grouping and table persistence.

## Scope

- Extend Standard Least Squares with response-level ANOVA, parameter estimates, single-degree effect tests, and row residual diagnostics.
- Preserve launch-dialog roles for Y and model effects with drag-and-drop role boxes.
- Add a Fit Model red triangle menu to toggle ANOVA, parameter estimates, effect tests, and residual diagnostic views.
- Render predicted-vs-residual and predicted-vs-actual diagnostic plots using ECharts.
- Expand the top-left Fit Model red triangle menu with JMP-style report groups for display tables, profilers, row diagnostics, and saved columns.
- Support Factor Profiler show/hide from the red triangle menu.
- Save predicted values, residuals, studentized residuals, leverage, and Cook distance back into the active in-memory data table.

## Backend

- `POST /api/analysis/fit-model` returns:
  - `anova[response]`: Model, Error, and Total rows.
  - `parameter_estimates[response]`: estimate, standard error, t ratio, and two-sided t p-value.
  - `effect_tests[response]`: one-degree effect F tests for each non-intercept term.
  - `residuals[response]`: actual, predicted, raw residual, studentized residual, leverage, and Cook distance.
  - `information_criteria[response]`: AIC, AICc, and BIC from Gaussian OLS log-likelihood.
- `POST /fit-model/save-diagnostics` writes row diagnostics from a Fit Model run back to the source dataset and refreshes column profiles.
- Math uses ordinary least squares normal equations. Probability calculations use SciPy survival functions for F and t distributions.
- Missing rows are excluded per response/effect complete-case filtering.

## Frontend

- The Fit Model output keeps the existing Prediction Profiler and appends a response-specific diagnostics panel.
- The top-left report red triangle menu uses grouped actions for Fit Summary, ANOVA, Parameter Estimates, Effect Tests, AICc, Factor Profiler, row diagnostic plots, and saved diagnostic columns.
- Default launch behavior now chooses a numeric effect even when Graph Builder's X role contains a timestamp, so the sample dataset can run Fit Model immediately.

## Validation

- Unit tests verify ANOVA sums of squares, parameter estimates, residual rows, and non-perfect model diagnostics.
- The `data.xlsx` validation path compares a simple Standard Least Squares model against the JMP-observed report shape and expected table families.
