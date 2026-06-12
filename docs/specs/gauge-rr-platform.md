# Gauge R&R Platform

## JMP Observation

JMP measurement-system workflows use launch-dialog roles for measurement response, part, and operator, then report ANOVA tables and variance components. StatFlow implements the same clean-room interaction pattern for the first crossed, balanced Gauge R&R slice.

## Scope

- Roles: Measurement, Part, Operator.
- Design: crossed and balanced, with every part/operator cell measured at least twice.
- Output: ANOVA EMS table, variance components, % contribution, % study variation, and NDC.
- Red triangle menu: show/hide ANOVA table.

## API

`POST /analysis/run`

```json
{
  "dataset_id": "ds_x",
  "method": "gauge_rr",
  "columns": ["measurement"],
  "parameters": {
    "part": "part_id",
    "operator": "operator_id"
  }
}
```

Returns `outputs.gauge_rr`:

- `anova`: Part, Operator, Part*Operator, and Repeatability rows.
- `components`: Total Gauge R&R, Repeatability, Reproducibility, Operator, Part*Operator, Part-To-Part, and Total Variation.
- `metrics`: Gauge R&R % study variation, Part-To-Part % study variation, and NDC.

## Math

The first slice uses public AIAG/NIST crossed ANOVA expected-mean-square formulas:

- `Repeatability Var = MS_repeatability`
- `Part*Operator Var = max((MS_part_operator - MS_repeatability) / repeats, 0)`
- `Operator Var = max((MS_operator - MS_part_operator) / (parts * repeats), 0)`
- `Reproducibility Var = Operator Var + Part*Operator Var`
- `Part-To-Part Var = max((MS_part - MS_part_operator) / (operators * repeats), 0)`
- `Total Gauge R&R Var = Repeatability Var + Reproducibility Var`
- `% Study Variation = 100 * component_stddev / total_stddev`
- `NDC = 1.41 * part_to_part_stddev / gauge_rr_stddev`
