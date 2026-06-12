from app.models import AnalysisRun, ChartEncoding, ChartSpec, SavedChart
from app.storage import InMemoryStore, now


def test_store_persists_datasets_charts_and_runs(tmp_path) -> None:
    store_path = tmp_path / "store.json"
    store = InMemoryStore(path=store_path)
    dataset = store.add_dataset("prj_demo", "Imported", "test", [{"x": 1.0, "group": "A"}])
    chart = SavedChart(
        **ChartSpec(
            dataset_id=dataset.id,
            name="X chart",
            chart_type="bar",
            encodings=ChartEncoding(x="group", y="x"),
            filters={},
            layout={},
        ).model_dump(exclude={"id"}),
        id="cht_test",
        created_at=now(),
    )
    run = AnalysisRun(
        id="ana_test",
        dataset_id=dataset.id,
        dataset_version=dataset.version,
        method="descriptive",
        inputs={"dataset_id": dataset.id},
        outputs={"descriptive": {"x": {"count": 1.0}}},
        interpretation=["ok"],
        status="completed",
        created_at=now(),
    )
    store.charts[chart.id] = chart
    store.analysis_runs[run.id] = run
    store.save()

    reloaded = InMemoryStore(path=store_path)

    assert dataset.id in reloaded.datasets
    assert reloaded.rows[dataset.id][0]["x"] == 1.0
    assert reloaded.charts["cht_test"].name == "X chart"
    assert reloaded.analysis_runs["ana_test"].outputs["descriptive"]["x"]["count"] == 1.0
