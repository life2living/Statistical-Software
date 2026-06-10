# Multivariate Correlation Platform

## JMP Observation

In JMP Pro 17, `Analyze > Multivariate Methods > Multivariate` opens a launch dialog titled Multivariate and Correlations. It has a column list and role targets:

- `Y, Columns` for multiple numeric variables
- `Weight`
- `Freq`
- `By`

The dialog also exposes variance estimate and matrix format controls. The default report contains a Correlations table and a scatterplot matrix. The red triangle menu can append correlation probabilities, confidence intervals, inverse correlations, partial correlations, covariance matrix, pairwise correlations, simple statistics, nonparametric correlations, color maps, scatterplot matrix, parallel coordinate plot, outlier analysis, reliability, filters, rerun actions, and script saving.

## StatFlow Scope

The first clean-room StatFlow implementation includes:

- A Multivariate launch dialog with multi-column Y role assignment.
- Backend `multivariate` analysis using pairwise complete rows.
- Pearson correlation matrix.
- Two-sided p-value matrix for Pearson correlations.
- Sample covariance matrix.
- Simple per-column statistics.
- A red triangle menu that switches correlation heatmap, p-value map, covariance matrix, and simple statistics.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "multivariate",
  "columns": ["PIP100selectivity", "EDAselectivity", "DETaselectivity"]
}
```

Returns `outputs.multivariate`:

- `columns`: selected numeric columns
- `matrix`: pairwise `r`, `p_value`, and `n`
- `covariance`: sample covariance matrix
- `summaries`: n, mean, sample standard deviation, and missing count per column

## Math

Pearson correlation uses the public covariance formula:

- `r = Sxy / sqrt(Sxx * Syy)`
- `t = |r| * sqrt((n - 2) / (1 - r^2))`
- two-sided `p = 2 * sf(t, n - 2)`

SciPy supplies the Student t survival function. Covariance uses the sample denominator `n - 1`.
