from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_linear_model_run_accepts_validation_fraction_and_lists_comparison_runs() -> None:
    run_response = client.post(
        "/models/run",
        json={
            "dataset_id": "ds_mixer_timeseries",
            "model_type": "linear_regression",
            "target": "pressure_bar",
            "features": ["temperature_c"],
            "parameters": {"validation_fraction": 0.2},
        },
    )
    assert run_response.status_code == 200
    run = run_response.json()

    assert run["metrics"]["train_n"] > 0
    assert run["metrics"]["validation_n"] > 0
    assert run["metrics"]["validation_fraction"] == 0.2
    assert any(prediction["split"] == "validation" for prediction in run["predictions"])

    runs_response = client.get("/models/runs?dataset_id=ds_mixer_timeseries&model_type=linear_regression")
    assert runs_response.status_code == 200
    assert run["id"] in {item["id"] for item in runs_response.json()}
