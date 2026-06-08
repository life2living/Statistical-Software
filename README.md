# Industrial Statistical Analytics

Web SaaS MVP for an industrial statistical analysis product inspired by JMP/JMP Pro workflows.

The first slice includes:

- FastAPI backend with workspace, project, dataset, chart, analysis, model, and report APIs.
- Python analysis engine for descriptive statistics, correlation, SPC, process capability, and linear regression.
- Built-in sample industrial time-series dataset plus CSV/XLSX upload.
- React + TypeScript frontend with a Graph Builder-style chart configuration surface.
- ECharts rendering for line, area, scatter, histogram, box, bar, stacked bar, pie, heatmap, and control charts.

## Structure

```text
backend/
  app/
    analysis.py       # Statistical functions
    main.py           # FastAPI routes
    models.py         # Public API models
    sample_data.py    # Industrial sample dataset
    storage.py        # In-memory MVP storage
    importers.py      # CSV/XLSX import
  tests/
    test_analysis.py
frontend/
  src/
    App.tsx
    api.ts
    main.tsx
    types.ts
```

## Run Backend

```powershell
cd "C:\Users\OptiX\.codex\0. Project\2. Software Products\2.3 Industrial Statistical Analytics\backend"
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: <http://127.0.0.1:8000/docs>

## Run Frontend

```powershell
cd "C:\Users\OptiX\.codex\0. Project\2. Software Products\2.3 Industrial Statistical Analytics\frontend"
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

Open: <http://127.0.0.1:5175>

## Current MVP Boundaries

- Data is stored in memory so the full workflow is easy to run locally.
- OPC UA/MQTT/TimescaleDB/Celery are represented by API and module boundaries, not implemented as production infrastructure yet.
- Python is the source of truth for analysis results; the frontend only configures and renders.

## Revised Product Architecture

The production data layer should split hot and cold access paths:

- Hot preview path: Graph Builder uses sampled or downsampled data from TimescaleDB continuous aggregates/materialized views so drag-and-drop interactions return in under 1 second.
- Cold analysis path: full SPC, regression, ANOVA, and model jobs read versioned Parquet snapshots with Polars in async workers.
- Raw preservation path: uploads and connector payloads are stored unchanged before typed analytical datasets are derived.

`ChartSpec` is a first-class product asset:

- Store a versioned JSON spec with `schemaVersion`, renderer metadata, field encodings, filters, aggregation, and layout.
- Use the same spec for browser rendering, Python-side recomputation, report rendering, and future PDF/HTML export.
- Keep renderer-specific details under `layout.rendererOptions` so ECharts can be replaced or supplemented later without invalidating saved work.

Add a result cache between FastAPI and the Python analysis engine:

- Cache key: `tenant_id + dataset_version_hash + analysis_method + analysis_params_hash`.
- Small repeated analyses can return immediately from Redis.
- Long-running cold-path jobs should still go through a worker queue.

Design multi-tenancy from v1:

- PostgreSQL/TimescaleDB tables should include `tenant_id` and enforce row-level security.
- Object storage paths should use `tenant_id/project_id/dataset_id/version/`.
- Every saved chart, analysis run, model run, report, and template should carry tenant and dataset version provenance.

Add `AnalysisTemplate` as a reusable workflow object:

- It stores parameterized analysis steps, chart specs, filters, and expected input roles.
- Users can replay the same analysis flow on a new dataset with compatible columns.
- This is the enterprise analogue of JMP analysis scripts.

## Next Implementation Steps

1. Foundation: replace in-memory storage with PostgreSQL/TimescaleDB models, auth, workspace/project/dataset entities, and tenant RLS.
2. Data ingestion: keep CSV/XLSX import, add Parquet persistence, then add one OPC UA connector.
3. Graph Builder v1: harden multi-field ChartSpec, filters, sampling, and ECharts rendering.
4. Basic statistics: descriptive statistics, correlation, regression, and ANOVA.
5. SPC + process capability: I-MR, Xbar-R, CUSUM, capability indices, subgroup handling, and spec-limit workflows.
6. Modeling v1: supervised learning, cross-validation, feature importance, and model comparison.
