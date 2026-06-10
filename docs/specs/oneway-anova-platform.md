# Oneway ANOVA Platform

## JMP Observation

In JMP Pro 17, `Analyze > Fit Y by X` opens a launch dialog with a column list and role targets for Y, X, Block, Weight, Freq, and By. When the user assigns a continuous response to Y and a categorical factor to X, the platform indicator switches to Oneway.

Observed with `data.xlsx` converted to `data.jmp`:

- Y: `EDAselectivity`
- X: `Load`
- Output title: `"Load-EDAselectivity" Oneway Analysis`
- The default output is a vertical point plot by factor level.
- The report showed one populated level, `Very high`, plus 357 missing rows, so the ANOVA table cannot be computed for this dataset/factor pair.
- The red triangle menu includes appendable reports and display toggles: quantiles, means/ANOVA, means and standard deviations, compare means, nonparametric tests, unequal variances, normal quantile plot, density, save residuals/predicted values, and display options such as points, box plot, mean diamonds, mean line, mean confidence interval line, and jitter.

## StatFlow Scope

StatFlow implements the clean-room Oneway subset behind the existing Fit Y by X launch dialog:

- Continuous Y plus categorical X calls `oneway_anova`.
- Continuous Y plus numeric X keeps the existing linear Fit Y by X path.
- Oneway output contains a categorical point plot, optional mean line, optional mean 95% intervals, group summary, ANOVA table, and optional Tukey-Kramer HSD comparisons from the red triangle menu.
- When fewer than two populated factor levels exist, the API returns group summaries and `anova.status = "insufficient_levels"` instead of pretending a test exists.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "oneway_anova",
  "columns": ["EDAselectivity", "Load"]
}
```

Returns `outputs.oneway_anova` with:

- `groups[]`: level, n, mean, std, stderr, lower95, upper95, min, max
- `anova.source[]`: factor, error, and total rows with SS, DF, MS, F ratio, and p-value
- `comparisons[]`: Tukey-Kramer pairwise differences when residual variance and two or more levels are available
- `points[]`: plotted observations with `rowIndex` for future linked brushing

## Math

The ANOVA decomposition uses the public fixed-effects one-way model:

- `SS_between = sum(n_i * (mean_i - grand_mean)^2)`
- `SS_within = sum(sum((y_ij - mean_i)^2))`
- `F = MS_between / MS_within`

P-values use SciPy's public F distribution survival function. Tukey-Kramer comparisons use SciPy's studentized range survival function with unequal group-size standard errors.
