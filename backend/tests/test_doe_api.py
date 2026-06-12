from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_generate_full_factorial_doe_creates_dataset_preview() -> None:
    response = client.post(
        "/doe/full-factorial",
        json={
            "project_id": "prj_demo",
            "name": "Test DOE",
            "factors": [
                {"name": "temperature", "low": 70, "high": 80},
                {"name": "pressure", "low": 4, "high": 6},
            ],
            "replicates": 1,
            "randomize": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["dataset"]["name"] == "Test DOE"
    assert payload["dataset"]["row_count"] == 4
    assert payload["rows"][0]["standard_order"] == 1
    assert payload["rows"][0]["temperature"] == 70
    assert payload["rows"][3]["pressure"] == 6
