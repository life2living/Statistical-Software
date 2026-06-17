from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ChartType = Literal["line", "area", "scatter", "histogram", "box", "bar", "stacked_bar", "pie", "heatmap", "control"]
ColumnType = Literal["datetime", "numeric", "categorical"]
AnalysisMethod = Literal["descriptive", "distribution", "fit_y_by_x", "oneway_anova", "multivariate", "correlation", "spc", "control_chart", "process_capability", "tabulate", "pareto", "gauge_rr", "variability_chart", "reliability_survival", "process_screening"]
ModelType = Literal["linear_regression", "standard_least_squares"]


class Workspace(BaseModel):
    id: str
    name: str
    tenant_id: str
    created_at: datetime


class Project(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: str = ""
    created_at: datetime


class ColumnProfile(BaseModel):
    name: str
    type: ColumnType
    missing_rate: float
    min: float | str | None = None
    max: float | str | None = None
    categories: list[str] = Field(default_factory=list)
    unit: str | None = None
    quality_flags: list[str] = Field(default_factory=list)


class Dataset(BaseModel):
    id: str
    project_id: str
    name: str
    source: str
    version: int
    row_count: int
    timestamp_column: str | None
    equipment_tag: str | None
    sampling_rate: str | None
    columns: list[ColumnProfile]
    created_at: datetime


class DatasetPreview(BaseModel):
    dataset: Dataset
    rows: list[dict[str, Any]]


class DoeFactor(BaseModel):
    name: str
    low: float | str
    high: float | str


class DoeGenerateRequest(BaseModel):
    project_id: str = "prj_demo"
    name: str = "Full factorial DOE"
    factors: list[DoeFactor]
    replicates: int = 1
    randomize: bool = False
    seed: int = 1


class ChartEncoding(BaseModel):
    x: str | None = None
    y: str | None = None
    color: str | None = None
    size: str | None = None
    facet: str | None = None


class ChartSpec(BaseModel):
    id: str | None = None
    dataset_id: str
    name: str
    chart_type: ChartType
    encodings: ChartEncoding
    filters: dict[str, Any] = Field(default_factory=dict)
    aggregation: str | None = None
    layout: dict[str, Any] = Field(default_factory=dict)


class SavedChart(ChartSpec):
    id: str
    created_at: datetime


class AnalysisRequest(BaseModel):
    dataset_id: str
    method: AnalysisMethod
    columns: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)


class AnalysisRun(BaseModel):
    id: str
    dataset_id: str
    dataset_version: int
    method: AnalysisMethod
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    interpretation: list[str]
    status: Literal["completed", "failed"]
    created_at: datetime


class ModelRequest(BaseModel):
    dataset_id: str
    model_type: ModelType
    target: str
    features: list[str]
    parameters: dict[str, Any] = Field(default_factory=dict)


class ModelRun(BaseModel):
    id: str
    dataset_id: str
    dataset_version: int
    model_type: ModelType
    target: str
    features: list[str]
    metrics: dict[str, float]
    coefficients: dict[str, float]
    predictions: list[dict[str, Any]]
    status: Literal["completed", "failed"]
    created_at: datetime


class FitModelRequest(BaseModel):
    dataset_id: str
    responses: list[str]
    effects: list[str]
    model_type: ModelType = "standard_least_squares"
    include_quadratic: bool = False
    parameters: dict[str, Any] = Field(default_factory=dict)


class SaveFitDiagnosticsRequest(BaseModel):
    run_id: str
    include_formula: bool = False
    execute_formula: bool = True


class ProfilerOptimizeRequest(BaseModel):
    run_id: str
    response: str
    values: dict[str, float] = Field(default_factory=dict)
    locks: dict[str, bool] = Field(default_factory=dict)
    goal: Literal["maximize", "minimize", "target"] = "maximize"
    target: float | None = None


class ProfilerOptimizeResult(BaseModel):
    values: dict[str, float]
    prediction: float
    desirability: float


class ProfilerEffect(BaseModel):
    name: str
    min: float
    max: float
    mean: float


class FitModelRun(BaseModel):
    id: str
    dataset_id: str
    dataset_version: int
    model_type: ModelType
    responses: list[str]
    effects: list[str]
    terms: list[str]
    include_quadratic: bool
    metrics: dict[str, dict[str, float]]
    coefficients: dict[str, dict[str, float]]
    anova: dict[str, list[dict[str, Any]]]
    parameter_estimates: dict[str, list[dict[str, Any]]]
    effect_tests: dict[str, list[dict[str, Any]]]
    effect_leverage: dict[str, list[dict[str, Any]]]
    lack_of_fit: dict[str, dict[str, Any]]
    residuals: dict[str, list[dict[str, float]]]
    information_criteria: dict[str, dict[str, float]]
    prediction_formulas: dict[str, str]
    profiler_effects: list[ProfilerEffect]
    profiler: dict[str, dict[str, list[dict[str, float]]]]
    status: Literal["completed", "failed"]
    created_at: datetime


class ReportBlock(BaseModel):
    type: Literal["markdown", "chart", "analysis", "model"]
    title: str
    ref_id: str | None = None
    body: str | None = None


class Report(BaseModel):
    id: str
    project_id: str
    name: str
    blocks: list[ReportBlock]
    created_at: datetime


class CreateProjectRequest(BaseModel):
    workspace_id: str
    name: str
    description: str = ""


class AnalysisTemplate(BaseModel):
    id: str
    project_id: str
    name: str
    description: str = ""
    steps: list[dict[str, Any]]
    parameters: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
