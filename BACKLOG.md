# StatFlow Backlog

## Repository Notes

- Remote `origin/dev` is not present; active integration branch is `feat/linked-brushing-red-menu`, based on `origin/main`.
- Development follows clean-room JMP observation: replicate interaction paradigms and statistical behavior with open-source math libraries, not proprietary assets or text.

## P0 Core JMP Interaction Layer

- [x] Linked brushing between data table and active graphs.
- [x] Launch dialogs with role boxes for Distribution, Fit Y by X, Fit Model, Process Capability, Oneway, and Multivariate.
- [x] Red triangle report menus on implemented analytical panels.
- [x] Persist analysis runs, chart specs, reports, and scripts beyond in-memory MVP storage.
- [ ] Add project/workspace auth and tenant boundaries.

## P1 Statistical Platforms

- [x] Distribution with Y, By, Freq, Weight and normal curve option.
- [x] Fit Y by X for continuous Y and continuous X.
- [x] Oneway ANOVA for continuous Y and categorical X.
- [x] Multivariate correlations with p-value and covariance displays.
- [x] Process capability with spec limits and capability indices.
- [x] Control Chart Builder I-MR first slice with Y, subgroup/time, phase roles, limits, and rule-violation table.
- [x] Control Chart Builder Xbar-R first slice with subgroup mean and range charts.
- [x] Control Chart Builder P/NP/C/U attribute chart first slice.
- [x] Control Chart Builder extended rules and full phase-limit recomputation.
- [x] Fit Model ANOVA tables, term effects, parameter estimates, and residual diagnostics.
- [x] Fit Model red triangle menu expansion with Factor Profiler toggle, AICc, and saved diagnostic columns.
- [x] Fit Model effect leverage plots and prediction formula columns.
- [x] Fit Model lack-of-fit test with pure-error decomposition.
- [x] Prediction Profiler mean-response confidence intervals.
- [x] Fit Model richer profiler options, desirability, lock factors, and formula-column execution.
- [x] Tabulate platform first slice for grouped summary tables.
- [x] Pareto platform first slice with Freq, By, cumulative percent, and red-triangle toggle.
- [x] Gauge R&R crossed ANOVA first slice with variance components and NDC.
- [x] Variability Chart first slice with Y, X, By, raw points, mean line, and group summaries.
- [x] Expanded measurement system analysis fallback and cell summaries.

## P2 Modeling And Quality Workflows

- [ ] Prediction Profiler refinements: desirability and lock factors.
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
