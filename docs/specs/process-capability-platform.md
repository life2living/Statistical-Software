# Process Capability Platform

## Product Intent

Lean Six Sigma users need a focused capability workflow: pick a measurement column, enter specification limits, then review short-term and overall capability indices. JMP-style quality platforms follow the same launch-dialog pattern as other analyses, with role boxes and red-triangle report menus. StatFlow implements that interaction pattern with clean-room statistical formulas.

## User Outcomes

- Users can open a Process Capability platform from the top-level SPC control.
- Users assign a numeric measurement into `Y, Process` and enter optional `LSL`, `Target`, and `USL`.
- Running the platform returns:
  - sample size and missing count,
  - mean, sample standard deviation, and overall standard deviation,
  - Cp, Cpk, CPL, CPU,
  - Pp, Ppk, PPL, PPU,
  - observed out-of-spec counts and percent.
- Each output panel has a red-triangle menu to toggle summary statistics, capability indices, and out-of-spec diagnostics.

## Backend Contract

`POST /analysis/run`

```json
{
  "dataset_id": "ds_mixer_timeseries",
  "method": "process_capability",
  "columns": ["quality_score"],
  "parameters": {
    "lsl": 95,
    "target": 98,
    "usl": 100
  }
}
```

The response stores `outputs.process_capability`.

## Algorithms

- Mean and sample standard deviation follow public NIST/SEMATECH descriptive statistics formulas.
- Cp = `(USL - LSL) / (6 * sigma)`.
- CPL/CPU = distance from mean to spec limit divided by `3 * sigma`.
- Cpk = minimum of CPL and CPU when both limits exist.
- Pp/Ppk use the same MVP sigma until subgroup/within-sigma estimation is added.

## Non-Goals

- Within-subgroup sigma estimation.
- Non-normal capability.
- JMP report formatting or proprietary tests.

## Validation

- Unit tests cover two-sided specs, one-sided specs, missing values, and zero-variance data.
- Frontend build must pass.
- `data.xlsx` must run through importer plus the backend capability API.
