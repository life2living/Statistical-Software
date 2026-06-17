from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.storage import store


client = TestClient(app)


@pytest.fixture()
def reliability_dataset() -> Iterator[str]:
    dataset = store.add_dataset(
        "prj_demo",
        "Reliability sample",
        "test:reliability",
        [
            {"time": 5.0, "event": 1, "batch": "A"},
            {"time": 8.0, "event": 0, "batch": "A"},
            {"time": 10.0, "event": 1, "batch": "A"},
            {"time": 7.0, "event": 1, "batch": "B"},
            {"time": 9.0, "event": 0, "batch": "B"},
        ],
    )
    try:
        yield dataset.id
    finally:
        for run_id, run in list(store.analysis_runs.items()):
            if run.dataset_id == dataset.id:
                del store.analysis_runs[run_id]
        store.rows.pop(dataset.id, None)
        store.datasets.pop(dataset.id, None)
        store.save()


def test_reliability_survival_api_returns_kaplan_meier_groups(reliability_dataset: str) -> None:
    response = client.post(
        "/analysis/run",
        json={
            "dataset_id": reliability_dataset,
            "method": "reliability_survival",
            "columns": ["time"],
            "parameters": {"event": "event", "by": "batch"},
        },
    )

    assert response.status_code == 200
    result = response.json()["outputs"]["reliability_survival"]
    assert result["time"] == "time"
    assert result["event"] == "event"
    assert len(result["groups"]) == 2
    assert result["groups"][0]["curve"][0]["survival"] == 1.0
