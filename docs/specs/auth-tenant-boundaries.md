# Auth And Tenant Boundaries

## Objective

Add a tenant boundary around StatFlow workspace, project, dataset, chart, analysis, model, and report resources so the analytical workspace can safely support multiple accounts when real authentication is introduced.

## Current Slice

- Accept `X-Tenant-ID` on API requests.
- Default to `tenant_demo` for local development and the seeded demo workspace.
- Return only workspaces whose `tenant_id` matches the current tenant.
- Scope projects through their parent workspace.
- Scope datasets, charts, analysis runs, and model runs through their parent project and workspace.
- Scope reports through their parent project and workspace.
- Return `404` for cross-tenant resource access so callers do not learn whether another tenant's resource exists.

## API Contract

- `GET /workspaces`: returns current tenant workspaces.
- `GET /projects?workspace_id=...`: validates the workspace belongs to the current tenant before listing.
- `POST /projects`: validates the target workspace belongs to the current tenant.
- `GET /datasets?project_id=...`: validates the project belongs to the current tenant before listing.
- `POST /datasets/import`: validates the target project belongs to the current tenant.
- `GET /datasets/{dataset_id}/preview`: validates dataset ownership.
- `POST /charts`, `GET /charts`: validates dataset ownership.
- `POST /analysis/run`, `GET /analysis/runs`: validates dataset ownership.
- `POST /models/run`, `GET /models/runs`: validates dataset ownership.
- `POST /fit-model/run`: validates dataset ownership.
- `POST /fit-model/save-diagnostics`: validates the saved Fit Model run's dataset ownership before mutating rows.
- `POST /reports`, `GET /reports`: validates project ownership.

## Future Authentication Hook

Replace `current_tenant_id()` with an authentication dependency that derives the tenant from a signed session, OAuth identity, or API key. The resource guard functions can remain the enforcement layer.

## Clean-Room Notes

This is product security and application architecture work; it does not depend on JMP proprietary behavior. The implementation uses FastAPI dependency injection and existing StatFlow models.
