from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .analysis import control_chart_imr, correlation, describe, distribution, fit_standard_least_squares, fit_y_by_x, linear_regression, multivariate, oneway_anova, process_capability, spc_control_limits
from .importers import parse_tabular_file
from .models import (
    AnalysisRequest,
    AnalysisRun,
    ChartSpec,
    CreateProjectRequest,
    DatasetPreview,
    FitModelRequest,
    FitModelRun,
    ModelRequest,
    ModelRun,
    Project,
    Report,
    ReportBlock,
    SaveFitDiagnosticsRequest,
    SavedChart,
)
from .storage import infer_profiles, new_id, now, store


app = FastAPI(title="Industrial Statistical Analytics API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/workspaces")
def list_workspaces():
    return list(store.workspaces.values())


@app.get("/projects")
def list_projects(workspace_id: str | None = None):
    projects = list(store.projects.values())
    if workspace_id:
        projects = [project for project in projects if project.workspace_id == workspace_id]
    return projects


@app.post("/projects", response_model=Project)
def create_project(request: CreateProjectRequest) -> Project:
    if request.workspace_id not in store.workspaces:
        raise HTTPException(status_code=404, detail="Workspace not found")
    project = Project(
        id=new_id("prj"),
        workspace_id=request.workspace_id,
        name=request.name,
        description=request.description,
        created_at=now(),
    )
    store.projects[project.id] = project
    return project


@app.get("/datasets")
def list_datasets(project_id: str | None = None):
    datasets = list(store.datasets.values())
    if project_id:
        datasets = [dataset for dataset in datasets if dataset.project_id == project_id]
    return datasets


@app.post("/datasets/import", response_model=DatasetPreview)
async def import_dataset(file: UploadFile = File(...), project_id: str = Form("prj_demo")) -> DatasetPreview:
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")

    content = await file.read()
    try:
        rows = parse_tabular_file(file.filename or "uploaded.csv", content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if not rows:
        raise HTTPException(status_code=400, detail="The uploaded file did not contain any data rows.")

    dataset = store.add_dataset(
        project_id=project_id,
        name=file.filename or "Uploaded dataset",
        source=f"upload:{file.filename}",
        rows=rows,
    )
    return DatasetPreview(dataset=dataset, rows=rows[:240])


@app.get("/datasets/{dataset_id}/preview", response_model=DatasetPreview)
def preview_dataset(dataset_id: str, limit: int = 100) -> DatasetPreview:
    dataset = store.datasets.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return DatasetPreview(dataset=dataset, rows=store.rows[dataset_id][:limit])


@app.post("/charts", response_model=SavedChart)
def save_chart(spec: ChartSpec) -> SavedChart:
    if spec.dataset_id not in store.datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    saved = SavedChart(**spec.model_dump(exclude={"id"}), id=new_id("cht"), created_at=now())
    store.charts[saved.id] = saved
    return saved


@app.get("/charts")
def list_charts(dataset_id: str | None = None):
    charts = list(store.charts.values())
    if dataset_id:
        charts = [chart for chart in charts if chart.dataset_id == dataset_id]
    return charts


@app.post("/analysis/run", response_model=AnalysisRun)
def run_analysis(request: AnalysisRequest) -> AnalysisRun:
    dataset = store.datasets.get(request.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = store.rows[request.dataset_id]
    outputs: dict[str, object]
    interpretation: list[str]

    if request.method == "descriptive":
        columns = request.columns or [column.name for column in dataset.columns if column.type == "numeric"]
        outputs = {"columns": describe(rows, columns)}
        interpretation = [f"Computed descriptive statistics for {len(outputs['columns'])} numeric columns."]
    elif request.method == "distribution":
        columns = request.columns or [column.name for column in dataset.columns if column.type == "numeric"]
        if not columns:
            raise HTTPException(status_code=400, detail="Distribution requires at least one numeric Y column")
        result = distribution(
            rows,
            columns,
            by=request.parameters.get("by"),
            freq=request.parameters.get("freq"),
            weight=request.parameters.get("weight"),
        )
        outputs = {"distribution": result}
        interpretation = [f"Computed distribution summaries for {len(result['columns'])} response columns."]
    elif request.method == "fit_y_by_x":
        if len(request.columns) < 2:
            raise HTTPException(status_code=400, detail="Fit Y by X requires Y and X columns")
        try:
            result = fit_y_by_x(rows, y_column=request.columns[0], x_column=request.columns[1])
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"fit_y_by_x": result}
        interpretation = [f"Fitted {result['y']} by {result['x']} with R2={result['metrics']['r2']:.3f}."]
    elif request.method == "oneway_anova":
        if len(request.columns) < 2:
            raise HTTPException(status_code=400, detail="Oneway analysis requires Y and X columns")
        try:
            result = oneway_anova(rows, y_column=request.columns[0], x_column=request.columns[1])
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"oneway_anova": result}
        interpretation = [f"Computed Oneway analysis for {result['y']} across {int(result['levels'])} levels of {result['x']}."]
    elif request.method == "multivariate":
        columns = request.columns or [column.name for column in dataset.columns if column.type == "numeric"]
        if len(columns) < 2:
            raise HTTPException(status_code=400, detail="Multivariate analysis requires at least two numeric columns")
        try:
            result = multivariate(rows, columns)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"multivariate": result}
        interpretation = [f"Computed Pearson correlations for {len(result['columns'])} numeric columns."]
    elif request.method == "correlation":
        if len(request.columns) < 2:
            raise HTTPException(status_code=400, detail="Correlation requires two columns")
        result = correlation(rows, request.columns[0], request.columns[1])
        outputs = {"correlation": result}
        interpretation = [f"Pearson r is {result['r']:.3f} across {int(result['n'])} paired observations."]
    elif request.method == "spc":
        column = request.columns[0] if request.columns else "quality_score"
        result = spc_control_limits(rows, column)
        outputs = {"spc": result}
        interpretation = [f"Found {len(result['violations'])} points outside 3-sigma control limits for {column}."]
    elif request.method == "control_chart":
        if not request.columns:
            raise HTTPException(status_code=400, detail="Control Chart Builder requires a Y column")
        result = control_chart_imr(
            rows,
            y_column=request.columns[0],
            x_column=request.parameters.get("x"),
            phase_column=request.parameters.get("phase"),
        )
        outputs = {"control_chart": result}
        interpretation = [f"Built I-MR control chart for {result['y']} with {len(result['violations'])} rule violations."]
    elif request.method == "process_capability":
        column = request.columns[0] if request.columns else "quality_score"
        lsl = float(request.parameters["lsl"]) if request.parameters.get("lsl") not in {None, ""} else None
        usl = float(request.parameters["usl"]) if request.parameters.get("usl") not in {None, ""} else None
        target = float(request.parameters["target"]) if request.parameters.get("target") not in {None, ""} else None
        result = process_capability(rows, column, lsl, usl, target)
        outputs = {"process_capability": result}
        interpretation = [f"Cp={result['cp']:.2f}, Cpk={result['cpk']:.2f} for {column}."]
    else:
        raise HTTPException(status_code=400, detail="Unsupported analysis method")

    run = AnalysisRun(
        id=new_id("ana"),
        dataset_id=dataset.id,
        dataset_version=dataset.version,
        method=request.method,
        inputs=request.model_dump(),
        outputs=outputs,
        interpretation=interpretation,
        status="completed",
        created_at=now(),
    )
    store.analysis_runs[run.id] = run
    return run


@app.post("/models/run", response_model=ModelRun)
def run_model(request: ModelRequest) -> ModelRun:
    dataset = store.datasets.get(request.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if request.model_type != "linear_regression":
        raise HTTPException(status_code=400, detail="Only linear_regression is implemented in the MVP")

    result = linear_regression(store.rows[request.dataset_id], request.target, request.features)
    run = ModelRun(
        id=new_id("mdl"),
        dataset_id=dataset.id,
        dataset_version=dataset.version,
        model_type=request.model_type,
        target=request.target,
        features=request.features,
        metrics=result["metrics"],
        coefficients=result["coefficients"],
        predictions=result["predictions"],
        status="completed",
        created_at=now(),
    )
    store.model_runs[run.id] = run
    return run


@app.post("/fit-model/run", response_model=FitModelRun)
def run_fit_model(request: FitModelRequest) -> FitModelRun:
    dataset = store.datasets.get(request.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if request.model_type != "standard_least_squares":
        raise HTTPException(status_code=400, detail="Only standard_least_squares is implemented for Fit Model.")

    try:
        result = fit_standard_least_squares(
            store.rows[request.dataset_id],
            responses=request.responses,
            effects=request.effects,
            include_quadratic=request.include_quadratic,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    run = FitModelRun(
        id=new_id("fit"),
        dataset_id=dataset.id,
        dataset_version=dataset.version,
        model_type=request.model_type,
        responses=request.responses,
        effects=request.effects,
        terms=result["terms"],
        include_quadratic=request.include_quadratic,
        metrics=result["metrics"],
        coefficients=result["coefficients"],
        anova=result["anova"],
        parameter_estimates=result["parameter_estimates"],
        effect_tests=result["effect_tests"],
        effect_leverage=result["effect_leverage"],
        lack_of_fit=result["lack_of_fit"],
        residuals=result["residuals"],
        information_criteria=result["information_criteria"],
        prediction_formulas=result["prediction_formulas"],
        profiler_effects=result["profiler_effects"],
        profiler=result["profiler"],
        status="completed",
        created_at=now(),
    )
    store.model_runs[run.id] = run
    return run


@app.post("/fit-model/save-diagnostics", response_model=DatasetPreview)
def save_fit_model_diagnostics(request: SaveFitDiagnosticsRequest) -> DatasetPreview:
    run = store.model_runs.get(request.run_id)
    if not run or not isinstance(run, FitModelRun):
        raise HTTPException(status_code=404, detail="Fit Model run not found")

    dataset = store.datasets.get(run.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    rows = store.rows[dataset.id]
    for response in run.responses:
        columns = {
            f"{response} Predicted": "predicted",
            f"{response} Residual": "residual",
            f"{response} Studentized Residual": "studentized",
            f"{response} Leverage": "leverage",
            f"{response} Cook's D": "cook",
        }
        formula_column = f"{response} Prediction Formula"
        for row in rows:
            for column in columns:
                row[column] = None
            if request.include_formula:
                row[formula_column] = run.prediction_formulas.get(response)
        for diagnostic in run.residuals.get(response, []):
            row_index = int(diagnostic.get("sourceRowIndex", diagnostic["rowIndex"]))
            if 0 <= row_index < len(rows):
                for column, key in columns.items():
                    rows[row_index][column] = diagnostic[key]

    dataset.version += 1
    dataset.columns = infer_profiles(rows)
    return DatasetPreview(dataset=dataset, rows=rows[:240])


@app.post("/reports", response_model=Report)
def create_report(project_id: str, name: str) -> Report:
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    report = Report(
        id=new_id("rpt"),
        project_id=project_id,
        name=name,
        blocks=[
            ReportBlock(
                type="markdown",
                title="Summary",
                body="Interactive report shell for saved charts, analyses, and model runs.",
            )
        ],
        created_at=now(),
    )
    store.reports[report.id] = report
    return report
