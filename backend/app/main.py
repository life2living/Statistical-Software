from __future__ import annotations

import html
import json

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .analysis import control_chart_attribute, control_chart_imr, control_chart_xbar_r, correlation, describe, distribution, fit_standard_least_squares, fit_y_by_x, full_factorial_design, gauge_rr_crossed, kaplan_meier_survival, linear_regression, multivariate, oneway_anova, optimize_profiler_values, pareto_summary, process_capability, process_screening, spc_control_limits, tabulate_summary, variability_chart
from .importers import parse_tabular_file
from .models import (
    AnalysisRequest,
    AnalysisRun,
    AddReportBlockRequest,
    ChartSpec,
    AnalysisTemplate,
    CreateAnalysisTemplateRequest,
    CreateProjectRequest,
    CreateReportRequest,
    DatasetPreview,
    DoeGenerateRequest,
    FitModelRequest,
    FitModelRun,
    ModelRequest,
    ModelRun,
    Project,
    ProfilerOptimizeRequest,
    ProfilerOptimizeResult,
    Report,
    ReportBlock,
    SaveFitDiagnosticsRequest,
    SavedChart,
    Workspace,
)
from .storage import infer_profiles, new_id, now, store


DEFAULT_TENANT_ID = "tenant_demo"

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


def current_tenant_id(x_tenant_id: str | None = Header(default=None, alias="X-Tenant-ID")) -> str:
    return x_tenant_id or DEFAULT_TENANT_ID


def get_workspace_for_tenant(workspace_id: str, tenant_id: str) -> Workspace:
    workspace = store.workspaces.get(workspace_id)
    if not workspace or workspace.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def get_project_for_tenant(project_id: str, tenant_id: str) -> Project:
    project = store.projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    get_workspace_for_tenant(project.workspace_id, tenant_id)
    return project


def get_dataset_for_tenant(dataset_id: str, tenant_id: str):
    dataset = store.datasets.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    get_project_for_tenant(dataset.project_id, tenant_id)
    return dataset


def project_belongs_to_tenant(project: Project, tenant_id: str) -> bool:
    workspace = store.workspaces.get(project.workspace_id)
    return bool(workspace and workspace.tenant_id == tenant_id)


def dataset_belongs_to_tenant(dataset_id: str, tenant_id: str) -> bool:
    dataset = store.datasets.get(dataset_id)
    if not dataset:
        return False
    project = store.projects.get(dataset.project_id)
    return bool(project and project_belongs_to_tenant(project, tenant_id))


def report_belongs_to_tenant(report: Report, tenant_id: str) -> bool:
    project = store.projects.get(report.project_id)
    return bool(project and project_belongs_to_tenant(project, tenant_id))


def template_belongs_to_tenant(template_id: str, tenant_id: str) -> bool:
    template = store.analysis_templates.get(template_id)
    if not template:
        return False
    project = store.projects.get(template.project_id)
    return bool(project and project_belongs_to_tenant(project, tenant_id))


def get_report_for_tenant(report_id: str, tenant_id: str) -> Report:
    report = store.reports.get(report_id)
    if not report or not report_belongs_to_tenant(report, tenant_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return report


def get_analysis_run_for_tenant(run_id: str, tenant_id: str) -> AnalysisRun:
    run = store.analysis_runs.get(run_id)
    if not run or not dataset_belongs_to_tenant(run.dataset_id, tenant_id):
        raise HTTPException(status_code=404, detail="Analysis run not found")
    return run


def get_model_run_for_tenant(run_id: str, tenant_id: str):
    run = store.model_runs.get(run_id)
    if not run or not dataset_belongs_to_tenant(run.dataset_id, tenant_id):
        raise HTTPException(status_code=404, detail="Model run not found")
    return run


@app.get("/workspaces")
def list_workspaces(tenant_id: str = Depends(current_tenant_id)):
    return [workspace for workspace in store.workspaces.values() if workspace.tenant_id == tenant_id]


@app.get("/projects")
def list_projects(workspace_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if workspace_id:
        get_workspace_for_tenant(workspace_id, tenant_id)
    projects = [project for project in store.projects.values() if project_belongs_to_tenant(project, tenant_id)]
    if workspace_id:
        projects = [project for project in projects if project.workspace_id == workspace_id]
    return projects


@app.post("/projects", response_model=Project)
def create_project(request: CreateProjectRequest, tenant_id: str = Depends(current_tenant_id)) -> Project:
    get_workspace_for_tenant(request.workspace_id, tenant_id)
    project = Project(
        id=new_id("prj"),
        workspace_id=request.workspace_id,
        name=request.name,
        description=request.description,
        created_at=now(),
    )
    store.projects[project.id] = project
    store.save()
    return project


@app.get("/datasets")
def list_datasets(project_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if project_id:
        get_project_for_tenant(project_id, tenant_id)
    datasets = [dataset for dataset in store.datasets.values() if dataset_belongs_to_tenant(dataset.id, tenant_id)]
    if project_id:
        datasets = [dataset for dataset in datasets if dataset.project_id == project_id]
    return datasets


@app.post("/datasets/import", response_model=DatasetPreview)
async def import_dataset(
    file: UploadFile = File(...),
    project_id: str = Form("prj_demo"),
    tenant_id: str = Depends(current_tenant_id),
) -> DatasetPreview:
    get_project_for_tenant(project_id, tenant_id)

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
def preview_dataset(dataset_id: str, limit: int = 100, tenant_id: str = Depends(current_tenant_id)) -> DatasetPreview:
    dataset = get_dataset_for_tenant(dataset_id, tenant_id)
    return DatasetPreview(dataset=dataset, rows=store.rows[dataset_id][:limit])


@app.post("/doe/full-factorial", response_model=DatasetPreview)
def generate_full_factorial_doe(request: DoeGenerateRequest, tenant_id: str = Depends(current_tenant_id)) -> DatasetPreview:
    get_project_for_tenant(request.project_id, tenant_id)
    try:
        rows = full_factorial_design(
            [factor.model_dump() for factor in request.factors],
            replicates=request.replicates,
            randomize=request.randomize,
            seed=request.seed,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    dataset = store.add_dataset(
        project_id=request.project_id,
        name=request.name,
        source="doe:full_factorial",
        rows=rows,
    )
    return DatasetPreview(dataset=dataset, rows=rows[:240])


@app.post("/charts", response_model=SavedChart)
def save_chart(spec: ChartSpec, tenant_id: str = Depends(current_tenant_id)) -> SavedChart:
    get_dataset_for_tenant(spec.dataset_id, tenant_id)
    saved = SavedChart(**spec.model_dump(exclude={"id"}), id=new_id("cht"), created_at=now())
    store.charts[saved.id] = saved
    store.save()
    return saved


@app.get("/charts")
def list_charts(dataset_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if dataset_id:
        get_dataset_for_tenant(dataset_id, tenant_id)
    charts = [chart for chart in store.charts.values() if dataset_belongs_to_tenant(chart.dataset_id, tenant_id)]
    if dataset_id:
        charts = [chart for chart in charts if chart.dataset_id == dataset_id]
    return charts


@app.get("/analysis/runs")
def list_analysis_runs(dataset_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if dataset_id:
        get_dataset_for_tenant(dataset_id, tenant_id)
    runs = [run for run in store.analysis_runs.values() if dataset_belongs_to_tenant(run.dataset_id, tenant_id)]
    if dataset_id:
        runs = [run for run in runs if run.dataset_id == dataset_id]
    return runs


@app.get("/models/runs")
def list_model_runs(dataset_id: str | None = None, model_type: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if dataset_id:
        get_dataset_for_tenant(dataset_id, tenant_id)
    runs = [run for run in store.model_runs.values() if dataset_belongs_to_tenant(run.dataset_id, tenant_id)]
    if dataset_id:
        runs = [run for run in runs if run.dataset_id == dataset_id]
    if model_type:
        runs = [run for run in runs if run.model_type == model_type]
    return runs


@app.get("/reports")
def list_reports(project_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if project_id:
        get_project_for_tenant(project_id, tenant_id)
    reports = [report for report in store.reports.values() if report_belongs_to_tenant(report, tenant_id)]
    if project_id:
        reports = [report for report in reports if report.project_id == project_id]
    return reports


@app.get("/analysis/templates")
def list_analysis_templates(project_id: str | None = None, tenant_id: str = Depends(current_tenant_id)):
    if project_id:
        get_project_for_tenant(project_id, tenant_id)
    templates = [template for template in store.analysis_templates.values() if template_belongs_to_tenant(template.id, tenant_id)]
    if project_id:
        templates = [template for template in templates if template.project_id == project_id]
    return templates


@app.post("/analysis/templates")
def create_analysis_template(request: CreateAnalysisTemplateRequest, tenant_id: str = Depends(current_tenant_id)) -> AnalysisTemplate:
    get_project_for_tenant(request.project_id, tenant_id)
    dataset = get_dataset_for_tenant(request.dataset_id, tenant_id)
    if dataset.project_id != request.project_id:
        raise HTTPException(status_code=400, detail="Template dataset must belong to the selected project")
    template = AnalysisTemplate(
        id=new_id("tpl"),
        project_id=request.project_id,
        dataset_id=request.dataset_id,
        name=request.name,
        description=request.description,
        method=request.method,
        columns=request.columns,
        parameters=request.parameters,
        steps=[
            {
                "type": "analysis",
                "method": request.method,
                "columns": request.columns,
                "parameters": request.parameters,
            }
        ],
        created_at=now(),
    )
    store.analysis_templates[template.id] = template
    store.save()
    return template


@app.post("/analysis/templates/{template_id}/run", response_model=AnalysisRun)
def run_analysis_template(template_id: str, tenant_id: str = Depends(current_tenant_id)) -> AnalysisRun:
    template = store.analysis_templates.get(template_id)
    if not template or not template_belongs_to_tenant(template_id, tenant_id):
        raise HTTPException(status_code=404, detail="Analysis template not found")
    return run_analysis(
        AnalysisRequest(
            dataset_id=template.dataset_id,
            method=template.method,
            columns=template.columns,
            parameters=template.parameters,
        ),
        tenant_id=tenant_id,
    )


@app.post("/analysis/run", response_model=AnalysisRun)
def run_analysis(request: AnalysisRequest, tenant_id: str = Depends(current_tenant_id)) -> AnalysisRun:
    dataset = get_dataset_for_tenant(request.dataset_id, tenant_id)

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
    elif request.method == "tabulate":
        columns = request.columns or [column.name for column in dataset.columns if column.type == "numeric"]
        if not columns:
            raise HTTPException(status_code=400, detail="Tabulate requires at least one numeric Y column")
        group_columns = [str(column) for column in request.parameters.get("group_by", []) if column]
        result = tabulate_summary(rows, columns, group_columns)
        outputs = {"tabulate": result}
        interpretation = [f"Tabulated {len(columns)} numeric columns across {len(result['rows'])} groups."]
    elif request.method == "pareto":
        if not request.columns:
            raise HTTPException(status_code=400, detail="Pareto requires a category column")
        try:
            result = pareto_summary(
                rows,
                category_column=request.columns[0],
                count_column=request.parameters.get("count"),
                by_column=request.parameters.get("by"),
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"pareto": result}
        interpretation = [f"Built Pareto chart for {result['category']} across {len(result['groups'])} group(s)."]
    elif request.method == "gauge_rr":
        if not request.columns:
            raise HTTPException(status_code=400, detail="Gauge R&R requires a measurement column")
        part_column = request.parameters.get("part")
        operator_column = request.parameters.get("operator")
        if not part_column or not operator_column:
            raise HTTPException(status_code=400, detail="Gauge R&R requires Part and Operator roles")
        try:
            result = gauge_rr_crossed(rows, request.columns[0], str(part_column), str(operator_column))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"gauge_rr": result}
        interpretation = [f"Gauge R&R is {result['metrics']['gauge_rr_percent_study_variation']:.1f}% of study variation."]
    elif request.method == "variability_chart":
        if not request.columns:
            raise HTTPException(status_code=400, detail="Variability Chart requires a Y column")
        x_column = request.parameters.get("x")
        if not x_column:
            raise HTTPException(status_code=400, detail="Variability Chart requires an X grouping column")
        try:
            result = variability_chart(rows, request.columns[0], str(x_column), request.parameters.get("by"))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"variability_chart": result}
        interpretation = [f"Computed variability for {result['y']} across {len(result['groups'])} groups."]
    elif request.method == "reliability_survival":
        if not request.columns:
            raise HTTPException(status_code=400, detail="Reliability requires a numeric time column")
        event_column = request.parameters.get("event")
        if not event_column:
            raise HTTPException(status_code=400, detail="Reliability requires an event/censor column")
        try:
            result = kaplan_meier_survival(rows, request.columns[0], str(event_column), request.parameters.get("by"))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        outputs = {"reliability_survival": result}
        interpretation = [f"Computed Kaplan-Meier survival curves for {len(result['groups'])} group(s)."]
    elif request.method == "process_screening":
        columns = request.columns or [column.name for column in dataset.columns if column.type == "numeric"]
        if not columns:
            raise HTTPException(status_code=400, detail="Process Screening requires at least one numeric column")
        result = process_screening(rows, columns)
        outputs = {"process_screening": result}
        interpretation = [f"Screened {int(result['screened_count'])} process columns for missingness and 3-sigma stability signals."]
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
        chart_type = request.parameters.get("chart_type", "imr")
        if chart_type == "xbar_r":
            subgroup_column = request.parameters.get("x")
            if not subgroup_column:
                raise HTTPException(status_code=400, detail="Xbar-R requires a subgroup column")
            try:
                result = control_chart_xbar_r(rows, y_column=request.columns[0], subgroup_column=str(subgroup_column), phase_column=request.parameters.get("phase"))
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
        elif chart_type in {"p", "np", "c", "u"}:
            try:
                result = control_chart_attribute(
                    rows,
                    y_column=request.columns[0],
                    chart_type=str(chart_type),
                    x_column=request.parameters.get("x"),
                    sample_size_column=request.parameters.get("sample_size"),
                    phase_column=request.parameters.get("phase"),
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
        else:
            result = control_chart_imr(
                rows,
                y_column=request.columns[0],
                x_column=request.parameters.get("x"),
                phase_column=request.parameters.get("phase"),
            )
        outputs = {"control_chart": result}
        interpretation = [f"Built {result['chart_type']} control chart for {result['y']} with {len(result['violations'])} rule violations."]
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
    store.save()
    return run


@app.post("/models/run", response_model=ModelRun)
def run_model(request: ModelRequest, tenant_id: str = Depends(current_tenant_id)) -> ModelRun:
    dataset = get_dataset_for_tenant(request.dataset_id, tenant_id)
    if request.model_type != "linear_regression":
        raise HTTPException(status_code=400, detail="Only linear_regression is implemented in the MVP")

    result = linear_regression(
        store.rows[request.dataset_id],
        request.target,
        request.features,
        validation_fraction=float(request.parameters.get("validation_fraction", 0.0) or 0.0),
    )
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
    store.save()
    return run


@app.post("/fit-model/run", response_model=FitModelRun)
def run_fit_model(request: FitModelRequest, tenant_id: str = Depends(current_tenant_id)) -> FitModelRun:
    dataset = get_dataset_for_tenant(request.dataset_id, tenant_id)
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
    store.save()
    return run


@app.post("/fit-model/save-diagnostics", response_model=DatasetPreview)
def save_fit_model_diagnostics(request: SaveFitDiagnosticsRequest, tenant_id: str = Depends(current_tenant_id)) -> DatasetPreview:
    run = store.model_runs.get(request.run_id)
    if not run or not isinstance(run, FitModelRun):
        raise HTTPException(status_code=404, detail="Fit Model run not found")

    dataset = get_dataset_for_tenant(run.dataset_id, tenant_id)
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
        formula_value_column = f"{response} Formula Predicted"
        for row in rows:
            for column in columns:
                row[column] = None
            if request.include_formula:
                row[formula_column] = run.prediction_formulas.get(response)
            if request.execute_formula:
                row[formula_value_column] = None
                if all(isinstance(row.get(effect), int | float) and not isinstance(row.get(effect), bool) for effect in run.effects):
                    prediction = run.coefficients[response].get("Intercept", 0.0)
                    for effect in run.effects:
                        value = float(row[effect])
                        prediction += run.coefficients[response].get(effect, 0.0) * value
                        if run.include_quadratic:
                            prediction += run.coefficients[response].get(f"{effect}^2", 0.0) * value * value
                    row[formula_value_column] = prediction
        for diagnostic in run.residuals.get(response, []):
            row_index = int(diagnostic.get("sourceRowIndex", diagnostic["rowIndex"]))
            if 0 <= row_index < len(rows):
                for column, key in columns.items():
                    rows[row_index][column] = diagnostic[key]

    dataset.version += 1
    dataset.columns = infer_profiles(rows)
    store.save()
    return DatasetPreview(dataset=dataset, rows=rows[:240])


@app.post("/fit-model/profiler/optimize", response_model=ProfilerOptimizeResult)
def optimize_fit_model_profiler(request: ProfilerOptimizeRequest, tenant_id: str = Depends(current_tenant_id)) -> ProfilerOptimizeResult:
    run = store.model_runs.get(request.run_id)
    if not run or not isinstance(run, FitModelRun):
        raise HTTPException(status_code=404, detail="Fit Model run not found")
    get_dataset_for_tenant(run.dataset_id, tenant_id)
    if request.response not in run.responses:
        raise HTTPException(status_code=400, detail="Response is not part of the Fit Model run")

    result = optimize_profiler_values(
        coefficients=run.coefficients[request.response],
        effects=run.effects,
        effect_ranges=[effect.model_dump() for effect in run.profiler_effects],
        include_quadratic=run.include_quadratic,
        goal=request.goal,
        target=request.target,
        current_values=request.values,
        locks=request.locks,
    )
    return ProfilerOptimizeResult.model_validate(result)


@app.post("/reports", response_model=Report)
def create_report(request: CreateReportRequest, tenant_id: str = Depends(current_tenant_id)) -> Report:
    get_project_for_tenant(request.project_id, tenant_id)
    report = Report(
        id=new_id("rpt"),
        project_id=request.project_id,
        name=request.name,
        blocks=[
            ReportBlock(
                type="markdown",
                title="Summary",
                body="Report draft for saved StatFlow analyses, charts, and model runs.",
            )
        ],
        created_at=now(),
    )
    store.reports[report.id] = report
    store.save()
    return report


@app.post("/reports/{report_id}/blocks", response_model=Report)
def add_report_block(report_id: str, request: AddReportBlockRequest, tenant_id: str = Depends(current_tenant_id)) -> Report:
    report = get_report_for_tenant(report_id, tenant_id)
    if request.type == "analysis":
        if not request.ref_id:
            raise HTTPException(status_code=400, detail="Analysis report blocks require ref_id")
        get_analysis_run_for_tenant(request.ref_id, tenant_id)
    elif request.type == "model":
        if not request.ref_id:
            raise HTTPException(status_code=400, detail="Model report blocks require ref_id")
        get_model_run_for_tenant(request.ref_id, tenant_id)
    elif request.type == "chart":
        if not request.ref_id or request.ref_id not in store.charts:
            raise HTTPException(status_code=404, detail="Chart not found")
        chart = store.charts[request.ref_id]
        get_dataset_for_tenant(chart.dataset_id, tenant_id)

    report.blocks.append(ReportBlock(type=request.type, title=request.title, ref_id=request.ref_id, body=request.body))
    store.save()
    return report


@app.get("/reports/{report_id}/export/html", response_class=HTMLResponse)
def export_report_html(report_id: str, tenant_id: str = Depends(current_tenant_id)) -> HTMLResponse:
    report = get_report_for_tenant(report_id, tenant_id)
    project = get_project_for_tenant(report.project_id, tenant_id)
    body = "\n".join(render_report_block_html(block, tenant_id) for block in report.blocks)
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(report.name)}</title>
  <style>
    body {{ color: #1f2937; font-family: Arial, Helvetica, sans-serif; margin: 32px; }}
    h1 {{ font-size: 26px; margin-bottom: 4px; }}
    h2 {{ border-bottom: 1px solid #d1d5db; font-size: 18px; padding-bottom: 6px; }}
    .meta {{ color: #6b7280; margin-bottom: 28px; }}
    section {{ margin-bottom: 28px; }}
    pre {{ background: #f3f4f6; border: 1px solid #d1d5db; overflow: auto; padding: 12px; }}
    ul {{ padding-left: 20px; }}
  </style>
</head>
<body>
  <h1>{html.escape(report.name)}</h1>
  <div class="meta">Project: {html.escape(project.name)} | Created: {html.escape(report.created_at.isoformat())}</div>
  {body}
</body>
</html>"""
    return HTMLResponse(content=document)


def render_report_block_html(block: ReportBlock, tenant_id: str) -> str:
    title = html.escape(block.title)
    if block.type == "markdown":
        text = html.escape(block.body or "").replace("\n", "<br>")
        return f"<section><h2>{title}</h2><p>{text}</p></section>"
    if block.type == "analysis" and block.ref_id:
        run = get_analysis_run_for_tenant(block.ref_id, tenant_id)
        payload = html.escape(json.dumps(run.outputs, indent=2, default=str))
        inputs = html.escape(json.dumps(run.inputs, indent=2, default=str))
        interpretation = "".join(f"<li>{html.escape(item)}</li>" for item in run.interpretation)
        return f"<section><h2>{title}</h2><p>Method: {html.escape(run.method)}</p><ul>{interpretation}</ul><h3>Inputs</h3><pre>{inputs}</pre><h3>Outputs</h3><pre>{payload}</pre></section>"
    if block.type == "model" and block.ref_id:
        run = get_model_run_for_tenant(block.ref_id, tenant_id)
        payload = html.escape(json.dumps(run.model_dump(mode="json"), indent=2, default=str))
        return f"<section><h2>{title}</h2><pre>{payload}</pre></section>"
    if block.type == "chart" and block.ref_id:
        chart = store.charts.get(block.ref_id)
        payload = html.escape(json.dumps(chart.model_dump(mode="json") if chart else {}, indent=2, default=str))
        return f"<section><h2>{title}</h2><pre>{payload}</pre></section>"
    return f"<section><h2>{title}</h2></section>"
