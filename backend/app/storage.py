from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .models import AnalysisTemplate, ColumnProfile, Dataset, Project, Report, SavedChart, Workspace
from .sample_data import build_sample_rows


def now() -> datetime:
    return datetime.now(timezone.utc)


class InMemoryStore:
    def __init__(self) -> None:
        self.workspaces: dict[str, Workspace] = {}
        self.projects: dict[str, Project] = {}
        self.datasets: dict[str, Dataset] = {}
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.charts: dict[str, SavedChart] = {}
        self.analysis_runs: dict[str, Any] = {}
        self.model_runs: dict[str, Any] = {}
        self.reports: dict[str, Report] = {}
        self.analysis_templates: dict[str, AnalysisTemplate] = {}
        self.seed()

    def seed(self) -> None:
        workspace = Workspace(id="ws_demo", name="Industrial Analytics Demo", tenant_id="tenant_demo", created_at=now())
        project = Project(
            id="prj_demo",
            workspace_id=workspace.id,
            name="Mixer Line Stability Study",
            description="Sample project for industrial time-series analysis.",
            created_at=now(),
        )
        rows = build_sample_rows()
        dataset = Dataset(
            id="ds_mixer_timeseries",
            project_id=project.id,
            name="Mixer sensor time-series",
            source="sample:industrial-timeseries",
            version=1,
            row_count=len(rows),
            timestamp_column="timestamp",
            equipment_tag="equipment_id",
            sampling_rate="5 minutes",
            columns=infer_profiles(rows),
            created_at=now(),
        )
        self.workspaces[workspace.id] = workspace
        self.projects[project.id] = project
        self.datasets[dataset.id] = dataset
        self.rows[dataset.id] = rows

    def add_dataset(self, project_id: str, name: str, source: str, rows: list[dict[str, Any]]) -> Dataset:
        dataset = Dataset(
            id=new_id("ds"),
            project_id=project_id,
            name=name,
            source=source,
            version=1,
            row_count=len(rows),
            timestamp_column=infer_timestamp_column(rows),
            equipment_tag=infer_equipment_tag(rows),
            sampling_rate=None,
            columns=infer_profiles(rows),
            created_at=now(),
        )
        self.datasets[dataset.id] = dataset
        self.rows[dataset.id] = rows
        return dataset


def infer_profiles(rows: list[dict[str, Any]]) -> list[ColumnProfile]:
    if not rows:
        return []

    profiles: list[ColumnProfile] = []
    row_count = len(rows)
    for column in rows[0].keys():
        values = [row.get(column) for row in rows]
        present = [value for value in values if value is not None]
        missing_rate = 1 - len(present) / row_count
        numeric = [float(value) for value in present if isinstance(value, int | float) and not isinstance(value, bool)]
        unique_values = sorted({str(value) for value in present})

        if column == "timestamp" or looks_like_datetime_column(column, present):
            column_type = "datetime"
            min_value = min(str(value) for value in present)
            max_value = max(str(value) for value in present)
            categories: list[str] = []
        elif numeric and len(numeric) == len(present):
            column_type = "numeric"
            min_value = min(numeric)
            max_value = max(numeric)
            categories = []
        else:
            column_type = "categorical"
            min_value = None
            max_value = None
            categories = unique_values[:20]

        unit = None
        if column.endswith("_bar"):
            unit = "bar"
        elif column.endswith("_c"):
            unit = "C"
        elif column.endswith("_g"):
            unit = "g"
        elif column.endswith("_kg_h"):
            unit = "kg/h"

        profiles.append(
            ColumnProfile(
                name=column,
                type=column_type,
                missing_rate=missing_rate,
                min=min_value,
                max=max_value,
                categories=categories,
                unit=unit,
                quality_flags=[],
            )
        )
    return profiles


def infer_timestamp_column(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return None
    for column in rows[0].keys():
        if column.lower() in {"timestamp", "time", "datetime", "date"}:
            return column
    for column in rows[0].keys():
        present = [row.get(column) for row in rows[:50] if row.get(column) is not None]
        if looks_like_datetime_column(column, present):
            return column
    return None


def infer_equipment_tag(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return None
    candidates = ["equipment_id", "equipment", "asset_id", "machine_id", "tool_id", "line_id"]
    lower_to_name = {column.lower(): column for column in rows[0].keys()}
    for candidate in candidates:
        if candidate in lower_to_name:
            return lower_to_name[candidate]
    return None


def looks_like_datetime_column(column: str, values: list[Any]) -> bool:
    if not values:
        return False
    if any(token in column.lower() for token in ["time", "date"]):
        sample = values[:10]
    else:
        sample = values[:20]
    parsed = 0
    for value in sample:
        if isinstance(value, datetime):
            parsed += 1
            continue
        if isinstance(value, str):
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
                parsed += 1
            except ValueError:
                pass
    return parsed >= max(1, len(sample) // 2)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


store = InMemoryStore()
