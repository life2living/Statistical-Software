# DOE Generation Workflow

## Objective

Add a first DOE workflow so practitioners can generate a clean full-factorial design table inside StatFlow and then use the existing graphing, modeling, and export paths.

## Behavior

- `POST /doe/full-factorial` accepts factor names, low/high levels, replicate count, randomization flag, and seed.
- The backend creates a dataset in the current project and returns a `DatasetPreview`.
- Generated rows include:
  - `standard_order`
  - `replicate`
  - factor columns
  - `run_order`
- Randomization is deterministic for a given seed.
- The frontend exposes Analyze > DOE with editable factor rows, Add Factor, Generate, Reset, replicates, seed, and randomize controls.
- Generated DOE datasets are immediately loaded into the data table and can be used by Graph Builder and modeling workflows.

## Algorithm Source

Full-factorial design generation uses the public Cartesian product of factor levels, equivalent to standard DOE full-factorial construction. Randomization uses deterministic seeded shuffling from Python's standard library.
