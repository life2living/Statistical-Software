import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, SeriesOption } from "echarts";
import { importDataset, listDatasets, previewDataset, runDescriptive, runFitModel, runLinearModel, runSpc, saveChart } from "./api";
import type { AnalysisRun, ChartSpec, ChartType, ColumnProfile, Dataset, DatasetPreview, FitModelRun, ModelRun } from "./types";

type DropZoneKey = "x" | "y" | "color" | "size" | "wrap" | "overlay" | "groupX" | "groupY";
type ZoneState = Record<DropZoneKey, string[]>;
type RowValue = string | number | null;

const emptyZones: ZoneState = {
  x: [],
  y: [],
  color: [],
  size: [],
  wrap: [],
  overlay: [],
  groupX: [],
  groupY: []
};

const dropZoneLabels: Record<DropZoneKey, string> = {
  x: "X",
  y: "Y",
  color: "Color",
  size: "Size",
  wrap: "Wrap",
  overlay: "Overlay",
  groupX: "Group X",
  groupY: "Group Y"
};

const chartCatalog: ChartType[] = ["line", "area", "scatter", "bar", "stacked_bar", "histogram", "box", "pie", "heatmap", "control"];

const chartLabels: Record<ChartType, string> = {
  line: "Trend",
  area: "Area",
  scatter: "Points",
  histogram: "Histogram",
  box: "Box",
  bar: "Bar",
  stacked_bar: "Stacked",
  pie: "Pie",
  heatmap: "Heatmap",
  control: "Control"
};

function first(values: string[]) {
  return values[0] ?? null;
}

function rowValue(row: Record<string, RowValue>, field?: string | null): RowValue {
  if (!field) return null;
  return row[field] ?? null;
}

function fieldValues(rows: DatasetPreview["rows"], field?: string | null): RowValue[] {
  if (!field) return [];
  return rows.map((row) => rowValue(row, field));
}

function numericValues(rows: DatasetPreview["rows"], field?: string | null): number[] {
  return fieldValues(rows, field)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function recommendedCharts(zones: ZoneState, columns: ColumnProfile[]): ChartType[] {
  const typeOf = (field: string | null) => columns.find((column) => column.name === field)?.type;
  const xType = typeOf(first(zones.x));
  const yType = typeOf(first(zones.y));

  if (zones.x.length === 0 && zones.y.length === 0) return ["scatter", "line", "histogram", "box"];
  if (xType === "datetime" && yType === "numeric") return ["line", "area", "scatter", "control"];
  if (xType === "numeric" && yType === "numeric") return ["scatter", "heatmap", "line", "area"];
  if (xType === "categorical" && yType === "numeric") return ["box", "bar", "stacked_bar", "pie"];
  if (xType === "numeric" && zones.y.length === 0) return ["histogram", "box"];
  if (yType === "numeric" && zones.x.length === 0) return ["histogram", "box"];
  return ["bar", "scatter", "heatmap"];
}

function histogram(values: number[], binCount = 12) {
  if (values.length === 0) return { labels: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max === min ? 1 : (max - min) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    counts[index] += 1;
  }
  const labels = counts.map((_, index) => `${(min + index * width).toFixed(2)}-${(min + (index + 1) * width).toFixed(2)}`);
  return { labels, counts };
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function boxStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[0] ?? 0, quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted[sorted.length - 1] ?? 0];
}

function groupSum(rows: DatasetPreview["rows"], xField: string | null, yField: string | null) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const key = String(rowValue(row, xField) ?? "Missing");
    const value = Number(rowValue(row, yField));
    groups.set(key, (groups.get(key) ?? 0) + (Number.isFinite(value) ? value : 1));
  }
  return [...groups.entries()].slice(0, 30);
}

function buildOption(chartType: ChartType, rows: DatasetPreview["rows"], zones: ZoneState): EChartsOption {
  const xFields = zones.x.length > 0 ? zones.x : zones.y.slice(0, 1);
  const yFields = zones.y.length > 0 ? zones.y : zones.x.slice(0, 1);
  const xField = first(zones.x);
  const yField = first(zones.y);
  const categories = xField ? fieldValues(rows, xField).map((value) => String(value ?? "")) : rows.map((_, index) => String(index + 1));
  const base: EChartsOption = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, type: "scroll" },
    grid: { left: 68, right: 28, top: 48, bottom: 58 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }]
  };

  if (chartType === "histogram") {
    const fields = [...new Set([...xFields, ...yFields])];
    const firstHistogram = histogram(numericValues(rows, fields[0]));
    return {
      ...base,
      xAxis: { type: "category", data: firstHistogram.labels },
      yAxis: { type: "value" },
      series: fields.map((field) => {
        const bins = histogram(numericValues(rows, field));
        return { type: "bar", name: field, data: bins.counts };
      }) as SeriesOption[]
    };
  }

  if (chartType === "box") {
    return {
      ...base,
      xAxis: { type: "category", data: yFields },
      yAxis: { type: "value" },
      series: [{ type: "boxplot", name: "Box", data: yFields.map((field) => boxStats(numericValues(rows, field))) }] as SeriesOption[]
    };
  }

  if (chartType === "pie") {
    return {
      tooltip: { trigger: "item" },
      legend: { type: "scroll", orient: "vertical", right: 0, top: 12, bottom: 12 },
      series: [
        {
          type: "pie",
          radius: ["35%", "70%"],
          center: ["42%", "54%"],
          data: groupSum(rows, xField, yField).map(([name, value]) => ({ name, value }))
        }
      ] as SeriesOption[]
    };
  }

  if (chartType === "heatmap") {
    const xValues = numericValues(rows, xField);
    const yValues = numericValues(rows, yField);
    const data = xValues.slice(0, Math.min(xValues.length, yValues.length)).map((value, index) => [value, yValues[index], 1]);
    return {
      ...base,
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: xField ?? "X" },
      yAxis: { type: "value", name: yField ?? "Y" },
      visualMap: { min: 0, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 22 },
      series: [{ type: "scatter", name: "Density points", symbolSize: 8, data }] as SeriesOption[]
    };
  }

  if (chartType === "control") {
    return {
      ...base,
      xAxis: { type: "category", data: categories },
      yAxis: { type: "value" },
      series: yFields.map((field) => {
        const values = numericValues(rows, field);
        const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
        const sigma = Math.sqrt(variance);
        return {
          type: "line",
          name: field,
          data: fieldValues(rows, field),
          markLine: {
            symbol: "none",
            data: [
              { name: "UCL", yAxis: mean + 3 * sigma, lineStyle: { color: "#dc2626" } },
              { name: "CL", yAxis: mean, lineStyle: { color: "#2563eb" } },
              { name: "LCL", yAxis: mean - 3 * sigma, lineStyle: { color: "#dc2626" } }
            ]
          }
        };
      }) as SeriesOption[]
    };
  }

  const type = chartType === "bar" || chartType === "stacked_bar" ? "bar" : chartType === "scatter" ? "scatter" : "line";
  return {
    ...base,
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value" },
    series: yFields.flatMap((field) =>
      xFields.map((xCandidate) => ({
        type,
        name: xFields.length > 1 ? `${field} by ${xCandidate}` : field,
        data: fieldValues(rows, field),
        stack: chartType === "stacked_bar" ? "total" : undefined,
        areaStyle: chartType === "area" ? {} : undefined,
        smooth: chartType === "line" || chartType === "area"
      }))
    ) as SeriesOption[]
  };
}

function predictFit(run: FitModelRun, response: string, values: Record<string, number>) {
  const coefficients = run.coefficients[response];
  if (!coefficients) return 0;
  let prediction = coefficients.Intercept ?? 0;
  for (const effect of run.effects) {
    const value = values[effect] ?? 0;
    prediction += (coefficients[effect] ?? 0) * value;
    if (run.include_quadratic) {
      prediction += (coefficients[`${effect}^2`] ?? 0) * value * value;
    }
  }
  return prediction;
}

function buildProfilerOption(run: FitModelRun, response: string, values: Record<string, number>): EChartsOption {
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0 },
    grid: { left: 60, right: 24, top: 44, bottom: 42 },
    xAxis: { type: "value", name: "Effect value" },
    yAxis: { type: "value", name: response },
    series: run.effects.map((effect) => ({
      type: "line",
      name: effect,
      smooth: true,
      data: run.profiler[response]?.[effect]?.map((point) => [point.x, point.y]) ?? [],
      markLine: {
        symbol: "none",
        data: [{ xAxis: values[effect], lineStyle: { color: "#dc2626", type: "dashed" }, label: { formatter: effect } }]
      }
    })) as SeriesOption[]
  };
}

function FieldItem({ column }: { column: ColumnProfile }) {
  return (
    <div
      className={`field-item field-${column.type}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", column.name)}
      title={`${column.type}${column.unit ? `, ${column.unit}` : ""}`}
    >
      <span className="field-glyph" />
      <span>{column.name}</span>
    </div>
  );
}

function DropZone({
  zoneKey,
  values,
  onDropField,
  onClear
}: {
  zoneKey: DropZoneKey;
  values: string[];
  onDropField: (zone: DropZoneKey, field: string) => void;
  onClear: (zone: DropZoneKey, field: string) => void;
}) {
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const field = event.dataTransfer.getData("text/plain");
    if (field) onDropField(zoneKey, field);
  }

  return (
    <div className={`drop-zone zone-${zoneKey}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <span className="zone-label">{dropZoneLabels[zoneKey]}</span>
      {values.length > 0 ? (
        <span className="zone-pill-list">
          {values.map((value) => (
            <button key={value} className="zone-pill" onClick={() => onClear(zoneKey, value)} title="Click to remove">
              {value}
            </button>
          ))}
        </span>
      ) : (
        <span className="zone-placeholder">Drop field</span>
      )}
    </div>
  );
}

export default function App() {
  const chartRef = useRef<HTMLDivElement>(null);
  const profilerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const profilerInstance = useRef<echarts.ECharts | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [chartType, setChartType] = useState<ChartType>("scatter");
  const [zones, setZones] = useState<ZoneState>(emptyZones);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading sample industrial dataset...");
  const [analysis, setAnalysis] = useState<AnalysisRun | null>(null);
  const [model, setModel] = useState<ModelRun | null>(null);
  const [fitResponses, setFitResponses] = useState<string[]>([]);
  const [fitEffects, setFitEffects] = useState<string[]>([]);
  const [includeQuadratic, setIncludeQuadratic] = useState(false);
  const [fitRun, setFitRun] = useState<FitModelRun | null>(null);
  const [activeProfileResponse, setActiveProfileResponse] = useState("");
  const [profilerValues, setProfilerValues] = useState<Record<string, number>>({});
  const [activeAnalyzePlatform, setActiveAnalyzePlatform] = useState<"graph" | "fitModel">("graph");
  const [analyzeMenuOpen, setAnalyzeMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  async function loadDataset(datasetId: string) {
    const datasetPreview = await previewDataset(datasetId);
    setPreview(datasetPreview);
    const numeric = datasetPreview.dataset.columns.find((column) => column.type === "numeric")?.name;
    setZones({ ...emptyZones, x: datasetPreview.dataset.timestamp_column ? [datasetPreview.dataset.timestamp_column] : [], y: numeric ? [numeric] : [] });
    setChartType(datasetPreview.dataset.timestamp_column && numeric ? "line" : "scatter");
    setAnalysis(null);
    setModel(null);
    setFitRun(null);
    setFitResponses([]);
    setFitEffects([]);
    setProfilerValues({});
    setActiveProfileResponse("");
  }

  useEffect(() => {
    listDatasets()
      .then(async (items) => {
        setDatasets(items);
        if (items[0]) {
          await loadDataset(items[0].id);
          setStatus("Upload CSV/XLSX or drag multiple fields into X and Y zones.");
        }
      })
      .catch((error: unknown) => setStatus(`Backend unavailable: ${String(error)}`));
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current);
    const resize = () => chartInstance.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeAnalyzePlatform !== "fitModel") return;
    if (!profilerRef.current) return;
    profilerInstance.current = echarts.init(profilerRef.current);
    const resize = () => profilerInstance.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      profilerInstance.current?.dispose();
      profilerInstance.current = null;
    };
  }, [activeAnalyzePlatform, fitRun]);

  const columns = preview?.dataset.columns ?? [];
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "numeric").map((column) => column.name), [columns]);
  const visibleColumns = useMemo(
    () => columns.filter((column) => column.name.toLowerCase().includes(search.trim().toLowerCase())),
    [columns, search]
  );
  const recommendations = useMemo(() => recommendedCharts(zones, columns), [zones, columns]);
  const activeY = zones.y.join(", ") || numericColumns[0] || "";
  const activeX = zones.x.join(", ") || preview?.dataset.timestamp_column || "";
  const profileResponse = activeProfileResponse || fitRun?.responses[0] || "";
  const profilePrediction = fitRun && profileResponse ? predictFit(fitRun, profileResponse, profilerValues) : null;

  useEffect(() => {
    if (!chartInstance.current || !preview) return;
    if (zones.x.length === 0 && zones.y.length === 0) {
      chartInstance.current.clear();
      return;
    }
    chartInstance.current.setOption(buildOption(chartType, preview.rows, zones), true);
  }, [chartType, preview, zones]);

  useEffect(() => {
    if (!profilerInstance.current || !fitRun || !profileResponse) return;
    profilerInstance.current.setOption(buildProfilerOption(fitRun, profileResponse, profilerValues), true);
  }, [fitRun, profileResponse, profilerValues]);

  function handleDropField(zone: DropZoneKey, field: string) {
    setZones((current) => {
      if (current[zone].includes(field)) return current;
      return { ...current, [zone]: [...current[zone], field] };
    });
    setStatus(`Mapped ${field} to ${dropZoneLabels[zone]}.`);
  }

  function handleClear(zone: DropZoneKey, field: string) {
    setZones((current) => ({ ...current, [zone]: current[zone].filter((item) => item !== field) }));
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setStatus(`Importing ${file.name}...`);
    const datasetPreview = await importDataset(file);
    setPreview(datasetPreview);
    setDatasets(await listDatasets());
    const numeric = datasetPreview.dataset.columns.find((column) => column.type === "numeric")?.name;
    setZones({ ...emptyZones, x: datasetPreview.dataset.timestamp_column ? [datasetPreview.dataset.timestamp_column] : [], y: numeric ? [numeric] : [] });
    setChartType(datasetPreview.dataset.timestamp_column && numeric ? "line" : "histogram");
    setAnalysis(null);
    setModel(null);
    setFitRun(null);
    setFitResponses([]);
    setFitEffects([]);
    setProfilerValues({});
    setActiveProfileResponse("");
    setStatus(`Loaded ${datasetPreview.dataset.name}: ${datasetPreview.dataset.row_count} rows, ${datasetPreview.dataset.columns.length} columns.`);
  }

  function openFileDialog() {
    setFileMenuOpen(false);
    fileInputRef.current?.click();
  }

  async function handleSaveChart() {
    if (!preview) return;
    const spec: ChartSpec = {
      dataset_id: preview.dataset.id,
      name: `${chartLabels[chartType]} ${activeY} by ${activeX}`,
      chart_type: chartType,
      encodings: { x: first(zones.x), y: first(zones.y), color: first(zones.color), size: first(zones.size), facet: first(zones.wrap) },
      filters: {},
      aggregation: null,
      layout: { schemaVersion: 1, renderer: "echarts", multiEncodings: zones, hotPreview: true }
    };
    const saved = await saveChart(spec);
    setStatus(`Saved ChartSpec ${saved.id}.`);
  }

  async function handleRunStats() {
    if (!preview) return;
    const result = await runDescriptive(preview.dataset.id, numericColumns);
    setAnalysis(result);
    setStatus(`Ran ${result.method} analysis ${result.id}.`);
  }

  async function handleRunSpc() {
    if (!preview || zones.y.length === 0) return;
    const result = await runSpc(preview.dataset.id, zones.y[0]);
    setAnalysis(result);
    setChartType("control");
    setStatus(`Ran SPC analysis ${result.id}.`);
  }

  async function handleRunModel() {
    if (!preview || zones.y.length === 0) return;
    const target = zones.y[0];
    const feature = numericColumns.find((column) => column !== target) ?? numericColumns[0];
    if (!feature) return;
    const result = await runLinearModel(preview.dataset.id, target, feature);
    setModel(result);
    setStatus(`Trained ${result.id}: ${target} from ${feature}.`);
  }

  function toggleSelection(value: string, selected: string[], setter: (values: string[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  async function handleFitModel() {
    if (!preview) return;
    const responses = fitResponses.length > 0 ? fitResponses : zones.y.slice(0, 2);
    const effects = fitEffects.length > 0 ? fitEffects : zones.x.filter((field) => numericColumns.includes(field));
    if (responses.length === 0 || effects.length === 0) {
      setStatus("Fit Model requires at least one numeric response and one numeric effect.");
      return;
    }
    const result = await runFitModel(preview.dataset.id, responses, effects, includeQuadratic);
    const defaults = Object.fromEntries(result.profiler_effects.map((effect) => [effect.name, effect.mean]));
    setFitRun(result);
    setActiveProfileResponse(result.responses[0]);
    setProfilerValues(defaults);
    setStatus(`Fit Model ${result.id}: ${responses.join(", ")} by ${effects.join(", ")}.`);
  }

  function openFitModelPlatform() {
    if (fitResponses.length === 0 && zones.y.length > 0) {
      setFitResponses(zones.y.filter((field) => numericColumns.includes(field)));
    }
    if (fitEffects.length === 0 && zones.x.length > 0) {
      setFitEffects(zones.x.filter((field) => numericColumns.includes(field)));
    }
    setActiveAnalyzePlatform("fitModel");
    setAnalyzeMenuOpen(false);
  }

  return (
    <main className="graph-builder-shell">
      <header className="app-menu">
        <div className="window-title">Industrial Analytics - Graph Builder</div>
        <input ref={fileInputRef} className="hidden-file-input" type="file" accept=".csv,.xlsx,.xlsm" onChange={(event) => handleUpload(event.target.files?.[0])} />
        <nav>
          <div className="file-menu">
            <button className={fileMenuOpen ? "menu-button active" : "menu-button"} onClick={() => setFileMenuOpen((open) => !open)}>
              File
            </button>
            {fileMenuOpen ? (
              <div className="file-dropdown">
                <button>New</button>
                <button className="primary" onClick={openFileDialog}>Open... <span>Ctrl+O</span></button>
                <button onClick={openFileDialog}>Import Multiple Files...</button>
                <button disabled>Close</button>
                <hr />
                <button disabled>Save</button>
                <button>Save As...</button>
                <button disabled>Revert</button>
                <hr />
                <button>Export...</button>
                <button>Publish</button>
                <button>Database</button>
                <button>Internet Open</button>
                <hr />
                <button>Preferences <span>Ctrl+K</span></button>
                <button>Print... <span>Ctrl+P</span></button>
                <button>Print Preview</button>
                <hr />
                <div className="recent-files">
                  <strong>Recent Files</strong>
                  {datasets.map((dataset) => (
                    <button key={dataset.id} onClick={() => { loadDataset(dataset.id); setFileMenuOpen(false); }}>
                      {dataset.name}
                    </button>
                  ))}
                </div>
                <button>Save Session Script...</button>
                <button>Exit JMP <span>Ctrl+Q</span></button>
              </div>
            ) : null}
          </div>
          <span>Tables</span>
          <span>Rows</span>
          <span>Cols</span>
          <div className="analyze-menu">
            <button className={activeAnalyzePlatform === "fitModel" ? "menu-button active" : "menu-button"} onClick={() => setAnalyzeMenuOpen((open) => !open)}>
              Analyze
            </button>
            {analyzeMenuOpen ? (
              <div className="analyze-dropdown">
                <button>Distribution</button>
                <button>Fit Y by X</button>
                <button>Tabulate</button>
                <button className="primary" onClick={openFitModelPlatform}>
                  Fit Model
                </button>
                <button>Predictive Modeling</button>
                <button>Specialized Modeling</button>
                <button>Quality and Process</button>
              </div>
            ) : null}
          </div>
          <button className={activeAnalyzePlatform === "graph" ? "menu-button active" : "menu-button"} onClick={() => setActiveAnalyzePlatform("graph")}>
            Graph
          </button>
          <span>SPC</span>
          <span>Help</span>
        </nav>
      </header>

      <section className="builder-title">
        <strong>{activeAnalyzePlatform === "fitModel" ? "Model Specification" : "Graph Builder"}</strong>
        <span>{status}</span>
      </section>

      {activeAnalyzePlatform === "fitModel" ? (
        <section className="model-spec-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="model-dialog">
            <div className="role-box">
              <h3>Pick Role Variables</h3>
              <div className="role-row">
                <button>Y</button>
                <div className="role-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                  const field = event.dataTransfer.getData("text/plain");
                  if (field && numericColumns.includes(field)) setFitResponses((current) => current.includes(field) ? current : [...current, field]);
                }}>
                  {fitResponses.map((value) => (
                    <button key={value} className="zone-pill" onClick={() => setFitResponses((current) => current.filter((item) => item !== value))}>
                      {value}
                    </button>
                  ))}
                  {fitResponses.length === 0 ? <em>required</em> : null}
                </div>
              </div>
              <div className="role-row">
                <button>Weight</button>
                <div className="role-drop optional"><em>optional numeric</em></div>
              </div>
              <div className="role-row">
                <button>Freq</button>
                <div className="role-drop optional"><em>optional numeric</em></div>
              </div>
              <div className="role-row">
                <button>By</button>
                <div className="role-drop optional"><em>optional</em></div>
              </div>
            </div>

            <div className="effects-box">
              <h3>Construct Model Effects</h3>
              <div className="effects-actions">
                <button onClick={() => setFitEffects((current) => [...new Set([...current, ...zones.x.filter((field) => numericColumns.includes(field))])])}>Add</button>
                <button>Cross</button>
                <button>Nest</button>
                <button>Macros</button>
                <label>Degree <input value={includeQuadratic ? 2 : 1} readOnly /></label>
                <label><input type="checkbox" checked={includeQuadratic} onChange={(event) => setIncludeQuadratic(event.target.checked)} /> Quadratic</label>
              </div>
              <div className="effects-list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                const field = event.dataTransfer.getData("text/plain");
                if (field && numericColumns.includes(field)) setFitEffects((current) => current.includes(field) ? current : [...current, field]);
              }}>
                {fitEffects.length > 0 ? fitEffects.map((effect) => (
                  <button key={effect} className="effect-pill" onClick={() => setFitEffects((current) => current.filter((item) => item !== effect))}>
                    {effect}
                  </button>
                )) : <em>Drop numeric X effects here or drag X fields in Graph Builder first.</em>}
              </div>
            </div>
          </section>

          <aside className="model-actions">
            <label>
              Personality:
              <select defaultValue="standard_least_squares">
                <option value="standard_least_squares">Standard Least Squares</option>
              </select>
            </label>
            <button>Help</button>
            <button onClick={handleFitModel}>Run</button>
            <button>Recall</button>
            <button>Remove</button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <section className="fit-report-window">
            <div className="profiler-header">
              <h3>Prediction Profiler</h3>
              {fitRun ? (
                <select value={profileResponse} onChange={(event) => setActiveProfileResponse(event.target.value)}>
                  {fitRun.responses.map((response) => (
                    <option key={response} value={response}>{response}</option>
                  ))}
                </select>
              ) : null}
            </div>
            {fitRun ? (
              <>
                <div className="profiler-metrics">
                  <span>R2 {fitRun.metrics[profileResponse]?.r2.toFixed(3)}</span>
                  <span>Adj R2 {fitRun.metrics[profileResponse]?.adj_r2.toFixed(3)}</span>
                  <span>RMSE {fitRun.metrics[profileResponse]?.rmse.toFixed(3)}</span>
                  <strong>Prediction {profilePrediction?.toFixed(3)}</strong>
                </div>
                <div className="profiler-controls">
                  {fitRun.profiler_effects.map((effect) => (
                    <label key={effect.name}>
                      <span>{effect.name}: {(profilerValues[effect.name] ?? effect.mean).toFixed(3)}</span>
                      <input
                        type="range"
                        min={effect.min}
                        max={effect.max}
                        step={(effect.max - effect.min) / 100 || 1}
                        value={profilerValues[effect.name] ?? effect.mean}
                        onChange={(event) => setProfilerValues((current) => ({ ...current, [effect.name]: Number(event.target.value) }))}
                      />
                    </label>
                  ))}
                </div>
                <div ref={profilerRef} className="profiler-chart" />
                <pre>{JSON.stringify({ terms: fitRun.terms, coefficients: fitRun.coefficients[profileResponse] }, null, 2)}</pre>
              </>
            ) : (
              <p>Select columns, assign Y and effects, then click Run to create an interactive Prediction Profiler.</p>
            )}
          </section>
        </section>
      ) : (
      <section className="builder-body">
        <aside className="data-pane">
          <div className="pane-actions">
            <button>Recall</button>
            <button>Dialog</button>
            <button className="ghost" onClick={handleSaveChart}>
              Done
            </button>
          </div>

          <label className="dataset-picker">
            Dataset
            <select value={preview?.dataset.id ?? ""} onChange={(event) => loadDataset(event.target.value)}>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>

          <div className="column-header">{columns.length} Columns</div>
          <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
          <div className="field-list">
            {visibleColumns.map((column) => (
              <FieldItem key={column.name} column={column} />
            ))}
          </div>

          <details className="points-panel" open>
            <summary>Analysis</summary>
            <button onClick={handleRunStats}>Descriptive stats</button>
            <button onClick={handleRunSpc}>SPC limits</button>
            <button onClick={handleRunModel}>Linear model</button>
          </details>

        </aside>

        <section className="graph-pane">
          <div className="chart-recommendations">
            {chartCatalog.map((type) => (
              <button
                key={type}
                className={`${type === chartType ? "chart-tool active" : "chart-tool"} ${recommendations.includes(type) ? "recommended" : ""}`}
                onClick={() => setChartType(type)}
                title={recommendations.includes(type) ? "Recommended for current fields" : type}
              >
                <span className={`chart-icon icon-${type}`} />
                <span>{chartLabels[type]}</span>
              </button>
            ))}
          </div>

          <div className="graph-layout">
            <DropZone zoneKey="groupX" values={zones.groupX} onDropField={handleDropField} onClear={handleClear} />
            <DropZone zoneKey="groupY" values={zones.groupY} onDropField={handleDropField} onClear={handleClear} />
            <DropZone zoneKey="y" values={zones.y} onDropField={handleDropField} onClear={handleClear} />
            <div className="plot-area" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDropField(zones.x.length > 0 ? "y" : "x", event.dataTransfer.getData("text/plain"))}>
              {zones.x.length === 0 && zones.y.length === 0 ? <div className="empty-plot">Drag variables into drop zones</div> : null}
              <div ref={chartRef} className="chart-host" />
            </div>
            <div className="right-zones">
              <DropZone zoneKey="wrap" values={zones.wrap} onDropField={handleDropField} onClear={handleClear} />
              <DropZone zoneKey="overlay" values={zones.overlay} onDropField={handleDropField} onClear={handleClear} />
              <DropZone zoneKey="color" values={zones.color} onDropField={handleDropField} onClear={handleClear} />
              <DropZone zoneKey="size" values={zones.size} onDropField={handleDropField} onClear={handleClear} />
            </div>
            <DropZone zoneKey="x" values={zones.x} onDropField={handleDropField} onClear={handleClear} />
          </div>

          <div className="output-strip">
            <section>
              <h3>Analysis Output</h3>
              {analysis ? <pre>{JSON.stringify(analysis.outputs, null, 2)}</pre> : <p>Drop fields, then run an analysis.</p>}
            </section>
            <section>
              <h3>Model Output</h3>
              {model ? <pre>{JSON.stringify({ metrics: model.metrics, coefficients: model.coefficients }, null, 2)}</pre> : <p>Linear model output appears here.</p>}
            </section>
          </div>
        </section>
      </section>
      )}
    </main>
  );
}
