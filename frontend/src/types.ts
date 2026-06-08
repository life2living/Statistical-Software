export type ColumnType = "datetime" | "numeric" | "categorical";
export type ChartType = "line" | "area" | "scatter" | "histogram" | "box" | "bar" | "stacked_bar" | "pie" | "heatmap" | "control";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  missing_rate: number;
  min: number | string | null;
  max: number | string | null;
  categories: string[];
  unit?: string | null;
  quality_flags: string[];
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  source: string;
  version: number;
  row_count: number;
  timestamp_column: string | null;
  equipment_tag: string | null;
  sampling_rate: string | null;
  columns: ColumnProfile[];
  created_at: string;
}

export interface DatasetPreview {
  dataset: Dataset;
  rows: Record<string, string | number | null>[];
}

export interface ChartSpec {
  dataset_id: string;
  name: string;
  chart_type: ChartType;
  encodings: {
    x?: string | null;
    y?: string | null;
    color?: string | null;
    size?: string | null;
    facet?: string | null;
  };
  filters: Record<string, unknown>;
  aggregation?: string | null;
  layout: Record<string, unknown>;
}

export interface AnalysisRun {
  id: string;
  method: string;
  outputs: Record<string, unknown>;
  interpretation: string[];
}

export interface ModelRun {
  id: string;
  target: string;
  features: string[];
  metrics: Record<string, number>;
  coefficients: Record<string, number>;
}

export interface ProfilerEffect {
  name: string;
  min: number;
  max: number;
  mean: number;
}

export interface FitModelRun {
  id: string;
  model_type: "standard_least_squares";
  responses: string[];
  effects: string[];
  terms: string[];
  include_quadratic: boolean;
  metrics: Record<string, Record<string, number>>;
  coefficients: Record<string, Record<string, number>>;
  profiler_effects: ProfilerEffect[];
  profiler: Record<string, Record<string, { x: number; y: number }[]>>;
  status: "completed" | "failed";
}
