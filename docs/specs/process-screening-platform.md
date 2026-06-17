# Process Screening Platform

## Objective

Add a first process screening workflow that scans many numeric process columns for simple stability signals.

## Behavior

- Users open Analyze > Process Screening.
- The launch panel accepts one or more numeric Y columns and includes an All Numeric shortcut.
- The backend returns one screening row per process column:
  - `n`
  - `missing`
  - `mean`
  - `std`
  - 3-sigma `lcl` and `ucl`
  - mean moving range
  - count of points outside 3-sigma limits
  - stability score
- Results are sorted with columns having more 3-sigma violations first.
- The frontend renders a scan table and highlights columns with violations.

## Algorithm Source

The first slice uses public Shewhart 3-sigma screening and moving range summaries. The stability score is a simple deterministic triage metric combining 3-sigma violation rate and missingness; it is not copied from a proprietary platform.
