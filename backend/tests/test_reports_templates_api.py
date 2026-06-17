from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.storage import store


client = TestClient(app)


def test_analysis_template_can_rerun_and_report_exports_html() -> None:
    template_response = client.post(
        "/analysis/templates",
        json={
            "project_id": "prj_demo",
            "dataset_id": "ds_mixer_timeseries",
            "name": "Capability screening template",
            "description": "Reusable distribution launch roles.",
            "method": "distribution",
            "columns": ["quality_score"],
            "parameters": {},
        },
    )
    assert template_response.status_code == 200
    template = template_response.json()
    assert template["method"] == "distribution"
    assert template["columns"] == ["quality_score"]

    rerun_response = client.post(f"/analysis/templates/{template['id']}/run")
    assert rerun_response.status_code == 200
    run = rerun_response.json()
    assert run["method"] == "distribution"
    assert run["outputs"]["distribution"]["columns"][0]["name"] == "quality_score"

    report_response = client.post("/reports", json={"project_id": "prj_demo", "name": "Daily quality report"})
    assert report_response.status_code == 200
    report = report_response.json()

    block_response = client.post(
        f"/reports/{report['id']}/blocks",
        json={
            "type": "analysis",
            "title": "Quality distribution",
            "ref_id": run["id"],
        },
    )
    assert block_response.status_code == 200
    assert block_response.json()["blocks"][-1]["ref_id"] == run["id"]

    export_response = client.get(f"/reports/{report['id']}/export/html")
    assert export_response.status_code == 200
    assert "text/html" in export_response.headers["content-type"]
    assert "Daily quality report" in export_response.text
    assert "Quality distribution" in export_response.text
    assert "quality_score" in export_response.text


def test_templates_and_reports_are_tenant_scoped() -> None:
    hidden_template_ids: list[str] = []
    hidden_report_ids: list[str] = []
    try:
        template_response = client.post(
            "/analysis/templates",
            headers={"X-Tenant-ID": "tenant_other"},
            json={
                "project_id": "prj_demo",
                "dataset_id": "ds_mixer_timeseries",
                "name": "Hidden template",
                "method": "descriptive",
                "columns": ["quality_score"],
            },
        )
        assert template_response.status_code == 404

        visible_template = client.post(
            "/analysis/templates",
            json={
                "project_id": "prj_demo",
                "dataset_id": "ds_mixer_timeseries",
                "name": "Visible template",
                "method": "descriptive",
                "columns": ["quality_score"],
            },
        ).json()
        hidden_template_ids.append(visible_template["id"])

        denied_template = client.post(
            f"/analysis/templates/{visible_template['id']}/run",
            headers={"X-Tenant-ID": "tenant_other"},
        )
        assert denied_template.status_code == 404

        report = client.post("/reports", json={"project_id": "prj_demo", "name": "Visible report"}).json()
        hidden_report_ids.append(report["id"])

        denied_report = client.get(f"/reports/{report['id']}/export/html", headers={"X-Tenant-ID": "tenant_other"})
        assert denied_report.status_code == 404
    finally:
        for template_id in hidden_template_ids:
            store.analysis_templates.pop(template_id, None)
        for report_id in hidden_report_ids:
            store.reports.pop(report_id, None)
        store.save()
