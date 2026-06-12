# Tabulate Platform

## Scope

- Add a first JMP-style Tabulate launch surface with drag-and-drop role boxes for numeric Y columns and grouping columns.
- Return grouped summary rows for count, missing, mean, standard deviation, min, and max.
- Add a red triangle menu on the Tabulate report to toggle Counts, Means, Std Dev, and Range columns.

## Backend

- `POST /analysis/run` with `method=tabulate` accepts:
  - `columns`: numeric Y columns.
  - `parameters.group_by`: optional categorical or numeric grouping columns.
- `tabulate_summary` groups rows by the provided group columns, then computes each numeric summary with the same sample standard deviation helper used elsewhere in StatFlow.

## Frontend

- Analyze > Tabulate opens a launch dialog instead of a standard CRUD table.
- Users can drag columns into `Y Columns` and `Grouping Columns`.
- The red triangle menu controls which statistic families are visible in the summary table.

## Validation

- Unit tests cover grouped numeric summaries and missing-value counts.
