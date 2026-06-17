import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, SeriesOption } from "echarts";
import { generateFullFactorialDoe, importDataset, listDatasets, listLinearModelRuns, optimizeFitModelProfiler, previewDataset, runControlChart, runDescriptive, runDistribution, runFitModel, runFitYByX, runGaugeRR, runLinearModel, runMultivariate, runOneway, runPareto, runProcessCapability, runReliabilitySurvival, runSpc, runTabulate, runVariabilityChart, saveChart, saveFitModelDiagnostics } from "./api";
import type { AnalysisRun, ChartSpec, ChartType, ColumnProfile, ControlChartRun, Dataset, DatasetPreview, DistributionRun, DoeFactor, FitModelRun, FitYByXRun, GaugeRRRun, ModelRun, MultivariateRun, OnewayRun, ParetoRun, ProcessCapabilityRun, ReliabilityRun, TabulateRun, VariabilityRun } from "./types";

type DropZoneKey = "x" | "y" | "color" | "size" | "wrap" | "overlay" | "groupX" | "groupY";
type ZoneState = Record<DropZoneKey, string[]>;
type RowValue = string | number | null;
type ChartClickParams = { dataIndex?: number; data?: unknown };

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

type ControlChartType = "imr" | "xbar_r" | "p" | "np" | "c" | "u";

function controlChartLabel(chartType: ControlChartType) {
  if (chartType === "imr") return "I-MR";
  if (chartType === "xbar_r") return "Xbar-R";
  return chartType.toUpperCase();
}

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
  if (values.length === 0) return { labels: [], counts: [], min: 0, max: 0, width: 1, centers: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max === min ? 1 : (max - min) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    counts[index] += 1;
  }
  const labels = counts.map((_, index) => `${(min + index * width).toFixed(2)}-${(min + (index + 1) * width).toFixed(2)}`);
  const centers = counts.map((_, index) => min + (index + 0.5) * width);
  return { labels, counts, min, max, width, centers };
}

function sampleMean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function sampleStd(values: number[]) {
  if (values.length < 2) return 0;
  const center = sampleMean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function normalCurve(values: number[], bins: ReturnType<typeof histogram>) {
  const sigma = sampleStd(values);
  if (values.length < 2 || sigma === 0) return [];
  const center = sampleMean(values);
  // Normal PDF per NIST/SEMATECH e-Handbook; scaled by n * bin width for histogram-count overlays.
  return bins.centers.map((x) => {
    const density = Math.exp(-0.5 * ((x - center) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
    return density * values.length * bins.width;
  });
}

function pointDatum(value: RowValue, rowIndex: number, selectedRows: Set<number>) {
  const selected = selectedRows.has(rowIndex);
  return {
    value,
    rowIndex,
    itemStyle: selected ? { color: "#f97316", borderColor: "#7c2d12", borderWidth: 2 } : undefined,
    symbolSize: selected ? 11 : undefined
  };
}

function xyDatum(x: RowValue, y: RowValue, rowIndex: number, selectedRows: Set<number>) {
  const selected = selectedRows.has(rowIndex);
  return {
    value: [x, y],
    rowIndex,
    itemStyle: selected ? { color: "#f97316", borderColor: "#7c2d12", borderWidth: 2 } : undefined,
    symbolSize: selected ? 11 : 7
  };
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

function buildOption(chartType: ChartType, rows: DatasetPreview["rows"], zones: ZoneState, selectedRows: Set<number>, showNormalCurve: boolean): EChartsOption {
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
    const series: SeriesOption[] = fields.flatMap((field) => {
      const values = numericValues(rows, field);
      const bins = histogram(values);
      const histogramSeries: SeriesOption[] = [{ type: "bar", name: field, data: bins.counts }];
      if (showNormalCurve) {
        histogramSeries.push({
          type: "line",
          name: `${field} normal curve`,
          data: normalCurve(values, bins),
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#f97316", width: 2 }
        });
      }
      return histogramSeries;
    });
    return {
      ...base,
      xAxis: { type: "category", data: firstHistogram.labels },
      yAxis: { type: "value" },
      series
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
    const data = rows
      .map((row, index) => xyDatum(rowValue(row, xField), rowValue(row, yField), index, selectedRows))
      .filter((item) => Number.isFinite(Number(item.value[0])) && Number.isFinite(Number(item.value[1])));
    return {
      ...base,
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: xField ?? "X" },
      yAxis: { type: "value", name: yField ?? "Y" },
      visualMap: { min: 0, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 22 },
      series: [{ type: "scatter", name: "Density points", data }] as SeriesOption[]
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
          data: fieldValues(rows, field).map((value, index) => pointDatum(value, index, selectedRows)),
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
        data: fieldValues(rows, field).map((value, index) => pointDatum(value, index, selectedRows)),
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

type ProfilerGoal = "maximize" | "minimize" | "target";

function profilerDefaults(run: FitModelRun) {
  return Object.fromEntries(run.profiler_effects.map((effect) => [effect.name, effect.mean]));
}

function profilerValue(run: FitModelRun, values: Record<string, number>, effectName: string) {
  const effect = run.profiler_effects.find((candidate) => candidate.name === effectName);
  return values[effectName] ?? effect?.mean ?? 0;
}

function profilerResponseRange(run: FitModelRun, response: string) {
  const values = run.effects.flatMap((effect) => (run.profiler[response]?.[effect] ?? []).map((point) => point.y));
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

function desirabilityScore(run: FitModelRun, response: string, prediction: number, goal: ProfilerGoal, target: number | null) {
  const range = profilerResponseRange(run, response);
  const width = Math.max(1e-9, range.max - range.min);
  if (goal === "maximize") return Math.min(1, Math.max(0, (prediction - range.min) / width));
  if (goal === "minimize") return Math.min(1, Math.max(0, (range.max - prediction) / width));
  const objective = target ?? (range.min + range.max) / 2;
  const tolerance = Math.max(1e-9, Math.max(Math.abs(range.max - objective), Math.abs(range.min - objective)));
  return Math.min(1, Math.max(0, 1 - Math.abs(prediction - objective) / tolerance));
}

function dynamicProfilerPoints(run: FitModelRun, response: string, effect: string, values: Record<string, number>) {
  const points = run.profiler[response]?.[effect] ?? [];
  return points.map((point) => {
    const prediction = predictFit(run, response, { ...values, [effect]: point.x });
    const lowerMargin = point.y - (point.lower95 ?? point.y);
    const upperMargin = (point.upper95 ?? point.y) - point.y;
    return { x: point.x, y: prediction, lower95: prediction - lowerMargin, upper95: prediction + upperMargin };
  });
}

function buildProfilerOption(run: FitModelRun, response: string, values: Record<string, number>): EChartsOption {
  const series = run.effects.flatMap((effect) => {
    const resolvedValues = { ...profilerDefaults(run), ...values };
    const points = dynamicProfilerPoints(run, response, effect, resolvedValues);
    return [
      {
        type: "line" as const,
        name: effect,
        smooth: true,
        data: points.map((point) => [point.x, point.y]),
        markLine: {
          symbol: "none",
          data: [{ xAxis: profilerValue(run, resolvedValues, effect), lineStyle: { color: "#dc2626", type: "dashed" }, label: { formatter: effect } }]
        }
      },
      {
        type: "line" as const,
        name: `${effect} Lower 95%`,
        symbol: "none",
        smooth: true,
        data: points.map((point) => [point.x, point.lower95 ?? point.y]),
        lineStyle: { type: "dashed", opacity: 0.5 }
      },
      {
        type: "line" as const,
        name: `${effect} Upper 95%`,
        symbol: "none",
        smooth: true,
        data: points.map((point) => [point.x, point.upper95 ?? point.y]),
        lineStyle: { type: "dashed", opacity: 0.5 }
      }
    ];
  });
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0 },
    grid: { left: 60, right: 24, top: 44, bottom: 42 },
    xAxis: { type: "value", name: "Effect value" },
    yAxis: { type: "value", name: response },
    series: series as SeriesOption[]
  };
}

function buildFitDiagnosticOption(run: FitModelRun, response: string, mode: "residual" | "actual"): EChartsOption {
  const rows = run.residuals[response] ?? [];
  return {
    animation: false,
    tooltip: { trigger: "item" },
    grid: { left: 64, right: 24, top: 28, bottom: 48 },
    xAxis: { type: "value", name: "Predicted" },
    yAxis: { type: "value", name: mode === "residual" ? "Residual" : "Actual" },
    series: [
      {
        type: "scatter",
        name: mode === "residual" ? "Residual" : "Actual",
        symbolSize: 7,
        data: rows.map((row) => [row.predicted, mode === "residual" ? row.residual : row.actual])
      },
      ...(mode === "residual" ? [{
        type: "line" as const,
        name: "Zero",
        symbol: "none",
        data: rows.length ? [[Math.min(...rows.map((row) => row.predicted)), 0], [Math.max(...rows.map((row) => row.predicted)), 0]] : [],
        lineStyle: { color: "#2563eb", width: 1 }
      }] : [{
        type: "line" as const,
        name: "Ideal",
        symbol: "none",
        data: rows.length ? [
          [Math.min(...rows.map((row) => Math.min(row.predicted, row.actual))), Math.min(...rows.map((row) => Math.min(row.predicted, row.actual)))],
          [Math.max(...rows.map((row) => Math.max(row.predicted, row.actual))), Math.max(...rows.map((row) => Math.max(row.predicted, row.actual)))]
        ] : [],
        lineStyle: { color: "#dc2626", width: 1 }
      }])
    ] as SeriesOption[]
  };
}

function buildEffectLeverageOption(run: FitModelRun, response: string): EChartsOption {
  const rows = run.effect_leverage[response] ?? [];
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    grid: { left: 120, right: 36, top: 24, bottom: 34 },
    xAxis: { type: "value", name: "Leverage score" },
    yAxis: { type: "category", data: rows.map((row) => row.effect) },
    series: [
      {
        type: "bar",
        name: "Effect Leverage",
        itemStyle: { color: "#0f766e" },
        data: rows.map((row) => row.leverage_score)
      }
    ] as SeriesOption[]
  };
}

function buildFitYByXOption(run: FitYByXRun, showFit: boolean, showBand: boolean): EChartsOption {
  const result = run.outputs.fit_y_by_x;
  const series: SeriesOption[] = [
    {
      type: "scatter",
      name: "Observed",
      data: result.points.map((point) => [point.x, point.y]),
      symbolSize: 7
    }
  ];

  if (showBand) {
    series.push(
      {
        type: "line",
        name: "Upper 95%",
        data: result.fit_line.map((point) => [point.x, point.upper]),
        symbol: "none",
        lineStyle: { color: "#f97316", type: "dashed", width: 1 }
      },
      {
        type: "line",
        name: "Lower 95%",
        data: result.fit_line.map((point) => [point.x, point.lower]),
        symbol: "none",
        lineStyle: { color: "#f97316", type: "dashed", width: 1 }
      }
    );
  }

  if (showFit) {
    series.push({
      type: "line",
      name: "Linear Fit",
      data: result.fit_line.map((point) => [point.x, point.y]),
      symbol: "none",
      lineStyle: { color: "#dc2626", width: 2 }
    });
  }

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, type: "scroll" },
    grid: { left: 64, right: 24, top: 48, bottom: 54 },
    xAxis: { type: "value", name: result.x },
    yAxis: { type: "value", name: result.y },
    series
  };
}

function buildOnewayOption(run: OnewayRun, showMeans: boolean, showBox: boolean): EChartsOption {
  const result = run.outputs.oneway_anova;
  const levels = result.groups.map((group) => group.level);
  const series: SeriesOption[] = [
    {
      type: "scatter",
      name: "Observed",
      data: result.points.map((point) => [point.x, point.y]),
      symbolSize: 6
    }
  ];

  if (showMeans) {
    series.push({
      type: "line",
      name: "Means",
      data: result.groups.map((group) => [group.level, group.mean]),
      symbolSize: 8,
      lineStyle: { color: "#dc2626", width: 2 }
    });
  }

  if (showBox) {
    series.push({
      type: "custom",
      name: "Mean 95% CI",
      renderItem: (params, api) => {
        const category = api.value(0) as string;
        const low = api.coord([category, api.value(1) as number]);
        const high = api.coord([category, api.value(2) as number]);
        const mid = api.coord([category, api.value(3) as number]);
        return {
          type: "group",
          children: [
            { type: "line", shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style: { stroke: "#475569", lineWidth: 1.5 } },
            { type: "line", shape: { x1: mid[0] - 12, y1: mid[1], x2: mid[0] + 12, y2: mid[1] }, style: { stroke: "#475569", lineWidth: 1.5 } }
          ]
        };
      },
      data: result.groups.map((group) => [group.level, group.lower95, group.upper95, group.mean])
    } as SeriesOption);
  }

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, type: "scroll" },
    grid: { left: 64, right: 24, top: 48, bottom: 68 },
    xAxis: { type: "category", name: result.x, data: levels, axisLabel: { interval: 0, rotate: levels.some((level) => level.length > 12) ? 25 : 0 } },
    yAxis: { type: "value", name: result.y },
    series
  };
}

function buildMultivariateOption(run: MultivariateRun, showPValues: boolean, showCovariance: boolean): EChartsOption {
  const result = run.outputs.multivariate;
  const values = result.matrix.flatMap((row, rowIndex) =>
    row.map((cell, columnIndex) => {
      const value = showCovariance ? result.covariance[rowIndex][columnIndex] : showPValues ? cell.p_value : cell.r;
      return [columnIndex, rowIndex, value ?? 0, value];
    })
  );
  return {
    animation: false,
    tooltip: {
      formatter: (params) => {
        const data = (params as unknown as { data: [number, number, number, number | null] }).data;
        const x = result.columns[data[0]];
        const y = result.columns[data[1]];
        const label = showCovariance ? "Covariance" : showPValues ? "p value" : "r";
        return `${y} × ${x}<br/>${label}: ${data[3] === null ? "NA" : data[3].toFixed(6)}`;
      }
    },
    grid: { left: 130, right: 40, top: 28, bottom: 110 },
    xAxis: { type: "category", data: result.columns, axisLabel: { interval: 0, rotate: 45 } },
    yAxis: { type: "category", data: result.columns },
    visualMap: {
      min: showPValues ? 0 : showCovariance ? undefined : -1,
      max: showPValues ? 1 : showCovariance ? undefined : 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 8,
      inRange: { color: showPValues ? ["#0f766e", "#f8fafc", "#b91c1c"] : ["#2563eb", "#f8fafc", "#dc2626"] }
    },
    series: [
      {
        type: "heatmap",
        name: showCovariance ? "Covariance" : showPValues ? "p values" : "Correlation",
        data: values,
        label: {
          show: true,
          formatter: (params) => {
            const value = (params as unknown as { data: [number, number, number, number | null] }).data[3];
            return value === null ? "" : value.toFixed(showPValues ? 3 : 2);
          }
        }
      }
    ]
  };
}

function buildControlChartOption(run: ControlChartRun): EChartsOption {
  const result = run.outputs.control_chart;
  if (result.attribute) {
    return {
      animation: false,
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 70, right: 28, top: 46, bottom: 58 },
      xAxis: { type: "category", data: result.attribute.points.map((point) => point.label) },
      yAxis: { type: "value", name: result.chart_type.toUpperCase() },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 18 }],
      series: [
        {
          type: "line",
          name: result.chart_type.toUpperCase(),
          data: result.attribute.points.map((point) => ({
            value: point.value,
            rowIndex: point.rowIndex,
            itemStyle: point.beyondLimits ? { color: "#dc2626", borderColor: "#7f1d1d", borderWidth: 2 } : undefined,
            symbolSize: point.beyondLimits ? 10 : 6
          }))
        },
        {
          type: "line",
          name: "CL",
          symbol: "none",
          lineStyle: { color: "#2563eb", type: "dashed" },
          data: result.attribute.points.map((point) => point.center)
        },
        {
          type: "line",
          name: "UCL",
          symbol: "none",
          lineStyle: { color: "#dc2626", type: "dashed" },
          data: result.attribute.points.map((point) => point.ucl)
        },
        {
          type: "line",
          name: "LCL",
          symbol: "none",
          lineStyle: { color: "#dc2626", type: "dashed" },
          data: result.attribute.points.map((point) => point.lcl)
        }
      ] as SeriesOption[]
    };
  }
  const primary = result.chart_type === "xbar_r" ? result.xbar : result.individuals;
  const secondary = result.chart_type === "xbar_r" ? result.range : result.moving_range;
  if (!primary || !secondary) return {};
  const primaryName = result.chart_type === "xbar_r" ? "Xbar" : "Individuals";
  const secondaryName = result.chart_type === "xbar_r" ? "Range" : "Moving Range";
  const secondaryAxisName = result.chart_type === "xbar_r" ? "R" : "MR";
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: [
      { left: 70, right: 28, top: 46, height: "38%" },
      { left: 70, right: 28, bottom: 50, height: "28%" }
    ],
    xAxis: [
      { type: "category", data: primary.points.map((point) => point.label), gridIndex: 0 },
      { type: "category", data: secondary.points.map((point) => point.label), gridIndex: 1 }
    ],
    yAxis: [
      { type: "value", name: result.y, gridIndex: 0 },
      { type: "value", name: secondaryAxisName, gridIndex: 1 }
    ],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }, { type: "slider", xAxisIndex: [0, 1], height: 18, bottom: 16 }],
    series: [
      {
        type: "line",
        name: primaryName,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: primary.points.map((point) => ({
          value: point.value,
          rowIndex: point.rowIndex,
          itemStyle: point.beyondLimits ? { color: "#dc2626", borderColor: "#7f1d1d", borderWidth: 2 } : undefined,
          symbolSize: point.beyondLimits ? 10 : 6
        }))
      },
      {
        type: "line",
        name: `${primaryName} UCL`,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: { color: "#dc2626", type: "dashed" },
        data: primary.points.map((point) => point.ucl)
      },
      {
        type: "line",
        name: `${primaryName} CL`,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: { color: "#2563eb", type: "dashed" },
        data: primary.points.map((point) => point.center)
      },
      {
        type: "line",
        name: `${primaryName} LCL`,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: { color: "#dc2626", type: "dashed" },
        data: primary.points.map((point) => point.lcl)
      },
      {
        type: "line",
        name: secondaryName,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: secondary.points.map((point) => ({
          value: point.value,
          rowIndex: point.rowIndex,
          itemStyle: point.beyondLimits ? { color: "#dc2626", borderColor: "#7f1d1d", borderWidth: 2 } : undefined,
          symbolSize: point.beyondLimits ? 10 : 6
        }))
      },
      {
        type: "line",
        name: `${secondaryName} UCL`,
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbol: "none",
        lineStyle: { color: "#dc2626", type: "dashed" },
        data: secondary.points.map((point) => point.ucl)
      },
      {
        type: "line",
        name: `${secondaryName} CL`,
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbol: "none",
        lineStyle: { color: "#2563eb", type: "dashed" },
        data: secondary.points.map((point) => point.center)
      },
      {
        type: "line",
        name: `${secondaryName} LCL`,
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbol: "none",
        lineStyle: { color: "#dc2626", type: "dashed" },
        data: secondary.points.map((point) => point.lcl)
      }
    ] as SeriesOption[]
  };
}

function buildParetoOption(run: ParetoRun, showCumulative: boolean): EChartsOption {
  const result = run.outputs.pareto;
  const group = result.groups[0];
  if (!group) return {};
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 70, right: 70, top: 46, bottom: 80 },
    xAxis: { type: "category", data: group.items.map((item) => item.category), axisLabel: { interval: 0, rotate: 35 } },
    yAxis: [
      { type: "value", name: "Count" },
      { type: "value", name: "Cum %", min: 0, max: 100 }
    ],
    series: [
      {
        type: "bar",
        name: "Count",
        data: group.items.map((item) => item.count),
        itemStyle: { color: "#2563eb" }
      },
      ...(showCumulative ? [{
        type: "line" as const,
        name: "Cumulative %",
        yAxisIndex: 1,
        data: group.items.map((item) => item.cumulative_percent),
        itemStyle: { color: "#dc2626" },
        lineStyle: { color: "#dc2626" }
      }] : [])
    ] as SeriesOption[]
  };
}

function buildGaugeRROption(run: GaugeRRRun): EChartsOption {
  const result = run.outputs.gauge_rr;
  const components = result.components.filter((component) => component.source !== "Total Variation");
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 90, right: 32, top: 46, bottom: 82 },
    xAxis: { type: "category", data: components.map((component) => component.source), axisLabel: { interval: 0, rotate: 25 } },
    yAxis: { type: "value", name: "% Contribution", min: 0, max: 100 },
    series: [{
      type: "bar",
      name: "Variance Contribution",
      data: components.map((component) => component.contribution_percent),
      itemStyle: { color: "#0f766e" }
    }] as SeriesOption[]
  };
}

function buildVariabilityOption(run: VariabilityRun, showMeans: boolean): EChartsOption {
  const result = run.outputs.variability_chart;
  const categories = result.groups.map((group) => group.x);
  const points = result.points.map((point) => [point.x, point.value, point.rowIndex]);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 70, right: 32, top: 46, bottom: 70 },
    xAxis: { type: "category", data: categories, axisLabel: { interval: 0, rotate: 25 } },
    yAxis: { type: "value", name: result.y },
    series: [
      {
        type: "scatter",
        name: "Measurements",
        data: points,
        symbolSize: 7
      },
      ...(showMeans ? [{
        type: "line" as const,
        name: "Group Mean",
        data: result.groups.map((group) => group.mean),
        step: "middle" as const,
        lineStyle: { color: "#dc2626" },
        itemStyle: { color: "#dc2626" }
      }] : [])
    ] as SeriesOption[]
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

function RedTriangleMenu({
  chartType,
  open,
  showNormalCurve,
  selectedCount,
  onToggle,
  onToggleNormalCurve,
  onClearSelection
}: {
  chartType: ChartType;
  open: boolean;
  showNormalCurve: boolean;
  selectedCount: number;
  onToggle: () => void;
  onToggleNormalCurve: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="red-menu">
      <button className={open ? "red-triangle active" : "red-triangle"} onClick={onToggle} title="Plot options">
        ▶
      </button>
      {open ? (
        <div className="red-menu-popover">
          <button disabled={chartType !== "histogram"} onClick={onToggleNormalCurve}>
            {showNormalCurve ? "Remove Normal Curve" : "Fit Normal Curve"}
          </button>
          <button disabled={selectedCount === 0} onClick={onClearSelection}>
            Clear Row Selection
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DataPreviewTable({
  preview,
  selectedRows,
  onToggleRow
}: {
  preview: DatasetPreview;
  selectedRows: Set<number>;
  onToggleRow: (index: number) => void;
}) {
  const visible = preview.dataset.columns.slice(0, 8);
  return (
    <section className="data-preview-panel">
      <div className="data-preview-header">
        <h3>Data Table</h3>
        <span>{selectedRows.size} selected</span>
      </div>
      <div className="data-preview-scroll">
        <table>
          <thead>
            <tr>
              <th>Row</th>
              {visible.map((column) => (
                <th key={column.name}>{column.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index} className={selectedRows.has(index) ? "selected-row" : ""} onClick={() => onToggleRow(index)}>
                <td>{index + 1}</td>
                {visible.map((column) => (
                  <td key={column.name}>{String(row[column.name] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DistributionRoleDrop({
  label,
  values,
  multiple,
  numericOnly,
  numericColumns,
  onAdd,
  onRemove
}: {
  label: string;
  values: string[];
  multiple: boolean;
  numericOnly: boolean;
  numericColumns: string[];
  onAdd: (field: string) => void;
  onRemove: (field: string) => void;
}) {
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const field = event.dataTransfer.getData("text/plain");
    if (!field) return;
    if (numericOnly && !numericColumns.includes(field)) return;
    onAdd(field);
  }

  return (
    <div className="role-row">
      <button>{label}</button>
      <div className="role-drop" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        {values.length > 0 ? (
          values.map((value) => (
            <button key={value} className="zone-pill" onClick={() => onRemove(value)}>
              {value}
            </button>
          ))
        ) : (
          <em>{multiple ? "drop one or more numeric columns" : numericOnly ? "optional numeric" : "optional"}</em>
        )}
      </div>
    </div>
  );
}

function DistributionReport({
  run,
  openMenu,
  showSummary,
  showQuantiles,
  showNormal,
  onToggleMenu,
  onToggleSummary,
  onToggleQuantiles,
  onToggleNormal
}: {
  run: DistributionRun | null;
  openMenu: string | null;
  showSummary: boolean;
  showQuantiles: boolean;
  showNormal: boolean;
  onToggleMenu: (panel: string) => void;
  onToggleSummary: () => void;
  onToggleQuantiles: () => void;
  onToggleNormal: () => void;
}) {
  if (!run) {
    return (
      <section className="distribution-report-window">
        <p>Assign Y columns and click Run to create distribution summaries.</p>
      </section>
    );
  }

  return (
    <section className="distribution-report-window">
      {run.outputs.distribution.columns.map((column) => (
        <article key={column.name} className="distribution-card">
          <div className="distribution-card-header">
            <div className="red-menu">
              <button className={openMenu === column.name ? "red-triangle active" : "red-triangle"} onClick={() => onToggleMenu(column.name)} title="Distribution options">
                ▶
              </button>
              {openMenu === column.name ? (
                <div className="red-menu-popover">
                  <button onClick={onToggleSummary}>{showSummary ? "Hide Summary Statistics" : "Show Summary Statistics"}</button>
                  <button onClick={onToggleQuantiles}>{showQuantiles ? "Hide Quantiles" : "Show Quantiles"}</button>
                  <button onClick={onToggleNormal}>{showNormal ? "Remove Normal Curve" : "Fit Normal Curve"}</button>
                </div>
              ) : null}
            </div>
            <h3>{column.name}</h3>
            <span>{column.by ? `By ${column.by}` : "All rows"}</span>
          </div>
          <div className="distribution-groups">
            {column.groups.map((group) => (
              <section key={group.group} className="distribution-group">
                <h4>{group.group}</h4>
                {showNormal ? (
                  <div className="normal-overlay-note">
                    Normal curve: mean {group.mean.toFixed(4)}, std {group.std.toFixed(4)}
                  </div>
                ) : null}
                {showSummary ? (
                  <table>
                    <tbody>
                      <tr><th>N</th><td>{group.n.toFixed(3)}</td><th>Missing</th><td>{group.missing.toFixed(0)}</td></tr>
                      <tr><th>Mean</th><td>{group.mean.toFixed(6)}</td><th>Std Dev</th><td>{group.std.toFixed(6)}</td></tr>
                      <tr><th>Std Err</th><td>{group.stderr.toFixed(6)}</td><th>Range</th><td>{group.min.toFixed(6)} to {group.max.toFixed(6)}</td></tr>
                    </tbody>
                  </table>
                ) : null}
                {showQuantiles ? (
                  <table>
                    <tbody>
                      <tr><th>Minimum</th><td>{group.quantiles.p0.toFixed(6)}</td><th>25%</th><td>{group.quantiles.p25.toFixed(6)}</td></tr>
                      <tr><th>Median</th><td>{group.quantiles.p50.toFixed(6)}</td><th>75%</th><td>{group.quantiles.p75.toFixed(6)}</td></tr>
                      <tr><th>Maximum</th><td>{group.quantiles.p100.toFixed(6)}</td><th /></tr>
                    </tbody>
                  </table>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function TabulateReport({
  run,
  menuOpen,
  showCount,
  showMean,
  showStd,
  showRange,
  onToggleMenu,
  onToggleCount,
  onToggleMean,
  onToggleStd,
  onToggleRange
}: {
  run: TabulateRun | null;
  menuOpen: boolean;
  showCount: boolean;
  showMean: boolean;
  showStd: boolean;
  showRange: boolean;
  onToggleMenu: () => void;
  onToggleCount: () => void;
  onToggleMean: () => void;
  onToggleStd: () => void;
  onToggleRange: () => void;
}) {
  if (!run) {
    return (
      <section className="distribution-report-window">
        <p>Assign numeric Y columns and optional grouping columns, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.tabulate;
  const visibleColumns = [
    ...(result.group_columns.length ? result.group_columns : ["Group"]),
    ...(showCount ? ["N Rows"] : []),
    ...result.y_columns.flatMap((column) => [
      ...(showCount ? [`${column} N`, `${column} Missing`] : []),
      ...(showMean ? [`${column} Mean`] : []),
      ...(showStd ? [`${column} Std Dev`] : []),
      ...(showRange ? [`${column} Min`, `${column} Max`] : [])
    ])
  ];

  return (
    <section className="distribution-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Tabulate options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleCount}>{showCount ? "Hide Counts" : "Counts"}</button>
              <button onClick={onToggleMean}>{showMean ? "Hide Means" : "Means"}</button>
              <button onClick={onToggleStd}>{showStd ? "Hide Std Dev" : "Std Dev"}</button>
              <button onClick={onToggleRange}>{showRange ? "Hide Range" : "Range"}</button>
            </div>
          ) : null}
        </div>
        <h3>Tabulate</h3>
        <span>{result.rows.length} groups</span>
      </div>
      <div className="residual-table">
        <table>
          <thead>
            <tr>{visibleColumns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                {visibleColumns.map((column) => {
                  const value = row[column];
                  return <td key={column}>{typeof value === "number" ? value.toFixed(6) : value ?? ""}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FitYByXReport({
  run,
  menuOpen,
  showFit,
  showBand,
  showResiduals,
  onToggleMenu,
  onToggleFit,
  onToggleBand,
  onToggleResiduals
}: {
  run: FitYByXRun | null;
  menuOpen: boolean;
  showFit: boolean;
  showBand: boolean;
  showResiduals: boolean;
  onToggleMenu: () => void;
  onToggleFit: () => void;
  onToggleBand: () => void;
  onToggleResiduals: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildFitYByXOption(run, showFit, showBand), true);
  }, [run, showBand, showFit]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign numeric Y and X columns, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.fit_y_by_x;
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Fit Y by X options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleFit}>{showFit ? "Remove Fit Line" : "Fit Line"}</button>
              <button onClick={onToggleBand}>{showBand ? "Remove Confidence Band" : "Confidence Band"}</button>
              <button onClick={onToggleResiduals}>{showResiduals ? "Hide Residuals" : "Show Residuals"}</button>
            </div>
          ) : null}
        </div>
        <h3>{result.y} by {result.x}</h3>
        <span>{result.n.toFixed(0)} complete rows, {result.missing.toFixed(0)} missing</span>
      </div>
      <div ref={hostRef} className="fit-y-chart" />
      <div className="fit-y-stats">
        <span>r {result.correlation.r.toFixed(6)}</span>
        <span>R2 {result.metrics.r2.toFixed(6)}</span>
        <span>RMSE {result.metrics.rmse.toFixed(6)}</span>
        <span>Slope {result.coefficients.slope.toFixed(6)}</span>
        <span>Intercept {result.coefficients.intercept.toFixed(6)}</span>
      </div>
      {showResiduals ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>X</th><th>Actual</th><th>Predicted</th><th>Residual</th></tr></thead>
            <tbody>
              {result.residuals.slice(0, 20).map((row, index) => (
                <tr key={index}>
                  <td>{row.x.toFixed(6)}</td>
                  <td>{row.actual.toFixed(6)}</td>
                  <td>{row.predicted.toFixed(6)}</td>
                  <td>{row.residual.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function OnewayReport({
  run,
  menuOpen,
  showMeans,
  showIntervals,
  showAnova,
  showComparisons,
  onToggleMenu,
  onToggleMeans,
  onToggleIntervals,
  onToggleAnova,
  onToggleComparisons
}: {
  run: OnewayRun | null;
  menuOpen: boolean;
  showMeans: boolean;
  showIntervals: boolean;
  showAnova: boolean;
  showComparisons: boolean;
  onToggleMenu: () => void;
  onToggleMeans: () => void;
  onToggleIntervals: () => void;
  onToggleAnova: () => void;
  onToggleComparisons: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildOnewayOption(run, showMeans, showIntervals), true);
  }, [run, showIntervals, showMeans]);

  if (!run) return null;

  const result = run.outputs.oneway_anova;
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Oneway options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleMeans}>{showMeans ? "Remove Means" : "Means"}</button>
              <button onClick={onToggleIntervals}>{showIntervals ? "Remove Mean 95% CI" : "Mean 95% CI"}</button>
              <button onClick={onToggleAnova}>{showAnova ? "Hide ANOVA" : "Means/ANOVA"}</button>
              <button onClick={onToggleComparisons}>{showComparisons ? "Hide Tukey HSD" : "Tukey HSD"}</button>
            </div>
          ) : null}
        </div>
        <h3>{result.x}-{result.y} Oneway Analysis</h3>
        <span>{result.n.toFixed(0)} complete rows, {result.missing.toFixed(0)} missing</span>
      </div>
      <div ref={hostRef} className="fit-y-chart" />
      <div className="fit-y-stats">
        <span>Levels {result.levels.toFixed(0)}</span>
        <span>Mean {result.overall_mean.toFixed(6)}</span>
        {result.anova.status !== "ok" ? <span>ANOVA needs at least two populated levels</span> : null}
      </div>
      {showAnova ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Source</th><th>DF</th><th>SS</th><th>MS</th><th>F Ratio</th><th>Prob &gt; F</th></tr></thead>
            <tbody>
              {result.anova.source.map((row) => (
                <tr key={row.term}>
                  <td>{row.term}</td>
                  <td>{row.df.toFixed(0)}</td>
                  <td>{row.sum_squares.toFixed(6)}</td>
                  <td>{row.mean_square === null ? "" : row.mean_square.toFixed(6)}</td>
                  <td>{row.f_ratio === null ? "" : row.f_ratio.toFixed(6)}</td>
                  <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="residual-table">
        <table>
          <thead><tr><th>Level</th><th>N</th><th>Mean</th><th>Std Dev</th><th>Std Err</th><th>Lower 95%</th><th>Upper 95%</th></tr></thead>
          <tbody>
            {result.groups.map((group) => (
              <tr key={group.level}>
                <td>{group.level}</td>
                <td>{group.n.toFixed(0)}</td>
                <td>{group.mean.toFixed(6)}</td>
                <td>{group.std.toFixed(6)}</td>
                <td>{group.stderr.toFixed(6)}</td>
                <td>{group.lower95.toFixed(6)}</td>
                <td>{group.upper95.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showComparisons ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Level A</th><th>Level B</th><th>Difference</th><th>Std Err</th><th>q</th><th>p Value</th></tr></thead>
            <tbody>
              {result.comparisons.length === 0 ? (
                <tr><td colSpan={6}>Pairwise comparisons require at least two levels with residual variance.</td></tr>
              ) : result.comparisons.map((row) => (
                <tr key={`${row.left}-${row.right}`}>
                  <td>{row.left}</td>
                  <td>{row.right}</td>
                  <td>{row.difference.toFixed(6)}</td>
                  <td>{row.stderr.toFixed(6)}</td>
                  <td>{row.q.toFixed(6)}</td>
                  <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MultivariateReport({
  run,
  menuOpen,
  showPValues,
  showCovariance,
  showSummary,
  onToggleMenu,
  onShowCorrelation,
  onTogglePValues,
  onToggleCovariance,
  onToggleSummary
}: {
  run: MultivariateRun | null;
  menuOpen: boolean;
  showPValues: boolean;
  showCovariance: boolean;
  showSummary: boolean;
  onToggleMenu: () => void;
  onShowCorrelation: () => void;
  onTogglePValues: () => void;
  onToggleCovariance: () => void;
  onToggleSummary: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildMultivariateOption(run, showPValues, showCovariance), true);
  }, [run, showCovariance, showPValues]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign two or more numeric columns, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.multivariate;
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Multivariate options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onShowCorrelation}>Correlation Color Map</button>
              <button onClick={onTogglePValues}>{showPValues ? "Hide p Value Map" : "p Value Color Map"}</button>
              <button onClick={onToggleCovariance}>{showCovariance ? "Hide Covariance" : "Covariance Matrix"}</button>
              <button onClick={onToggleSummary}>{showSummary ? "Hide Simple Statistics" : "Simple Statistics"}</button>
            </div>
          ) : null}
        </div>
        <h3>Multivariate Correlations</h3>
        <span>{result.columns.length} columns</span>
      </div>
      <div ref={hostRef} className="fit-y-chart multivariate-chart" />
      <div className="residual-table">
        <table>
          <thead>
            <tr><th>Column</th>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {result.matrix.map((row, index) => (
              <tr key={result.columns[index]}>
                <td>{result.columns[index]}</td>
                {row.map((cell) => (
                  <td key={cell.x}>{cell.r === null ? "" : cell.r.toFixed(6)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPValues ? (
        <div className="residual-table">
          <table>
            <thead>
              <tr><th>Prob &gt; |r|</th>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {result.matrix.map((row, index) => (
                <tr key={result.columns[index]}>
                  <td>{result.columns[index]}</td>
                  {row.map((cell) => (
                    <td key={cell.x}>{cell.p_value === null ? "" : cell.p_value.toFixed(6)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {showSummary ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Column</th><th>N</th><th>Mean</th><th>Std Dev</th><th>Missing</th></tr></thead>
            <tbody>
              {result.summaries.map((summary) => (
                <tr key={summary.column}>
                  <td>{summary.column}</td>
                  <td>{summary.n.toFixed(0)}</td>
                  <td>{summary.mean === null ? "" : summary.mean.toFixed(6)}</td>
                  <td>{summary.std.toFixed(6)}</td>
                  <td>{summary.missing.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ControlChartReport({
  run,
  menuOpen,
  showViolations,
  onToggleMenu,
  onToggleViolations
}: {
  run: ControlChartRun | null;
  menuOpen: boolean;
  showViolations: boolean;
  onToggleMenu: () => void;
  onToggleViolations: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildControlChartOption(run), true);
  }, [run]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign a numeric Y column, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.control_chart;
  const primary = result.chart_type === "xbar_r" ? result.xbar : result.individuals;
  const secondary = result.chart_type === "xbar_r" ? result.range : result.moving_range;
  const title = controlChartLabel(result.chart_type);
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Control chart options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleViolations}>{showViolations ? "Hide Rule Violations" : "Show Rule Violations"}</button>
            </div>
          ) : null}
        </div>
        <h3>{title} Chart of {result.y}</h3>
        <span>{result.n.toFixed(0)} rows, {result.missing.toFixed(0)} missing{result.subgroup_count ? `, ${result.subgroup_count.toFixed(0)} subgroups` : ""}</span>
      </div>
      <div ref={hostRef} className="fit-y-chart control-chart-builder" />
      {result.attribute ? (
        <div className="fit-y-stats">
          <span>CL {result.attribute.center.toFixed(6)}</span>
          <span>Points {result.attribute.points.length.toFixed(0)}</span>
          <span>Sample Size {result.sample_size ?? "-"}</span>
        </div>
      ) : primary && secondary ? (
        <div className="fit-y-stats">
          <span>{result.chart_type === "xbar_r" ? "Xbar" : "I"} CL {primary.center.toFixed(6)}</span>
          <span>{result.chart_type === "xbar_r" ? "Xbar" : "I"} UCL {primary.ucl.toFixed(6)}</span>
          <span>{result.chart_type === "xbar_r" ? "Xbar" : "I"} LCL {primary.lcl.toFixed(6)}</span>
          <span>{result.chart_type === "xbar_r" ? "R" : "MR"} UCL {secondary.ucl.toFixed(6)}</span>
        </div>
      ) : null}
      {showViolations ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Chart</th><th>Rule</th><th>Label</th><th>Value</th><th>Row</th></tr></thead>
            <tbody>
              {result.violations.length === 0 ? (
                <tr><td colSpan={5}>No displayed rule violations.</td></tr>
              ) : result.violations.map((violation) => (
                <tr key={`${violation.chart}-${violation.rowIndex}`}>
                  <td>{violation.chart}</td>
                  <td>{violation.rule}</td>
                  <td>{violation.label}</td>
                  <td>{violation.value.toFixed(6)}</td>
                  <td>{violation.rowIndex + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ParetoReport({
  run,
  menuOpen,
  showCumulative,
  onToggleMenu,
  onToggleCumulative
}: {
  run: ParetoRun | null;
  menuOpen: boolean;
  showCumulative: boolean;
  onToggleMenu: () => void;
  onToggleCumulative: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildParetoOption(run, showCumulative), true);
  }, [run, showCumulative]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign a cause column, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.pareto;
  const group = result.groups[0];
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Pareto options">▶</button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleCumulative}>{showCumulative ? "Hide Cumulative Percent" : "Show Cumulative Percent"}</button>
            </div>
          ) : null}
        </div>
        <h3>Pareto Chart of {result.category}</h3>
        <span>{group?.total.toFixed(0) ?? "0"} total, {result.missing.toFixed(0)} missing</span>
      </div>
      <div ref={hostRef} className="fit-y-chart control-chart-builder" />
      {group ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Cause</th><th>Count</th><th>Percent</th><th>Cumulative %</th></tr></thead>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.category}>
                  <td>{item.category}</td>
                  <td>{item.count.toFixed(3)}</td>
                  <td>{item.percent.toFixed(3)}</td>
                  <td>{item.cumulative_percent.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function GaugeRRReport({
  run,
  menuOpen,
  showAnova,
  onToggleMenu,
  onToggleAnova
}: {
  run: GaugeRRRun | null;
  menuOpen: boolean;
  showAnova: boolean;
  onToggleMenu: () => void;
  onToggleAnova: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildGaugeRROption(run), true);
  }, [run]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign Measurement, Part, and Operator, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.gauge_rr;
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Gauge R&R options">▶</button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleAnova}>{showAnova ? "Hide ANOVA" : "Show ANOVA"}</button>
            </div>
          ) : null}
        </div>
        <h3>Gauge R&amp;R of {result.measurement}</h3>
        <span>{result.part_count.toFixed(0)} parts, {result.operator_count.toFixed(0)} operators, {result.replicates.toFixed(0)} repeats · {result.design.method === "crossed_anova" ? "Crossed ANOVA" : "Range fallback"}</span>
      </div>
      {result.design.warning ? <p className="report-note">Balanced crossed ANOVA was not available; using range fallback because of {result.design.warning.replace("_", " ")}.</p> : null}
      <div className="fit-y-stats">
        <span>Gauge R&amp;R {result.metrics.gauge_rr_percent_study_variation.toFixed(2)}% SV</span>
        <span>Part-To-Part {result.metrics.part_to_part_percent_study_variation.toFixed(2)}% SV</span>
        <span>NDC {result.metrics.ndc.toFixed(2)}</span>
      </div>
      <div ref={hostRef} className="fit-y-chart control-chart-builder" />
      <div className="residual-table">
        <table>
          <thead><tr><th>Source</th><th>Variance</th><th>% Contribution</th><th>Std Dev</th><th>% Study Var</th></tr></thead>
          <tbody>
            {result.components.map((component) => (
              <tr key={component.source}>
                <td>{component.source}</td>
                <td>{component.variance.toFixed(6)}</td>
                <td>{component.contribution_percent.toFixed(3)}</td>
                <td>{component.stddev.toFixed(6)}</td>
                <td>{component.study_variation_percent.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAnova ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Source</th><th>DF</th><th>SS</th><th>MS</th></tr></thead>
            <tbody>
              {result.anova.length === 0 ? (
                <tr><td colSpan={4}>ANOVA table requires a balanced crossed design.</td></tr>
              ) : result.anova.map((row) => (
                <tr key={row.source}>
                  <td>{row.source}</td>
                  <td>{row.df.toFixed(0)}</td>
                  <td>{row.sum_squares.toFixed(6)}</td>
                  <td>{row.mean_square.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="residual-table">
        <table>
          <thead><tr><th>Part</th><th>Operator</th><th>N</th><th>Mean</th><th>Std Dev</th><th>Range</th></tr></thead>
          <tbody>
            {result.cell_summaries.map((cell) => (
              <tr key={`${cell.part}-${cell.operator}`}>
                <td>{cell.part}</td>
                <td>{cell.operator}</td>
                <td>{cell.n.toFixed(0)}</td>
                <td>{cell.mean.toFixed(6)}</td>
                <td>{cell.std.toFixed(6)}</td>
                <td>{cell.range.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VariabilityReport({
  run,
  menuOpen,
  showMeans,
  onToggleMenu,
  onToggleMeans
}: {
  run: VariabilityRun | null;
  menuOpen: boolean;
  showMeans: boolean;
  onToggleMenu: () => void;
  onToggleMeans: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chartRef.current || !run) return;
    chartRef.current.setOption(buildVariabilityOption(run, showMeans), true);
  }, [run, showMeans]);

  if (!run) {
    return (
      <section className="fit-y-report-window">
        <p>Assign Y and X grouping columns, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.variability_chart;
  return (
    <section className="fit-y-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Variability options">▶</button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleMeans}>{showMeans ? "Hide Mean Line" : "Show Mean Line"}</button>
            </div>
          ) : null}
        </div>
        <h3>Variability Chart of {result.y}</h3>
        <span>{result.n.toFixed(0)} rows, {result.groups.length} groups</span>
      </div>
      <div className="fit-y-stats">
        <span>Overall Mean {result.overall.mean.toFixed(6)}</span>
        <span>Std Dev {result.overall.std.toFixed(6)}</span>
        <span>Range {result.overall.range.toFixed(6)}</span>
      </div>
      <div ref={hostRef} className="fit-y-chart control-chart-builder" />
      <div className="residual-table">
        <table>
          <thead><tr><th>{result.x}</th><th>N</th><th>Mean</th><th>Std Dev</th><th>Range</th></tr></thead>
          <tbody>
            {result.groups.map((group) => (
              <tr key={`${group.by}-${group.x}`}>
                <td>{group.x}</td>
                <td>{group.n.toFixed(0)}</td>
                <td>{group.mean.toFixed(6)}</td>
                <td>{group.std.toFixed(6)}</td>
                <td>{group.range.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FitModelReport({
  run,
  response,
  showSummary,
  showAnova,
  showParameters,
  showEffects,
  showEffectLeverage,
  showLackOfFit,
  showAicc,
  showResiduals,
  diagnosticMode,
  onSetDiagnosticMode
}: {
  run: FitModelRun | null;
  response: string;
  showSummary: boolean;
  showAnova: boolean;
  showParameters: boolean;
  showEffects: boolean;
  showEffectLeverage: boolean;
  showLackOfFit: boolean;
  showAicc: boolean;
  showResiduals: boolean;
  diagnosticMode: "residual" | "actual";
  onSetDiagnosticMode: (mode: "residual" | "actual") => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const effectHostRef = useRef<HTMLDivElement>(null);
  const effectChartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current || !run || !response) return;
    if (chartRef.current) chartRef.current.dispose();
    chartRef.current = echarts.init(hostRef.current);
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [run, response]);

  useEffect(() => {
    if (!effectHostRef.current || !run || !response || !showEffectLeverage) return;
    if (effectChartRef.current) effectChartRef.current.dispose();
    effectChartRef.current = echarts.init(effectHostRef.current);
    const resize = () => effectChartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      effectChartRef.current?.dispose();
      effectChartRef.current = null;
    };
  }, [run, response, showEffectLeverage]);

  useEffect(() => {
    if (!chartRef.current || !run || !response) return;
    chartRef.current.setOption(buildFitDiagnosticOption(run, response, diagnosticMode), true);
  }, [diagnosticMode, response, run]);

  useEffect(() => {
    if (!effectChartRef.current || !run || !response || !showEffectLeverage) return;
    effectChartRef.current.setOption(buildEffectLeverageOption(run, response), true);
  }, [response, run, showEffectLeverage]);

  if (!run || !response) return null;

  const metrics = run.metrics[response];
  const criteria = run.information_criteria[response];
  const formula = run.prediction_formulas[response];
  const effectLeverageRows = run.effect_leverage[response] ?? [];
  const lackOfFit = run.lack_of_fit[response];
  const residualRows = run.residuals[response] ?? [];
  return (
    <section className="fit-model-diagnostics">
      <div className="distribution-card-header">
        <h3>Response {response}</h3>
        <span>R2 {metrics?.r2.toFixed(6)} · RMSE {metrics?.rmse.toFixed(6)}</span>
      </div>

      {showSummary ? (
        <div className="fit-summary-grid">
          <span>RSquare <strong>{metrics.r2.toFixed(6)}</strong></span>
          <span>Adj RSquare <strong>{metrics.adj_r2.toFixed(6)}</strong></span>
          <span>Root Mean Square Error <strong>{metrics.rmse.toFixed(6)}</strong></span>
          <span>Observations <strong>{metrics.n.toFixed(0)}</strong></span>
          <span>Terms <strong>{metrics.terms.toFixed(0)}</strong></span>
        </div>
      ) : null}

      {formula ? <pre className="fit-formula">{formula}</pre> : null}

      {showAicc ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Criterion</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>AICc</td><td>{criteria.aicc.toFixed(6)}</td></tr>
              <tr><td>AIC</td><td>{criteria.aic.toFixed(6)}</td></tr>
              <tr><td>BIC</td><td>{criteria.bic.toFixed(6)}</td></tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {showAnova ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Source</th><th>DF</th><th>SS</th><th>MS</th><th>F Ratio</th><th>Prob &gt; F</th></tr></thead>
            <tbody>
              {(run.anova[response] ?? []).map((row) => (
                <tr key={row.source}>
                  <td>{row.source}</td>
                  <td>{row.df.toFixed(0)}</td>
                  <td>{row.sum_squares.toFixed(6)}</td>
                  <td>{row.mean_square === null ? "" : row.mean_square.toFixed(6)}</td>
                  <td>{row.f_ratio === null ? "" : row.f_ratio.toFixed(6)}</td>
                  <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showParameters ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Term</th><th>Estimate</th><th>Std Error</th><th>t Ratio</th><th>Prob &gt; |t|</th></tr></thead>
            <tbody>
              {(run.parameter_estimates[response] ?? []).map((row) => (
                <tr key={row.term}>
                  <td>{row.term}</td>
                  <td>{row.estimate.toFixed(6)}</td>
                  <td>{row.stderr.toFixed(6)}</td>
                  <td>{row.t_ratio === null ? "" : row.t_ratio.toFixed(6)}</td>
                  <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showEffects ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Effect</th><th>DF</th><th>SS</th><th>F Ratio</th><th>Prob &gt; F</th></tr></thead>
            <tbody>
              {(run.effect_tests[response] ?? []).map((row) => (
                <tr key={row.effect}>
                  <td>{row.effect}</td>
                  <td>{row.df.toFixed(0)}</td>
                  <td>{row.sum_squares.toFixed(6)}</td>
                  <td>{row.f_ratio === null ? "" : row.f_ratio.toFixed(6)}</td>
                  <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showEffectLeverage ? (
        <>
          <div ref={effectHostRef} className="fit-y-chart" />
          <div className="residual-table">
            <table>
              <thead><tr><th>Effect</th><th>Leverage Score</th><th>F Ratio</th><th>Prob &gt; F</th></tr></thead>
              <tbody>
                {effectLeverageRows.map((row) => (
                  <tr key={row.effect}>
                    <td>{row.effect}</td>
                    <td>{row.leverage_score.toFixed(6)}</td>
                    <td>{row.f_ratio === null ? "" : row.f_ratio.toFixed(6)}</td>
                    <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {showLackOfFit ? (
        <div className="residual-table">
          {lackOfFit?.status === "ok" ? (
            <table>
              <thead><tr><th>Source</th><th>DF</th><th>SS</th><th>MS</th><th>F Ratio</th><th>Prob &gt; F</th></tr></thead>
              <tbody>
                {lackOfFit.rows.map((row) => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td>{row.df.toFixed(0)}</td>
                    <td>{row.sum_squares.toFixed(6)}</td>
                    <td>{row.mean_square.toFixed(6)}</td>
                    <td>{row.f_ratio === null ? "" : row.f_ratio.toFixed(6)}</td>
                    <td>{row.p_value === null ? "" : row.p_value.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="fit-summary-grid">
              <span>Status <strong>Not estimable</strong></span>
              <span>Distinct X Patterns <strong>{lackOfFit?.distinct_points.toFixed(0) ?? "0"}</strong></span>
              <span>Replicated Patterns <strong>{lackOfFit?.replicated_points.toFixed(0) ?? "0"}</strong></span>
            </div>
          )}
        </div>
      ) : null}

      {showResiduals ? (
        <>
          <div className="fit-diagnostic-toolbar">
            <button className={diagnosticMode === "residual" ? "active" : ""} onClick={() => onSetDiagnosticMode("residual")}>Predicted by Residual</button>
            <button className={diagnosticMode === "actual" ? "active" : ""} onClick={() => onSetDiagnosticMode("actual")}>Predicted by Actual</button>
          </div>
          <div ref={hostRef} className="fit-y-chart" />
          <div className="residual-table">
            <table>
              <thead><tr><th>Row</th><th>Actual</th><th>Predicted</th><th>Residual</th><th>Studentized</th><th>Leverage</th><th>Cook</th></tr></thead>
              <tbody>
                {residualRows.slice(0, 25).map((row) => (
                  <tr key={row.rowIndex}>
                    <td>{(row.rowIndex + 1).toFixed(0)}</td>
                    <td>{row.actual.toFixed(6)}</td>
                    <td>{row.predicted.toFixed(6)}</td>
                    <td>{row.residual.toFixed(6)}</td>
                    <td>{row.studentized.toFixed(6)}</td>
                    <td>{row.leverage.toFixed(6)}</td>
                    <td>{row.cook.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CapabilityReport({
  run,
  menuOpen,
  showSummary,
  showIndices,
  showObserved,
  onToggleMenu,
  onToggleSummary,
  onToggleIndices,
  onToggleObserved
}: {
  run: ProcessCapabilityRun | null;
  menuOpen: boolean;
  showSummary: boolean;
  showIndices: boolean;
  showObserved: boolean;
  onToggleMenu: () => void;
  onToggleSummary: () => void;
  onToggleIndices: () => void;
  onToggleObserved: () => void;
}) {
  if (!run) {
    return (
      <section className="capability-report-window">
        <p>Assign a process measurement, enter spec limits, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.process_capability;
  return (
    <section className="capability-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Capability options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleSummary}>{showSummary ? "Hide Summary" : "Show Summary"}</button>
              <button onClick={onToggleIndices}>{showIndices ? "Hide Capability Indices" : "Show Capability Indices"}</button>
              <button onClick={onToggleObserved}>{showObserved ? "Hide Out-of-Spec" : "Show Out-of-Spec"}</button>
            </div>
          ) : null}
        </div>
        <h3>{result.column}</h3>
        <span>LSL {result.lsl ?? "-"} Target {result.target ?? "-"} USL {result.usl ?? "-"}</span>
      </div>
      <div className="capability-grid">
        {showSummary ? (
          <table>
            <tbody>
              <tr><th>N</th><td>{result.n.toFixed(0)}</td><th>Missing</th><td>{result.missing.toFixed(0)}</td></tr>
              <tr><th>Mean</th><td>{result.mean.toFixed(6)}</td><th>Std Dev</th><td>{result.std.toFixed(6)}</td></tr>
              <tr><th>Mean-LSL</th><td>{result.spec_distance.mean_to_lsl?.toFixed(6) ?? "-"}</td><th>USL-Mean</th><td>{result.spec_distance.usl_to_mean?.toFixed(6) ?? "-"}</td></tr>
            </tbody>
          </table>
        ) : null}
        {showIndices ? (
          <table>
            <tbody>
              <tr><th>Cp</th><td>{result.cp.toFixed(6)}</td><th>Cpk</th><td>{result.cpk.toFixed(6)}</td></tr>
              <tr><th>CPL</th><td>{result.cpl.toFixed(6)}</td><th>CPU</th><td>{result.cpu.toFixed(6)}</td></tr>
              <tr><th>Pp</th><td>{result.pp.toFixed(6)}</td><th>Ppk</th><td>{result.ppk.toFixed(6)}</td></tr>
              <tr><th>PPL</th><td>{result.ppl.toFixed(6)}</td><th>PPU</th><td>{result.ppu.toFixed(6)}</td></tr>
            </tbody>
          </table>
        ) : null}
        {showObserved ? (
          <table>
            <tbody>
              <tr><th>Below LSL</th><td>{result.observed.below_lsl.toFixed(0)}</td><th>Above USL</th><td>{result.observed.above_usl.toFixed(0)}</td></tr>
              <tr><th>Total Out</th><td>{result.observed.total_out.toFixed(0)}</td><th>Out %</th><td>{result.observed.out_percent.toFixed(4)}%</td></tr>
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

function metricCell(value: number | undefined) {
  return typeof value === "number" ? value.toFixed(4) : "-";
}

function ModelComparisonTable({ runs, activeRunId }: { runs: ModelRun[]; activeRunId?: string }) {
  if (runs.length === 0) {
    return <p>Linear model output appears here.</p>;
  }
  return (
    <div className="model-comparison">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Y</th>
            <th>X</th>
            <th>Train R2</th>
            <th>Train RMSE</th>
            <th>Validation R2</th>
            <th>Validation RMSE</th>
            <th>Validation N</th>
          </tr>
        </thead>
        <tbody>
          {runs.slice(-8).reverse().map((run) => (
            <tr key={run.id} className={run.id === activeRunId ? "active-model-run" : undefined}>
              <td>{run.id}</td>
              <td>{run.target}</td>
              <td>{run.features.join(", ")}</td>
              <td>{metricCell(run.metrics.train_r2 ?? run.metrics.r2)}</td>
              <td>{metricCell(run.metrics.train_rmse ?? run.metrics.rmse)}</td>
              <td>{run.metrics.validation_n > 0 ? metricCell(run.metrics.validation_r2) : "-"}</td>
              <td>{run.metrics.validation_n > 0 ? metricCell(run.metrics.validation_rmse) : "-"}</td>
              <td>{metricCell(run.metrics.validation_n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReliabilityReport({
  run,
  menuOpen,
  showRiskTable,
  onToggleMenu,
  onToggleRiskTable
}: {
  run: ReliabilityRun | null;
  menuOpen: boolean;
  showRiskTable: boolean;
  onToggleMenu: () => void;
  onToggleRiskTable: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current || !run) return;
    const chart = echarts.init(hostRef.current);
    const result = run.outputs.reliability_survival;
    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { top: 36, left: 52, right: 18, bottom: 42 },
      xAxis: { type: "value", name: result.time },
      yAxis: { type: "value", min: 0, max: 1, name: "Survival" },
      series: result.groups.map((group) => ({
        type: "line",
        name: group.group,
        step: "end",
        symbolSize: 5,
        data: group.curve.map((point) => [point.time, point.survival])
      })) as SeriesOption[]
    } satisfies EChartsOption);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [run]);

  if (!run) {
    return (
      <section className="reliability-report-window">
        <p>Assign Time and Event columns, then click Run.</p>
      </section>
    );
  }

  const result = run.outputs.reliability_survival;
  return (
    <section className="reliability-report-window">
      <div className="distribution-card-header">
        <div className="red-menu">
          <button className={menuOpen ? "red-triangle active" : "red-triangle"} onClick={onToggleMenu} title="Reliability options">
            ▶
          </button>
          {menuOpen ? (
            <div className="red-menu-popover">
              <button onClick={onToggleRiskTable}>{showRiskTable ? "Hide Risk Table" : "Risk Table"}</button>
            </div>
          ) : null}
        </div>
        <h3>Survival of {result.time}</h3>
        <span>{result.groups.length} group(s), {result.missing.toFixed(0)} missing</span>
      </div>
      <div ref={hostRef} className="reliability-chart" />
      <div className="fit-y-stats">
        {result.groups.map((group) => (
          <span key={group.group}>{group.group}: events {group.events.toFixed(0)}, censored {group.censored.toFixed(0)}, median {group.median_survival?.toFixed(3) ?? "-"}</span>
        ))}
      </div>
      {showRiskTable ? (
        <div className="residual-table">
          <table>
            <thead><tr><th>Group</th><th>Time</th><th>At Risk</th><th>Events</th><th>Censored</th><th>Survival</th></tr></thead>
            <tbody>
              {result.groups.flatMap((group) => group.curve.map((point) => ({ group: group.group, point }))).map((row, index) => (
                <tr key={index}>
                  <td>{row.group}</td>
                  <td>{row.point.time.toFixed(3)}</td>
                  <td>{row.point.at_risk.toFixed(0)}</td>
                  <td>{row.point.events.toFixed(0)}</td>
                  <td>{row.point.censored.toFixed(0)}</td>
                  <td>{row.point.survival.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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
  const [modelRuns, setModelRuns] = useState<ModelRun[]>([]);
  const [fitResponses, setFitResponses] = useState<string[]>([]);
  const [fitEffects, setFitEffects] = useState<string[]>([]);
  const [includeQuadratic, setIncludeQuadratic] = useState(false);
  const [fitRun, setFitRun] = useState<FitModelRun | null>(null);
  const [activeProfileResponse, setActiveProfileResponse] = useState("");
  const [profilerValues, setProfilerValues] = useState<Record<string, number>>({});
  const [profilerLocks, setProfilerLocks] = useState<Record<string, boolean>>({});
  const [profilerGoal, setProfilerGoal] = useState<ProfilerGoal>("maximize");
  const [profilerTarget, setProfilerTarget] = useState<number | null>(null);
  const [fitModelMenuOpen, setFitModelMenuOpen] = useState(false);
  const [showFitModelSummary, setShowFitModelSummary] = useState(true);
  const [showFitModelProfiler, setShowFitModelProfiler] = useState(true);
  const [showFitModelAnova, setShowFitModelAnova] = useState(true);
  const [showFitModelParameters, setShowFitModelParameters] = useState(true);
  const [showFitModelEffects, setShowFitModelEffects] = useState(false);
  const [showFitModelEffectLeverage, setShowFitModelEffectLeverage] = useState(false);
  const [showFitModelLackOfFit, setShowFitModelLackOfFit] = useState(false);
  const [showFitModelAicc, setShowFitModelAicc] = useState(false);
  const [showFitModelResiduals, setShowFitModelResiduals] = useState(true);
  const [fitModelDiagnosticMode, setFitModelDiagnosticMode] = useState<"residual" | "actual">("residual");
  const [activeAnalyzePlatform, setActiveAnalyzePlatform] = useState<"graph" | "fitModel" | "distribution" | "fitYByX" | "multivariate" | "controlChart" | "capability" | "tabulate" | "pareto" | "gaugeRR" | "variability" | "doe" | "reliability">("graph");
  const [analyzeMenuOpen, setAnalyzeMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [plotMenuOpen, setPlotMenuOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showNormalCurve, setShowNormalCurve] = useState(false);
  const [distributionY, setDistributionY] = useState<string[]>([]);
  const [distributionBy, setDistributionBy] = useState<string | null>(null);
  const [distributionFreq, setDistributionFreq] = useState<string | null>(null);
  const [distributionWeight, setDistributionWeight] = useState<string | null>(null);
  const [distributionRun, setDistributionRun] = useState<DistributionRun | null>(null);
  const [distributionMenuOpen, setDistributionMenuOpen] = useState<string | null>(null);
  const [showDistributionSummary, setShowDistributionSummary] = useState(true);
  const [showDistributionQuantiles, setShowDistributionQuantiles] = useState(true);
  const [showDistributionNormal, setShowDistributionNormal] = useState(false);
  const [tabulateY, setTabulateY] = useState<string[]>([]);
  const [tabulateGroups, setTabulateGroups] = useState<string[]>([]);
  const [tabulateRun, setTabulateRun] = useState<TabulateRun | null>(null);
  const [tabulateMenuOpen, setTabulateMenuOpen] = useState(false);
  const [paretoCategory, setParetoCategory] = useState<string | null>(null);
  const [paretoCount, setParetoCount] = useState<string | null>(null);
  const [paretoBy, setParetoBy] = useState<string | null>(null);
  const [paretoRun, setParetoRun] = useState<ParetoRun | null>(null);
  const [paretoMenuOpen, setParetoMenuOpen] = useState(false);
  const [showParetoCumulative, setShowParetoCumulative] = useState(true);
  const [gaugeMeasurement, setGaugeMeasurement] = useState<string | null>(null);
  const [gaugePart, setGaugePart] = useState<string | null>(null);
  const [gaugeOperator, setGaugeOperator] = useState<string | null>(null);
  const [gaugeRun, setGaugeRun] = useState<GaugeRRRun | null>(null);
  const [gaugeMenuOpen, setGaugeMenuOpen] = useState(false);
  const [showGaugeAnova, setShowGaugeAnova] = useState(true);
  const [variabilityY, setVariabilityY] = useState<string | null>(null);
  const [variabilityX, setVariabilityX] = useState<string | null>(null);
  const [variabilityBy, setVariabilityBy] = useState<string | null>(null);
  const [variabilityRun, setVariabilityRun] = useState<VariabilityRun | null>(null);
  const [variabilityMenuOpen, setVariabilityMenuOpen] = useState(false);
  const [showVariabilityMeans, setShowVariabilityMeans] = useState(true);
  const [reliabilityTime, setReliabilityTime] = useState<string | null>(null);
  const [reliabilityEvent, setReliabilityEvent] = useState<string | null>(null);
  const [reliabilityBy, setReliabilityBy] = useState<string | null>(null);
  const [reliabilityRun, setReliabilityRun] = useState<ReliabilityRun | null>(null);
  const [reliabilityMenuOpen, setReliabilityMenuOpen] = useState(false);
  const [showReliabilityRiskTable, setShowReliabilityRiskTable] = useState(true);
  const [showTabulateCount, setShowTabulateCount] = useState(true);
  const [showTabulateMean, setShowTabulateMean] = useState(true);
  const [showTabulateStd, setShowTabulateStd] = useState(true);
  const [showTabulateRange, setShowTabulateRange] = useState(false);
  const [fitYResponse, setFitYResponse] = useState<string | null>(null);
  const [fitXFactor, setFitXFactor] = useState<string | null>(null);
  const [fitYByXRun, setFitYByXRun] = useState<FitYByXRun | null>(null);
  const [onewayRun, setOnewayRun] = useState<OnewayRun | null>(null);
  const [fitYMenuOpen, setFitYMenuOpen] = useState(false);
  const [showFitYLine, setShowFitYLine] = useState(true);
  const [showFitYBand, setShowFitYBand] = useState(false);
  const [showFitYResiduals, setShowFitYResiduals] = useState(false);
  const [showOnewayMeans, setShowOnewayMeans] = useState(true);
  const [showOnewayIntervals, setShowOnewayIntervals] = useState(true);
  const [showOnewayAnova, setShowOnewayAnova] = useState(true);
  const [showOnewayComparisons, setShowOnewayComparisons] = useState(false);
  const [multivariateY, setMultivariateY] = useState<string[]>([]);
  const [multivariateRun, setMultivariateRun] = useState<MultivariateRun | null>(null);
  const [multivariateMenuOpen, setMultivariateMenuOpen] = useState(false);
  const [showMultivariatePValues, setShowMultivariatePValues] = useState(false);
  const [showMultivariateCovariance, setShowMultivariateCovariance] = useState(false);
  const [showMultivariateSummary, setShowMultivariateSummary] = useState(false);
  const [controlChartY, setControlChartY] = useState<string | null>(null);
  const [controlChartX, setControlChartX] = useState<string | null>(null);
  const [controlChartPhase, setControlChartPhase] = useState<string | null>(null);
  const [controlChartSampleSize, setControlChartSampleSize] = useState<string | null>(null);
  const [controlChartType, setControlChartType] = useState<ControlChartType>("imr");
  const [controlChartRun, setControlChartRun] = useState<ControlChartRun | null>(null);
  const [controlChartMenuOpen, setControlChartMenuOpen] = useState(false);
  const [showControlChartViolations, setShowControlChartViolations] = useState(true);
  const [capabilityY, setCapabilityY] = useState<string | null>(null);
  const [capabilityLsl, setCapabilityLsl] = useState("95");
  const [capabilityTarget, setCapabilityTarget] = useState("98");
  const [capabilityUsl, setCapabilityUsl] = useState("100");
  const [capabilityRun, setCapabilityRun] = useState<ProcessCapabilityRun | null>(null);
  const [capabilityMenuOpen, setCapabilityMenuOpen] = useState(false);
  const [showCapabilitySummary, setShowCapabilitySummary] = useState(true);
  const [showCapabilityIndices, setShowCapabilityIndices] = useState(true);
  const [showCapabilityObserved, setShowCapabilityObserved] = useState(true);
  const [doeFactors, setDoeFactors] = useState<DoeFactor[]>([
    { name: "temperature", low: 70, high: 80 },
    { name: "pressure", low: 4, high: 6 }
  ]);
  const [doeReplicates, setDoeReplicates] = useState(1);
  const [doeRandomize, setDoeRandomize] = useState(false);
  const [doeSeed, setDoeSeed] = useState(1);

  async function loadDataset(datasetId: string) {
    const datasetPreview = await previewDataset(datasetId);
    const linearRuns = await listLinearModelRuns(datasetId);
    setPreview(datasetPreview);
    setModelRuns(linearRuns);
    const numeric = datasetPreview.dataset.columns.find((column) => column.type === "numeric")?.name;
    setZones({ ...emptyZones, x: datasetPreview.dataset.timestamp_column ? [datasetPreview.dataset.timestamp_column] : [], y: numeric ? [numeric] : [] });
    setChartType(datasetPreview.dataset.timestamp_column && numeric ? "line" : "scatter");
    setAnalysis(null);
    setModel(null);
    setFitRun(null);
    setFitResponses([]);
    setFitEffects([]);
    setProfilerValues({});
    setProfilerLocks({});
    setProfilerGoal("maximize");
    setProfilerTarget(null);
    setActiveProfileResponse("");
    setFitModelMenuOpen(false);
    setShowFitModelSummary(true);
    setShowFitModelProfiler(true);
    setShowFitModelAnova(true);
    setShowFitModelParameters(true);
    setShowFitModelEffects(false);
    setShowFitModelAicc(false);
    setShowFitModelResiduals(true);
    setFitModelDiagnosticMode("residual");
    setSelectedRows(new Set());
    setShowNormalCurve(false);
    setPlotMenuOpen(false);
    setDistributionY([]);
    setDistributionBy(null);
    setDistributionFreq(null);
    setDistributionWeight(null);
    setDistributionRun(null);
    setDistributionMenuOpen(null);
    setTabulateY([]);
    setTabulateGroups([]);
    setTabulateRun(null);
    setTabulateMenuOpen(false);
    setParetoCategory(null);
    setParetoCount(null);
    setParetoBy(null);
    setParetoRun(null);
    setParetoMenuOpen(false);
    setGaugeMeasurement(null);
    setGaugePart(null);
    setGaugeOperator(null);
    setGaugeRun(null);
    setGaugeMenuOpen(false);
    setVariabilityY(null);
    setVariabilityX(null);
    setVariabilityBy(null);
    setVariabilityRun(null);
    setVariabilityMenuOpen(false);
    setReliabilityTime(null);
    setReliabilityEvent(null);
    setReliabilityBy(null);
    setReliabilityRun(null);
    setReliabilityMenuOpen(false);
    setFitYResponse(null);
    setFitXFactor(null);
    setFitYByXRun(null);
    setOnewayRun(null);
    setFitYMenuOpen(false);
    setMultivariateY([]);
    setMultivariateRun(null);
    setMultivariateMenuOpen(false);
    setControlChartY(null);
    setControlChartX(null);
    setControlChartPhase(null);
    setControlChartSampleSize(null);
    setControlChartType("imr");
    setControlChartRun(null);
    setControlChartMenuOpen(false);
    setCapabilityY(null);
    setCapabilityRun(null);
    setCapabilityMenuOpen(false);
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
    const handleChartClick = (params: ChartClickParams) => {
      const rowIndex = rowIndexFromChart(params);
      if (rowIndex !== null) toggleRowSelection(rowIndex);
    };
    chartInstance.current.on("click", handleChartClick);
    const resize = () => chartInstance.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chartInstance.current?.off("click", handleChartClick);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeAnalyzePlatform !== "fitModel") return;
    if (!showFitModelProfiler) return;
    if (!profilerRef.current) return;
    profilerInstance.current = echarts.init(profilerRef.current);
    const resize = () => profilerInstance.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      profilerInstance.current?.dispose();
      profilerInstance.current = null;
    };
  }, [activeAnalyzePlatform, fitRun, showFitModelProfiler]);

  const columns = preview?.dataset.columns ?? [];
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "numeric").map((column) => column.name), [columns]);
  const groupingColumns = useMemo(() => columns.filter((column) => column.type !== "datetime").map((column) => column.name), [columns]);
  const visibleColumns = useMemo(
    () => columns.filter((column) => column.name.toLowerCase().includes(search.trim().toLowerCase())),
    [columns, search]
  );
  const recommendations = useMemo(() => recommendedCharts(zones, columns), [zones, columns]);
  const activeY = zones.y.join(", ") || numericColumns[0] || "";
  const activeX = zones.x.join(", ") || preview?.dataset.timestamp_column || "";
  const profileResponse = activeProfileResponse || fitRun?.responses[0] || "";
  const profilePrediction = fitRun && profileResponse ? predictFit(fitRun, profileResponse, profilerValues) : null;
  const profileDesirability = fitRun && profileResponse && profilePrediction !== null
    ? desirabilityScore(fitRun, profileResponse, profilePrediction, profilerGoal, profilerTarget)
    : null;

  useEffect(() => {
    if (!chartInstance.current || !preview) return;
    if (zones.x.length === 0 && zones.y.length === 0) {
      chartInstance.current.clear();
      return;
    }
    chartInstance.current.setOption(buildOption(chartType, preview.rows, zones, selectedRows, showNormalCurve), true);
  }, [chartType, preview, selectedRows, showNormalCurve, zones]);

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
    setModelRuns(await listLinearModelRuns(datasetPreview.dataset.id));
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
    setSelectedRows(new Set());
    setShowNormalCurve(false);
    setPlotMenuOpen(false);
    setDistributionY([]);
    setDistributionBy(null);
    setDistributionFreq(null);
    setDistributionWeight(null);
    setDistributionRun(null);
    setDistributionMenuOpen(null);
    setFitYResponse(null);
    setFitXFactor(null);
    setFitYByXRun(null);
    setOnewayRun(null);
    setFitYMenuOpen(false);
    setMultivariateY([]);
    setMultivariateRun(null);
    setMultivariateMenuOpen(false);
    setControlChartY(null);
    setControlChartX(null);
    setControlChartPhase(null);
    setControlChartRun(null);
    setControlChartMenuOpen(false);
    setCapabilityY(null);
    setCapabilityRun(null);
    setCapabilityMenuOpen(false);
    setStatus(`Loaded ${datasetPreview.dataset.name}: ${datasetPreview.dataset.row_count} rows, ${datasetPreview.dataset.columns.length} columns.`);
  }

  function updateDoeFactor(index: number, patch: Partial<DoeFactor>) {
    setDoeFactors((current) => current.map((factor, factorIndex) => (factorIndex === index ? { ...factor, ...patch } : factor)));
  }

  async function handleGenerateDoe() {
    const cleanedFactors = doeFactors.filter((factor) => String(factor.name).trim());
    if (cleanedFactors.length === 0) {
      setStatus("DOE generation requires at least one factor.");
      return;
    }
    const datasetPreview = await generateFullFactorialDoe(cleanedFactors, doeReplicates, doeRandomize, doeSeed);
    setPreview(datasetPreview);
    setDatasets(await listDatasets());
    setModelRuns([]);
    const factorColumns = datasetPreview.dataset.columns.filter((column) => !["standard_order", "run_order", "replicate"].includes(column.name));
    setZones({ ...emptyZones, x: factorColumns[0] ? [factorColumns[0].name] : [], y: factorColumns[1] ? [factorColumns[1].name] : [] });
    setChartType("scatter");
    setSelectedRows(new Set());
    setStatus(`Generated DOE ${datasetPreview.dataset.id}: ${datasetPreview.dataset.row_count} runs from ${cleanedFactors.length} factors.`);
  }

  function toggleRowSelection(index: number) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function rowIndexFromChart(params: ChartClickParams) {
    if (params.data && typeof params.data === "object" && "rowIndex" in params.data) {
      const rowIndex = Number((params.data as { rowIndex?: number }).rowIndex);
      return Number.isInteger(rowIndex) ? rowIndex : null;
    }
    return null;
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
    setModelRuns(await listLinearModelRuns(preview.dataset.id));
    setStatus(`Trained ${result.id}: ${target} from ${feature} with ${(result.metrics.validation_fraction * 100).toFixed(0)}% validation holdout.`);
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
    const defaults = profilerDefaults(result);
    const locks = Object.fromEntries(result.profiler_effects.map((effect) => [effect.name, false]));
    const initialPrediction = predictFit(result, result.responses[0], defaults);
    setFitRun(result);
    setActiveProfileResponse(result.responses[0]);
    setProfilerValues(defaults);
    setProfilerLocks(locks);
    setProfilerGoal("maximize");
    setProfilerTarget(initialPrediction);
    setFitModelMenuOpen(true);
    setStatus(`Fit Model ${result.id}: ${responses.join(", ")} by ${effects.join(", ")}.`);
  }

  async function handleOptimizeProfiler() {
    if (!fitRun || !profileResponse) return;
    const optimized = await optimizeFitModelProfiler(fitRun.id, profileResponse, profilerValues, profilerLocks, profilerGoal, profilerTarget);
    setProfilerValues(optimized.values);
    setStatus(`Optimized unlocked profiler factors for ${profileResponse}: prediction ${optimized.prediction.toFixed(3)}, desirability ${optimized.desirability.toFixed(3)}.`);
  }

  async function handleSaveFitDiagnostics() {
    if (!fitRun) return;
    const updatedPreview = await saveFitModelDiagnostics(fitRun.id, true);
    setPreview(updatedPreview);
    setDatasets(await listDatasets());
    setFitModelMenuOpen(false);
    setStatus(`Saved executable prediction formulas, formula predictions, residuals, leverage, and Cook's D for ${fitRun.responses.join(", ")}.`);
  }

  async function handleDistribution() {
    if (!preview) return;
    const responses = distributionY.length > 0 ? distributionY : zones.y.filter((field) => numericColumns.includes(field));
    if (responses.length === 0) {
      setStatus("Distribution requires at least one numeric Y column.");
      return;
    }
    const result = await runDistribution(preview.dataset.id, responses, {
      by: distributionBy,
      freq: distributionFreq,
      weight: distributionWeight
    });
    setDistributionRun(result);
    setDistributionMenuOpen(result.outputs.distribution.columns[0]?.name ?? null);
    setStatus(`Distribution ${result.id}: ${responses.join(", ")}${distributionBy ? ` by ${distributionBy}` : ""}.`);
  }

  function openDistributionPlatform() {
    if (distributionY.length === 0) {
      const seeded = zones.y.filter((field) => numericColumns.includes(field));
      setDistributionY(seeded.length > 0 ? seeded : numericColumns.slice(0, 1));
    }
    setActiveAnalyzePlatform("distribution");
    setAnalyzeMenuOpen(false);
  }

  async function handleTabulate() {
    if (!preview) return;
    const responses = tabulateY.length > 0 ? tabulateY : zones.y.filter((field) => numericColumns.includes(field));
    if (responses.length === 0) {
      setStatus("Tabulate requires at least one numeric Y column.");
      return;
    }
    const result = await runTabulate(preview.dataset.id, responses, tabulateGroups);
    setTabulateRun(result);
    setTabulateMenuOpen(true);
    setStatus(`Tabulate ${result.id}: ${responses.join(", ")} across ${result.outputs.tabulate.rows.length} groups.`);
  }

  function openTabulatePlatform() {
    if (tabulateY.length === 0) {
      const seeded = zones.y.filter((field) => numericColumns.includes(field));
      setTabulateY(seeded.length > 0 ? seeded : numericColumns.slice(0, 2));
    }
    setActiveAnalyzePlatform("tabulate");
    setAnalyzeMenuOpen(false);
  }

  function openDoePlatform() {
    setActiveAnalyzePlatform("doe");
    setAnalyzeMenuOpen(false);
  }

  async function handlePareto() {
    if (!preview || !paretoCategory) {
      setStatus("Pareto requires one cause/category column.");
      return;
    }
    const result = await runPareto(preview.dataset.id, paretoCategory, { count: paretoCount, by: paretoBy });
    setParetoRun(result);
    setParetoMenuOpen(true);
    setStatus(`Pareto ${result.id}: ${paretoCategory}${paretoBy ? ` by ${paretoBy}` : ""}.`);
  }

  function openParetoPlatform() {
    if (!paretoCategory) {
      setParetoCategory(groupingColumns.find((field) => !numericColumns.includes(field)) ?? groupingColumns[0] ?? null);
    }
    setActiveAnalyzePlatform("pareto");
    setAnalyzeMenuOpen(false);
  }

  async function handleGaugeRR() {
    if (!preview || !gaugeMeasurement || !gaugePart || !gaugeOperator) {
      setStatus("Gauge R&R requires Measurement, Part, and Operator roles.");
      return;
    }
    const result = await runGaugeRR(preview.dataset.id, gaugeMeasurement, { part: gaugePart, operator: gaugeOperator });
    setGaugeRun(result);
    setGaugeMenuOpen(true);
    setStatus(`Gauge R&R ${result.id}: ${gaugeMeasurement} by ${gaugePart} and ${gaugeOperator}.`);
  }

  function openGaugeRRPlatform() {
    if (!gaugeMeasurement) {
      setGaugeMeasurement(zones.y.find((field) => numericColumns.includes(field)) ?? numericColumns[0] ?? null);
    }
    if (!gaugePart) {
      setGaugePart(groupingColumns.find((field) => field.toLowerCase().includes("batch")) ?? groupingColumns[0] ?? null);
    }
    if (!gaugeOperator) {
      setGaugeOperator(groupingColumns.find((field) => field.toLowerCase().includes("equipment")) ?? groupingColumns.find((field) => field !== gaugePart) ?? null);
    }
    setActiveAnalyzePlatform("gaugeRR");
    setAnalyzeMenuOpen(false);
  }

  async function handleVariability() {
    if (!preview || !variabilityY || !variabilityX) {
      setStatus("Variability Chart requires Y and X grouping roles.");
      return;
    }
    const result = await runVariabilityChart(preview.dataset.id, variabilityY, { x: variabilityX, by: variabilityBy });
    setVariabilityRun(result);
    setVariabilityMenuOpen(true);
    setStatus(`Variability Chart ${result.id}: ${variabilityY} by ${variabilityX}.`);
  }

  function openVariabilityPlatform() {
    if (!variabilityY) {
      setVariabilityY(zones.y.find((field) => numericColumns.includes(field)) ?? numericColumns[0] ?? null);
    }
    if (!variabilityX) {
      setVariabilityX(groupingColumns.find((field) => field.toLowerCase().includes("batch")) ?? groupingColumns[0] ?? null);
    }
    setActiveAnalyzePlatform("variability");
    setAnalyzeMenuOpen(false);
  }

  async function handleReliability() {
    if (!preview || !reliabilityTime || !reliabilityEvent) {
      setStatus("Reliability requires Time and Event roles.");
      return;
    }
    const result = await runReliabilitySurvival(preview.dataset.id, reliabilityTime, { event: reliabilityEvent, by: reliabilityBy });
    setReliabilityRun(result);
    setReliabilityMenuOpen(true);
    setStatus(`Reliability ${result.id}: survival of ${reliabilityTime} by ${reliabilityEvent}.`);
  }

  function openReliabilityPlatform() {
    if (!reliabilityTime) {
      setReliabilityTime(numericColumns.find((field) => field.toLowerCase().includes("time") || field.toLowerCase().includes("hour")) ?? numericColumns[0] ?? null);
    }
    if (!reliabilityEvent) {
      setReliabilityEvent(groupingColumns.find((field) => field.toLowerCase().includes("event") || field.toLowerCase().includes("fail")) ?? numericColumns.find((field) => field !== reliabilityTime) ?? null);
    }
    setActiveAnalyzePlatform("reliability");
    setAnalyzeMenuOpen(false);
  }

  async function handleMultivariate() {
    if (!preview) return;
    const columnsForRun = multivariateY.length > 1 ? multivariateY : numericColumns.slice(0, 4);
    if (columnsForRun.length < 2) {
      setStatus("Multivariate requires at least two numeric columns.");
      return;
    }
    const result = await runMultivariate(preview.dataset.id, columnsForRun);
    setMultivariateRun(result);
    setMultivariateMenuOpen(true);
    setStatus(`Multivariate ${result.id}: ${columnsForRun.length} columns.`);
  }

  function openMultivariatePlatform() {
    if (multivariateY.length < 2) {
      const seeded = [...zones.y, ...zones.x].filter((field) => numericColumns.includes(field));
      setMultivariateY(seeded.length > 1 ? seeded : numericColumns.slice(0, 4));
    }
    setActiveAnalyzePlatform("multivariate");
    setAnalyzeMenuOpen(false);
  }

  async function handleFitYByX() {
    if (!preview || !fitYResponse || !fitXFactor) {
      setStatus("Fit Y by X requires one numeric Y and one X factor.");
      return;
    }
    const xType = columns.find((column) => column.name === fitXFactor)?.type;
    if (xType === "categorical") {
      const result = await runOneway(preview.dataset.id, fitYResponse, fitXFactor);
      setOnewayRun(result);
      setFitYByXRun(null);
      setStatus(`Oneway ${result.id}: ${fitYResponse} by ${fitXFactor}.`);
    } else if (xType === "numeric") {
      const result = await runFitYByX(preview.dataset.id, fitYResponse, fitXFactor);
      setFitYByXRun(result);
      setOnewayRun(null);
      setStatus(`Fit Y by X ${result.id}: ${fitYResponse} by ${fitXFactor}.`);
    } else {
      setStatus("Fit Y by X requires a numeric X for regression or a categorical X for Oneway.");
      return;
    }
    setFitYMenuOpen(true);
  }

  function openFitYByXPlatform() {
    const response = fitYResponse ?? zones.y.find((field) => numericColumns.includes(field)) ?? numericColumns[0] ?? null;
    const validZoneX = zones.x.find((field) => {
      const type = columns.find((column) => column.name === field)?.type;
      return type === "numeric" || type === "categorical";
    });
    if (!fitYResponse) setFitYResponse(response);
    if (!fitXFactor) setFitXFactor(validZoneX ?? columns.find((column) => column.type === "categorical")?.name ?? numericColumns.find((field) => field !== response) ?? numericColumns[1] ?? null);
    setActiveAnalyzePlatform("fitYByX");
    setAnalyzeMenuOpen(false);
  }

  function optionalNumber(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function handleControlChart() {
    if (!preview || !controlChartY) {
      setStatus("Control Chart Builder requires one numeric Y column.");
      return;
    }
    const result = await runControlChart(preview.dataset.id, controlChartY, {
      x: controlChartX,
      phase: controlChartPhase,
      sample_size: controlChartSampleSize,
      chart_type: controlChartType
    });
    setControlChartRun(result);
    setControlChartMenuOpen(true);
    setStatus(`Control Chart ${result.id}: ${controlChartLabel(controlChartType)} chart of ${controlChartY}.`);
  }

  function openControlChartPlatform() {
    if (!controlChartY) {
      setControlChartY(zones.y.find((field) => numericColumns.includes(field)) ?? numericColumns[0] ?? null);
    }
    if (!controlChartX) {
      setControlChartX(preview?.dataset.timestamp_column ?? zones.x[0] ?? null);
    }
    setActiveAnalyzePlatform("controlChart");
    setAnalyzeMenuOpen(false);
  }

  async function handleCapability() {
    if (!preview || !capabilityY) {
      setStatus("Process Capability requires one numeric process column.");
      return;
    }
    const result = await runProcessCapability(preview.dataset.id, capabilityY, {
      lsl: optionalNumber(capabilityLsl),
      target: optionalNumber(capabilityTarget),
      usl: optionalNumber(capabilityUsl)
    });
    setCapabilityRun(result);
    setCapabilityMenuOpen(true);
    setStatus(`Process Capability ${result.id}: ${capabilityY}.`);
  }

  function openCapabilityPlatform() {
    if (!capabilityY) {
      setCapabilityY(zones.y.find((field) => numericColumns.includes(field)) ?? numericColumns[0] ?? null);
    }
    setActiveAnalyzePlatform("capability");
    setAnalyzeMenuOpen(false);
  }

  function openFitModelPlatform() {
    const responses = zones.y.filter((field) => numericColumns.includes(field));
    const responseFallback = responses.length > 0 ? responses : numericColumns.slice(0, 1);
    if (fitResponses.length === 0) {
      setFitResponses(responseFallback);
    }
    if (fitEffects.length === 0) {
      const zoneEffects = zones.x.filter((field) => numericColumns.includes(field));
      setFitEffects(zoneEffects.length > 0 ? zoneEffects : numericColumns.filter((field) => !responseFallback.includes(field)).slice(0, 2));
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
            <button className={activeAnalyzePlatform === "fitModel" || activeAnalyzePlatform === "distribution" || activeAnalyzePlatform === "tabulate" || activeAnalyzePlatform === "pareto" || activeAnalyzePlatform === "gaugeRR" || activeAnalyzePlatform === "variability" || activeAnalyzePlatform === "reliability" || activeAnalyzePlatform === "fitYByX" || activeAnalyzePlatform === "multivariate" || activeAnalyzePlatform === "controlChart" || activeAnalyzePlatform === "doe" ? "menu-button active" : "menu-button"} onClick={() => setAnalyzeMenuOpen((open) => !open)}>
              Analyze
            </button>
            {analyzeMenuOpen ? (
              <div className="analyze-dropdown">
                <button className="primary" onClick={openDistributionPlatform}>
                  Distribution
                </button>
                <button onClick={openFitYByXPlatform}>Fit Y by X</button>
                <button onClick={openTabulatePlatform}>Tabulate</button>
                <button onClick={openParetoPlatform}>Pareto</button>
                <button className="primary" onClick={openFitModelPlatform}>
                  Fit Model
                </button>
                <button onClick={openMultivariatePlatform}>Multivariate Methods</button>
                <button>Predictive Modeling</button>
                <button>Specialized Modeling</button>
                <button onClick={openControlChartPlatform}>Control Chart Builder</button>
                <button onClick={openCapabilityPlatform}>Process Capability</button>
                <button onClick={openGaugeRRPlatform}>Gauge R&amp;R</button>
                <button onClick={openVariabilityPlatform}>Variability Chart</button>
                <button onClick={openReliabilityPlatform}>Reliability / Survival</button>
                <button onClick={openDoePlatform}>DOE</button>
              </div>
            ) : null}
          </div>
          <button className={activeAnalyzePlatform === "graph" ? "menu-button active" : "menu-button"} onClick={() => setActiveAnalyzePlatform("graph")}>
            Graph
          </button>
          <button className={activeAnalyzePlatform === "controlChart" ? "menu-button active" : "menu-button"} onClick={openControlChartPlatform}>
            SPC
          </button>
          <span>Help</span>
        </nav>
      </header>

      <section className="builder-title">
        <strong>{activeAnalyzePlatform === "fitModel" ? "Model Specification" : activeAnalyzePlatform === "distribution" ? "Distribution" : activeAnalyzePlatform === "tabulate" ? "Tabulate" : activeAnalyzePlatform === "pareto" ? "Pareto" : activeAnalyzePlatform === "gaugeRR" ? "Gauge R&R" : activeAnalyzePlatform === "variability" ? "Variability Chart" : activeAnalyzePlatform === "reliability" ? "Reliability / Survival" : activeAnalyzePlatform === "multivariate" ? "Multivariate" : activeAnalyzePlatform === "fitYByX" ? "Fit Y by X" : activeAnalyzePlatform === "controlChart" ? "Control Chart Builder" : activeAnalyzePlatform === "capability" ? "Process Capability" : activeAnalyzePlatform === "doe" ? "DOE" : "Graph Builder"}</strong>
        {preview ? <em>{preview.dataset.name}</em> : null}
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
              <div className="profiler-title">
                {fitRun ? (
                  <div className="red-menu">
                    <button className={fitModelMenuOpen ? "red-triangle active" : "red-triangle"} onClick={() => setFitModelMenuOpen((open) => !open)} title="Fit Model report options">
                      ▶
                    </button>
                    {fitModelMenuOpen ? (
                      <div className="red-menu-popover red-menu-wide">
                        <div className="red-menu-section">Display</div>
                        <button onClick={() => setShowFitModelSummary((show) => !show)}>{showFitModelSummary ? "Hide Fit Summary" : "Fit Summary"}</button>
                        <button onClick={() => setShowFitModelAnova((show) => !show)}>{showFitModelAnova ? "Hide ANOVA" : "ANOVA"}</button>
                        <button onClick={() => setShowFitModelParameters((show) => !show)}>{showFitModelParameters ? "Hide Parameter Estimates" : "Parameter Estimates"}</button>
                        <button onClick={() => setShowFitModelEffects((show) => !show)}>{showFitModelEffects ? "Hide Effect Tests" : "Effect Tests"}</button>
                        <button onClick={() => setShowFitModelEffectLeverage((show) => !show)}>{showFitModelEffectLeverage ? "Hide Effect Leverage" : "Effect Leverage"}</button>
                        <button onClick={() => setShowFitModelAicc((show) => !show)}>{showFitModelAicc ? "Hide AICc" : "AICc"}</button>
                        <button onClick={() => setShowFitModelLackOfFit((show) => !show)}>{showFitModelLackOfFit ? "Hide Lack of Fit" : "Lack of Fit"}</button>
                        <div className="red-menu-section">Profilers</div>
                        <button onClick={() => setShowFitModelProfiler((show) => !show)}>{showFitModelProfiler ? "Hide Factor Profiler" : "Factor Profiler"}</button>
                        <button disabled>Contour Profiler</button>
                        <button disabled>Surface Profiler</button>
                        <div className="red-menu-section">Row Diagnostics</div>
                        <button onClick={() => setShowFitModelResiduals((show) => !show)}>{showFitModelResiduals ? "Hide Residual Plot" : "Predicted by Residual"}</button>
                        <button onClick={() => { setShowFitModelResiduals(true); setFitModelDiagnosticMode("actual"); }}>Predicted by Actual</button>
                        <button onClick={() => { setShowFitModelResiduals(true); setFitModelDiagnosticMode("residual"); }}>Predicted by Residual</button>
                        <div className="red-menu-section">Save Columns</div>
                        <button onClick={handleSaveFitDiagnostics}>Save Prediction Formula and Diagnostics</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <h3>Prediction Profiler</h3>
              </div>
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
                {showFitModelProfiler ? (
                  <>
                    <div className="profiler-metrics">
                      <span>R2 {fitRun.metrics[profileResponse]?.r2.toFixed(3)}</span>
                      <span>Adj R2 {fitRun.metrics[profileResponse]?.adj_r2.toFixed(3)}</span>
                      <span>RMSE {fitRun.metrics[profileResponse]?.rmse.toFixed(3)}</span>
                      <strong>Prediction {profilePrediction?.toFixed(3)}</strong>
                      <strong>Desirability {profileDesirability?.toFixed(3)}</strong>
                    </div>
                    <div className="profiler-objective">
                      <label>
                        Goal
                        <select value={profilerGoal} onChange={(event) => setProfilerGoal(event.target.value as ProfilerGoal)}>
                          <option value="maximize">Maximize</option>
                          <option value="minimize">Minimize</option>
                          <option value="target">Match Target</option>
                        </select>
                      </label>
                      <label>
                        Target
                        <input
                          type="number"
                          value={profilerTarget ?? ""}
                          onChange={(event) => setProfilerTarget(event.target.value === "" ? null : Number(event.target.value))}
                        />
                      </label>
                      <button onClick={() => {
                        const defaults = profilerDefaults(fitRun);
                        setProfilerValues(defaults);
                        setProfilerLocks(Object.fromEntries(fitRun.profiler_effects.map((effect) => [effect.name, false])));
                      }}>Reset Factors</button>
                      <button onClick={handleOptimizeProfiler}>Optimize Unlocked</button>
                    </div>
                    <div className="profiler-controls">
                      {fitRun.profiler_effects.map((effect) => (
                        <label key={effect.name}>
                          <span>{effect.name}: {(profilerValues[effect.name] ?? effect.mean).toFixed(3)}</span>
                          <span className="profiler-lock"><input
                            type="checkbox"
                            checked={profilerLocks[effect.name] ?? false}
                            onChange={(event) => setProfilerLocks((current) => ({ ...current, [effect.name]: event.target.checked }))}
                          /> Lock</span>
                          <input
                            type="range"
                            min={effect.min}
                            max={effect.max}
                            step={(effect.max - effect.min) / 100 || 1}
                            value={profilerValues[effect.name] ?? effect.mean}
                            disabled={profilerLocks[effect.name] ?? false}
                            onChange={(event) => setProfilerValues((current) => ({ ...current, [effect.name]: Number(event.target.value) }))}
                          />
                        </label>
                      ))}
                    </div>
                    <div ref={profilerRef} className="profiler-chart" />
                  </>
                ) : null}
                <FitModelReport
                  run={fitRun}
                  response={profileResponse}
                  showSummary={showFitModelSummary}
                  showAnova={showFitModelAnova}
                  showParameters={showFitModelParameters}
                  showEffects={showFitModelEffects}
                  showEffectLeverage={showFitModelEffectLeverage}
                  showLackOfFit={showFitModelLackOfFit}
                  showAicc={showFitModelAicc}
                  showResiduals={showFitModelResiduals}
                  diagnosticMode={fitModelDiagnosticMode}
                  onSetDiagnosticMode={setFitModelDiagnosticMode}
                />
              </>
            ) : (
              <p>Select columns, assign Y and effects, then click Run to create an interactive Prediction Profiler.</p>
            )}
          </section>
        </section>
      ) : activeAnalyzePlatform === "distribution" ? (
        <section className="distribution-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Y"
                values={distributionY}
                multiple
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setDistributionY((current) => current.includes(field) ? current : [...current, field])}
                onRemove={(field) => setDistributionY((current) => current.filter((item) => item !== field))}
              />
              <DistributionRoleDrop
                label="By"
                values={distributionBy ? [distributionBy] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setDistributionBy(field)}
                onRemove={() => setDistributionBy(null)}
              />
              <DistributionRoleDrop
                label="Freq"
                values={distributionFreq ? [distributionFreq] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setDistributionFreq(field)}
                onRemove={() => setDistributionFreq(null)}
              />
              <DistributionRoleDrop
                label="Weight"
                values={distributionWeight ? [distributionWeight] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setDistributionWeight(field)}
                onRemove={() => setDistributionWeight(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleDistribution}>Run</button>
            <button onClick={() => {
              setDistributionY([]);
              setDistributionBy(null);
              setDistributionFreq(null);
              setDistributionWeight(null);
              setDistributionRun(null);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <DistributionReport
            run={distributionRun}
            openMenu={distributionMenuOpen}
            showSummary={showDistributionSummary}
            showQuantiles={showDistributionQuantiles}
            showNormal={showDistributionNormal}
            onToggleMenu={(panel) => setDistributionMenuOpen((current) => current === panel ? null : panel)}
            onToggleSummary={() => setShowDistributionSummary((show) => !show)}
            onToggleQuantiles={() => setShowDistributionQuantiles((show) => !show)}
            onToggleNormal={() => setShowDistributionNormal((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "tabulate" ? (
        <section className="distribution-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Y Columns"
                values={tabulateY}
                multiple
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setTabulateY((current) => current.includes(field) ? current : [...current, field])}
                onRemove={(field) => setTabulateY((current) => current.filter((item) => item !== field))}
              />
              <DistributionRoleDrop
                label="Grouping Columns"
                values={tabulateGroups}
                multiple
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setTabulateGroups((current) => current.includes(field) ? current : [...current, field])}
                onRemove={(field) => setTabulateGroups((current) => current.filter((item) => item !== field))}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleTabulate}>Run</button>
            <button onClick={() => {
              setTabulateY([]);
              setTabulateGroups([]);
              setTabulateRun(null);
              setTabulateMenuOpen(false);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <TabulateReport
            run={tabulateRun}
            menuOpen={tabulateMenuOpen}
            showCount={showTabulateCount}
            showMean={showTabulateMean}
            showStd={showTabulateStd}
            showRange={showTabulateRange}
            onToggleMenu={() => setTabulateMenuOpen((open) => !open)}
            onToggleCount={() => setShowTabulateCount((show) => !show)}
            onToggleMean={() => setShowTabulateMean((show) => !show)}
            onToggleStd={() => setShowTabulateStd((show) => !show)}
            onToggleRange={() => setShowTabulateRange((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "pareto" ? (
        <section className="distribution-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Cause"
                values={paretoCategory ? [paretoCategory] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setParetoCategory(field)}
                onRemove={() => setParetoCategory(null)}
              />
              <DistributionRoleDrop
                label="Freq"
                values={paretoCount ? [paretoCount] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setParetoCount(field)}
                onRemove={() => setParetoCount(null)}
              />
              <DistributionRoleDrop
                label="By"
                values={paretoBy ? [paretoBy] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setParetoBy(field)}
                onRemove={() => setParetoBy(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handlePareto}>Run</button>
            <button onClick={() => {
              setParetoCategory(null);
              setParetoCount(null);
              setParetoBy(null);
              setParetoRun(null);
              setParetoMenuOpen(false);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <ParetoReport
            run={paretoRun}
            menuOpen={paretoMenuOpen}
            showCumulative={showParetoCumulative}
            onToggleMenu={() => setParetoMenuOpen((open) => !open)}
            onToggleCumulative={() => setShowParetoCumulative((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "gaugeRR" ? (
        <section className="distribution-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Measurement"
                values={gaugeMeasurement ? [gaugeMeasurement] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setGaugeMeasurement(field)}
                onRemove={() => setGaugeMeasurement(null)}
              />
              <DistributionRoleDrop
                label="Part"
                values={gaugePart ? [gaugePart] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setGaugePart(field)}
                onRemove={() => setGaugePart(null)}
              />
              <DistributionRoleDrop
                label="Operator"
                values={gaugeOperator ? [gaugeOperator] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setGaugeOperator(field)}
                onRemove={() => setGaugeOperator(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleGaugeRR}>Run</button>
            <button onClick={() => {
              setGaugeMeasurement(null);
              setGaugePart(null);
              setGaugeOperator(null);
              setGaugeRun(null);
              setGaugeMenuOpen(false);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <GaugeRRReport
            run={gaugeRun}
            menuOpen={gaugeMenuOpen}
            showAnova={showGaugeAnova}
            onToggleMenu={() => setGaugeMenuOpen((open) => !open)}
            onToggleAnova={() => setShowGaugeAnova((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "variability" ? (
        <section className="distribution-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Y"
                values={variabilityY ? [variabilityY] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setVariabilityY(field)}
                onRemove={() => setVariabilityY(null)}
              />
              <DistributionRoleDrop
                label="X"
                values={variabilityX ? [variabilityX] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setVariabilityX(field)}
                onRemove={() => setVariabilityX(null)}
              />
              <DistributionRoleDrop
                label="By"
                values={variabilityBy ? [variabilityBy] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setVariabilityBy(field)}
                onRemove={() => setVariabilityBy(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleVariability}>Run</button>
            <button onClick={() => {
              setVariabilityY(null);
              setVariabilityX(null);
              setVariabilityBy(null);
              setVariabilityRun(null);
              setVariabilityMenuOpen(false);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <VariabilityReport
            run={variabilityRun}
            menuOpen={variabilityMenuOpen}
            showMeans={showVariabilityMeans}
            onToggleMenu={() => setVariabilityMenuOpen((open) => !open)}
            onToggleMeans={() => setShowVariabilityMeans((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "reliability" ? (
        <section className="fit-y-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Time"
                values={reliabilityTime ? [reliabilityTime] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setReliabilityTime(field)}
                onRemove={() => setReliabilityTime(null)}
              />
              <DistributionRoleDrop
                label="Event"
                values={reliabilityEvent ? [reliabilityEvent] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setReliabilityEvent(field)}
                onRemove={() => setReliabilityEvent(null)}
              />
              <DistributionRoleDrop
                label="By"
                values={reliabilityBy ? [reliabilityBy] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setReliabilityBy(field)}
                onRemove={() => setReliabilityBy(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleReliability}>Run</button>
            <button onClick={() => {
              setReliabilityTime(null);
              setReliabilityEvent(null);
              setReliabilityBy(null);
              setReliabilityRun(null);
              setReliabilityMenuOpen(false);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <ReliabilityReport
            run={reliabilityRun}
            menuOpen={reliabilityMenuOpen}
            showRiskTable={showReliabilityRiskTable}
            onToggleMenu={() => setReliabilityMenuOpen((open) => !open)}
            onToggleRiskTable={() => setShowReliabilityRiskTable((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "multivariate" ? (
        <section className="fit-y-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Y Columns"
                values={multivariateY}
                multiple
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setMultivariateY((current) => current.includes(field) ? current : [...current, field])}
                onRemove={(field) => setMultivariateY((current) => current.filter((item) => item !== field))}
              />
              <DistributionRoleDrop
                label="Weight"
                values={[]}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={() => undefined}
                onRemove={() => undefined}
              />
              <DistributionRoleDrop
                label="Freq"
                values={[]}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={() => undefined}
                onRemove={() => undefined}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleMultivariate}>Run</button>
            <button onClick={() => {
              setMultivariateY([]);
              setMultivariateRun(null);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <MultivariateReport
            run={multivariateRun}
            menuOpen={multivariateMenuOpen}
            showPValues={showMultivariatePValues}
            showCovariance={showMultivariateCovariance}
            showSummary={showMultivariateSummary}
            onToggleMenu={() => setMultivariateMenuOpen((open) => !open)}
            onShowCorrelation={() => {
              setShowMultivariatePValues(false);
              setShowMultivariateCovariance(false);
            }}
            onTogglePValues={() => {
              setShowMultivariatePValues((show) => !show);
              setShowMultivariateCovariance(false);
            }}
            onToggleCovariance={() => {
              setShowMultivariateCovariance((show) => !show);
              setShowMultivariatePValues(false);
            }}
            onToggleSummary={() => setShowMultivariateSummary((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "fitYByX" ? (
        <section className="fit-y-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Assign Roles</h3>
              <DistributionRoleDrop
                label="Y"
                values={fitYResponse ? [fitYResponse] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setFitYResponse(field)}
                onRemove={() => setFitYResponse(null)}
              />
              <DistributionRoleDrop
                label="X"
                values={fitXFactor ? [fitXFactor] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setFitXFactor(field)}
                onRemove={() => setFitXFactor(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleFitYByX}>Run</button>
            <button onClick={() => {
              setFitYResponse(null);
              setFitXFactor(null);
              setFitYByXRun(null);
              setOnewayRun(null);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          {onewayRun ? (
            <OnewayReport
              run={onewayRun}
              menuOpen={fitYMenuOpen}
              showMeans={showOnewayMeans}
              showIntervals={showOnewayIntervals}
              showAnova={showOnewayAnova}
              showComparisons={showOnewayComparisons}
              onToggleMenu={() => setFitYMenuOpen((open) => !open)}
              onToggleMeans={() => setShowOnewayMeans((show) => !show)}
              onToggleIntervals={() => setShowOnewayIntervals((show) => !show)}
              onToggleAnova={() => setShowOnewayAnova((show) => !show)}
              onToggleComparisons={() => setShowOnewayComparisons((show) => !show)}
            />
          ) : (
            <FitYByXReport
              run={fitYByXRun}
              menuOpen={fitYMenuOpen}
              showFit={showFitYLine}
              showBand={showFitYBand}
              showResiduals={showFitYResiduals}
              onToggleMenu={() => setFitYMenuOpen((open) => !open)}
              onToggleFit={() => setShowFitYLine((show) => !show)}
              onToggleBand={() => setShowFitYBand((show) => !show)}
              onToggleResiduals={() => setShowFitYResiduals((show) => !show)}
            />
          )}
        </section>
      ) : activeAnalyzePlatform === "controlChart" ? (
        <section className="capability-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Control Chart Builder</h3>
              <label className="model-personality">
                Chart
                <select value={controlChartType} onChange={(event) => {
                  const nextType = event.target.value as ControlChartType;
                  setControlChartType(nextType);
                  if (nextType === "xbar_r") {
                    setControlChartX((current) => groupingColumns.find((column) => column.toLowerCase().includes("batch") && column !== controlChartY) ?? groupingColumns.find((column) => column !== controlChartY && column !== current) ?? current);
                  }
                  if (["p", "np", "u"].includes(nextType)) {
                    setControlChartSampleSize((current) => current ?? numericColumns.find((column) => column !== controlChartY) ?? null);
                  }
                }}>
                  <option value="imr">I-MR</option>
                  <option value="xbar_r">Xbar-R</option>
                  <option value="p">P</option>
                  <option value="np">NP</option>
                  <option value="c">C</option>
                  <option value="u">U</option>
                </select>
              </label>
              <DistributionRoleDrop
                label="Y"
                values={controlChartY ? [controlChartY] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setControlChartY(field)}
                onRemove={() => setControlChartY(null)}
              />
              <DistributionRoleDrop
                label="Subgroup / Time"
                values={controlChartX ? [controlChartX] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setControlChartX(field)}
                onRemove={() => setControlChartX(null)}
              />
              <DistributionRoleDrop
                label="Sample Size"
                values={controlChartSampleSize ? [controlChartSampleSize] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setControlChartSampleSize(field)}
                onRemove={() => setControlChartSampleSize(null)}
              />
              <DistributionRoleDrop
                label="Phase"
                values={controlChartPhase ? [controlChartPhase] : []}
                multiple={false}
                numericOnly={false}
                numericColumns={numericColumns}
                onAdd={(field) => setControlChartPhase(field)}
                onRemove={() => setControlChartPhase(null)}
              />
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleControlChart}>Run</button>
            <button onClick={() => {
              setControlChartY(null);
              setControlChartX(null);
              setControlChartPhase(null);
              setControlChartSampleSize(null);
              setControlChartType("imr");
              setControlChartRun(null);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <ControlChartReport
            run={controlChartRun}
            menuOpen={controlChartMenuOpen}
            showViolations={showControlChartViolations}
            onToggleMenu={() => setControlChartMenuOpen((open) => !open)}
            onToggleViolations={() => setShowControlChartViolations((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "capability" ? (
        <section className="capability-platform">
          <aside className="model-select-columns">
            <div className="column-header">{columns.length} Columns</div>
            <input className="column-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter column name" />
            <div className="field-list model-field-list">
              {visibleColumns.map((column) => (
                <FieldItem key={column.name} column={column} />
              ))}
            </div>
          </aside>

          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Process Measurement</h3>
              <DistributionRoleDrop
                label="Y"
                values={capabilityY ? [capabilityY] : []}
                multiple={false}
                numericOnly
                numericColumns={numericColumns}
                onAdd={(field) => setCapabilityY(field)}
                onRemove={() => setCapabilityY(null)}
              />
              <div className="spec-limit-grid">
                <label>LSL<input value={capabilityLsl} onChange={(event) => setCapabilityLsl(event.target.value)} /></label>
                <label>Target<input value={capabilityTarget} onChange={(event) => setCapabilityTarget(event.target.value)} /></label>
                <label>USL<input value={capabilityUsl} onChange={(event) => setCapabilityUsl(event.target.value)} /></label>
              </div>
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleCapability}>Run</button>
            <button onClick={() => {
              setCapabilityY(null);
              setCapabilityRun(null);
            }}>
              Remove
            </button>
            <label className="quadratic-toggle"><input type="checkbox" /> Keep dialog open</label>
          </aside>

          <CapabilityReport
            run={capabilityRun}
            menuOpen={capabilityMenuOpen}
            showSummary={showCapabilitySummary}
            showIndices={showCapabilityIndices}
            showObserved={showCapabilityObserved}
            onToggleMenu={() => setCapabilityMenuOpen((open) => !open)}
            onToggleSummary={() => setShowCapabilitySummary((show) => !show)}
            onToggleIndices={() => setShowCapabilityIndices((show) => !show)}
            onToggleObserved={() => setShowCapabilityObserved((show) => !show)}
          />
        </section>
      ) : activeAnalyzePlatform === "doe" ? (
        <section className="doe-platform">
          <section className="distribution-dialog">
            <div className="role-box">
              <h3>Full Factorial Design</h3>
              <div className="doe-factor-grid">
                <span>Factor</span>
                <span>Low</span>
                <span>High</span>
                <span />
                {doeFactors.map((factor, index) => (
                  <div className="doe-factor-row" key={index}>
                    <input value={factor.name} onChange={(event) => updateDoeFactor(index, { name: event.target.value })} />
                    <input value={factor.low} onChange={(event) => updateDoeFactor(index, { low: event.target.value })} />
                    <input value={factor.high} onChange={(event) => updateDoeFactor(index, { high: event.target.value })} />
                    <button onClick={() => setDoeFactors((current) => current.filter((_, factorIndex) => factorIndex !== index))}>Remove</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setDoeFactors((current) => [...current, { name: `factor_${current.length + 1}`, low: -1, high: 1 }])}>Add Factor</button>
              <div className="spec-limit-grid">
                <label>Replicates<input type="number" min={1} max={100} value={doeReplicates} onChange={(event) => setDoeReplicates(Number(event.target.value))} /></label>
                <label>Seed<input type="number" value={doeSeed} onChange={(event) => setDoeSeed(Number(event.target.value))} /></label>
                <label className="quadratic-toggle"><input type="checkbox" checked={doeRandomize} onChange={(event) => setDoeRandomize(event.target.checked)} /> Randomize</label>
              </div>
            </div>
          </section>

          <aside className="model-actions">
            <button>Help</button>
            <button onClick={handleGenerateDoe}>Generate</button>
            <button onClick={() => setDoeFactors([{ name: "temperature", low: 70, high: 80 }, { name: "pressure", low: 4, high: 6 }])}>Reset</button>
          </aside>

          <section className="doe-preview">
            <h3>{preview?.dataset.source === "doe:full_factorial" ? preview.dataset.name : "Generated Design"}</h3>
            {preview?.dataset.source === "doe:full_factorial" ? (
              <DataPreviewTable preview={preview} selectedRows={selectedRows} onToggleRow={toggleRowSelection} />
            ) : (
              <p>Define factors and generate a full factorial design.</p>
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
          <div className="graph-toolbar">
            <RedTriangleMenu
              chartType={chartType}
              open={plotMenuOpen}
              showNormalCurve={showNormalCurve}
              selectedCount={selectedRows.size}
              onToggle={() => setPlotMenuOpen((open) => !open)}
              onToggleNormalCurve={() => {
                if (chartType === "histogram") setShowNormalCurve((show) => !show);
              }}
              onClearSelection={() => setSelectedRows(new Set())}
            />
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
              <ModelComparisonTable runs={modelRuns} activeRunId={model?.id} />
            </section>
          </div>
        </section>
      </section>
      )}
    </main>
  );
}
