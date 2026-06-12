# Local Persistence

## Scope

StatFlow now persists the MVP workspace state to a local JSON store before the PostgreSQL production slice.

Persisted objects:

- Workspaces and projects.
- Dataset metadata and row snapshots.
- Saved chart specs.
- Analysis runs.
- Model and Fit Model runs.
- Reports.
- Analysis templates.

## Runtime

The default path is `.statflow/store.json` at the repository root. It can be overridden with `STATFLOW_STORE_PATH`.

The file is intentionally ignored by Git. It is local state, not source code.

## API

New readback endpoints:

- `GET /analysis/runs?dataset_id=...`
- `GET /models/runs?dataset_id=...`
- `GET /reports?project_id=...`

Existing write endpoints call `store.save()` after mutation.
