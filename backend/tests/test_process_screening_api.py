from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_process_screening_api_screens_numeric_columns() -> None:
    response = client.post(
        "/analysis/run",
        json={
            "dataset_id": "ds_mixer_timeseries",
            "method": "process_screening",
            "columns": ["pressure_bar", "temperature_c", "vibration_g"],
        },
    )

    assert response.status_code == 200
    result = response.json()["outputs"]["process_screening"]
    assert result["screened_count"] == 3
    assert {row["column"] for row in result["columns"]} == {"pressure_bar", "temperature_c", "vibration_g"}
    assert all("stability_score" in row for row in result["columns"])
