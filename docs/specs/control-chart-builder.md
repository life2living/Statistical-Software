# Control Chart Builder

## JMP Observation

In JMP Pro 17, `Analyze > Quality and Process > Control Chart Builder` opens an interactive builder rather than a static launch dialog. The left pane lists columns and a chart family selector defaults to Shewhart measurement charts. The central graphic area exposes drop zones for Y, phase, subgroup, and labels, with guidance that variables can be dragged into the graph area and that right-click/red-triangle style options enable warnings, limits, and statistics.

Related fixed chart entries are also available under `Analyze > Quality and Process > Control Charts`, including I-MR, Xbar, run chart, P, NP, C, U, CUSUM, and EWMA.

## StatFlow Scope

The clean-room Control Chart Builder implements I-MR and Xbar-R first slices:

- Roles: Y, Subgroup/Time, Phase.
- Output: Individuals chart and Moving Range chart in one panel.
- Xbar-R output: subgroup mean chart and subgroup range chart in one panel.
- Red triangle menu: show/hide rule violations.
- Rule coverage: points beyond displayed 3-sigma limits.
- Phase is captured as a role in the API and output points; full per-phase limit recomputation is left for the next slice.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "control_chart",
  "columns": ["EDAselectivity"],
  "parameters": {
    "chart_type": "imr",
    "x": "Timestamp",
    "phase": "Load"
  }
}
```

Returns `outputs.control_chart`:

- `individuals`: center, UCL, LCL, plotted points
- `moving_range`: MR-bar, UCL, LCL, plotted moving ranges
- `xbar`: Xbar-bar, UCL, LCL, subgroup mean points when `chart_type=xbar_r`
- `range`: R-bar, UCL, LCL, subgroup range points when `chart_type=xbar_r`
- `violations`: displayed rule violations

## Math

I-MR limits use public SPC formulas:

- `MR_i = abs(x_i - x_(i-1))`
- `MRbar = mean(MR_i)`
- `sigma = MRbar / d2`, with `d2 = 1.128` for moving ranges of 2
- `I UCL/LCL = xbar +/- 3 * sigma`
- `MR UCL = D4 * MRbar`, with `D4 = 3.267`; `MR LCL = 0` for ranges of 2

Xbar-R limits use public subgroup constants:

- `Xbarbar = mean(subgroup means)`
- `Rbar = mean(subgroup ranges)`
- `Xbar UCL/LCL = Xbarbar +/- A2 * Rbar`
- `R UCL = D4 * Rbar`; `R LCL = D3 * Rbar`
