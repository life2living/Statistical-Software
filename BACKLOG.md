# StatFlow Backlog

## Repository Notes

- Remote `origin/dev` is not present; active integration branch is `feat/linked-brushing-red-menu`, based on `origin/main`.
- Development follows clean-room JMP observation: replicate interaction paradigms and statistical behavior with open-source math libraries, not proprietary assets or text.

## P0 Core JMP Interaction Layer

- [x] Linked brushing between data table and active graphs.
- [x] Launch dialogs with role boxes for Distribution, Fit Y by X, Fit Model, Process Capability, Oneway, and Multivariate.
- [x] Red triangle report menus on implemented analytical panels.
- [ ] Persist analysis runs, chart specs, reports, and scripts beyond in-memory MVP storage.
- [ ] Add project/workspace auth and tenant boundaries.

## P1 Statistical Platforms

- [x] Distribution with Y, By, Freq, Weight and normal curve option.
- [x] Fit Y by X for continuous Y and continuous X.
- [x] Oneway ANOVA for continuous Y and categorical X.
- [x] Multivariate correlations with p-value and covariance displays.
- [x] Process capability with spec limits and capability indices.
- [ ] Control Chart Builder with I-MR, Xbar-R, P/NP/C/U charts, rules, and phase handling.
- [ ] Fit Model ANOVA tables, term effects, residual diagnostics, and lack-of-fit.
- [ ] Tabulate platform for grouped summary tables.
- [ ] Pareto, Gauge R&R, Variability Chart, and measurement system analysis.

## P2 Modeling And Quality Workflows

- [ ] Prediction Profiler refinements: desirability, lock factors, confidence intervals.
- [ ] Model comparison and validation splits.
- [ ] DOE import/generation workflow.
- [ ] Reliability/survival first slice.
- [ ] Process screening across many variables.

## P3 Productization

- [ ] PostgreSQL/TimescaleDB storage, Parquet snapshots, and result cache.
- [ ] Async worker queue for long-running analyses.
- [ ] Report builder with exportable HTML/PDF.
- [ ] Saved reusable analysis templates.
- [ ] Audit log, permissions, and deployment hardening.
