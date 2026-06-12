from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_save_fit_model_diagnostics_can_include_prediction_formula_column() -> None:
    run_response = client.post(
        "/fit-model/run",
        json={
            "dataset_id": "ds_mixer_timeseries",
            "responses": ["pressure_bar"],
            "effects": ["temperature_c", "vibration_g"],
            "include_quadratic": False,
        },
    )
    assert run_response.status_code == 200
    run = run_response.json()
    assert "pressure_bar" in run["prediction_formulas"]
    assert run["effect_leverage"]["pressure_bar"]
    assert run["lack_of_fit"]["pressure_bar"]["status"] in {"ok", "not_estimable"}

    save_response = client.post(
        "/fit-model/save-diagnostics",
        json={"run_id": run["id"], "include_formula": True},
    )
    assert save_response.status_code == 200
    preview = save_response.json()
    column_names = [column["name"] for column in preview["dataset"]["columns"]]

    assert "pressure_bar Prediction Formula" in column_names
    assert "pressure_bar Predicted" in column_names
    assert preview["rows"][0]["pressure_bar Prediction Formula"].startswith("pressure_bar Predicted =")
