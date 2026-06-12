from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Dataset, Project, Workspace
from app.storage import infer_profiles, now, store


client = TestClient(app)


@pytest.fixture()
def other_tenant_dataset() -> Iterator[str]:
    workspace_id = "ws_test_other"
    project_id = "prj_test_other"
    dataset_id = "ds_test_other"
    rows = [
        {"measurement": 10.0, "lot": "A"},
        {"measurement": 12.0, "lot": "A"},
        {"measurement": 14.0, "lot": "B"},
    ]

    store.workspaces[workspace_id] = Workspace(id=workspace_id, name="Other Tenant", tenant_id="tenant_other", created_at=now())
    store.projects[project_id] = Project(id=project_id, workspace_id=workspace_id, name="Hidden Project", created_at=now())
    store.datasets[dataset_id] = Dataset(
        id=dataset_id,
        project_id=project_id,
        name="Hidden Dataset",
        source="test:tenant-boundary",
        version=1,
        row_count=len(rows),
        timestamp_column=None,
        equipment_tag=None,
        sampling_rate=None,
        columns=infer_profiles(rows),
        created_at=now(),
    )
    store.rows[dataset_id] = rows

    try:
        yield dataset_id
    finally:
        for run_id, run in list(store.analysis_runs.items()):
            if run.dataset_id == dataset_id:
                del store.analysis_runs[run_id]
        for chart_id, chart in list(store.charts.items()):
            if chart.dataset_id == dataset_id:
                del store.charts[chart_id]
        for report_id, report in list(store.reports.items()):
            if report.project_id == project_id:
                del store.reports[report_id]
        store.rows.pop(dataset_id, None)
        store.datasets.pop(dataset_id, None)
        store.projects.pop(project_id, None)
        store.workspaces.pop(workspace_id, None)
        store.save()


def test_default_tenant_cannot_see_or_run_other_tenant_dataset(other_tenant_dataset: str) -> None:
    datasets_response = client.get("/datasets")
    assert datasets_response.status_code == 200
    assert other_tenant_dataset not in {dataset["id"] for dataset in datasets_response.json()}

    preview_response = client.get(f"/datasets/{other_tenant_dataset}/preview")
    assert preview_response.status_code == 404

    run_response = client.post(
        "/analysis/run",
        json={"dataset_id": other_tenant_dataset, "method": "descriptive", "columns": ["measurement"]},
    )
    assert run_response.status_code == 404


def test_matching_tenant_can_access_own_dataset(other_tenant_dataset: str) -> None:
    headers = {"X-Tenant-ID": "tenant_other"}

    preview_response = client.get(f"/datasets/{other_tenant_dataset}/preview", headers=headers)
    assert preview_response.status_code == 200
    assert preview_response.json()["dataset"]["id"] == other_tenant_dataset

    run_response = client.post(
        "/analysis/run",
        headers=headers,
        json={"dataset_id": other_tenant_dataset, "method": "descriptive", "columns": ["measurement"]},
    )
    assert run_response.status_code == 200
    run = run_response.json()
    assert run["dataset_id"] == other_tenant_dataset

    default_runs_response = client.get("/analysis/runs")
    assert default_runs_response.status_code == 200
    assert run["id"] not in {analysis_run["id"] for analysis_run in default_runs_response.json()}

    tenant_runs_response = client.get("/analysis/runs", headers=headers)
    assert tenant_runs_response.status_code == 200
    assert run["id"] in {analysis_run["id"] for analysis_run in tenant_runs_response.json()}
