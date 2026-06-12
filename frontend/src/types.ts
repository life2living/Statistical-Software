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

export interface DistributionGroup {
  group: string;
  n: number;
  missing: number;
  mean: number;
  std: number;
  stderr: number;
  min: number;
  max: number;
  quantiles: {
    p0: number;
    p25: number;
    p50: number;
    p75: number;
    p100: number;
  };
}

export interface DistributionColumn {
  name: string;
  by: string | null;
  freq: string | null;
  weight: string | null;
  groups: DistributionGroup[];
}

export interface DistributionRun extends AnalysisRun {
  method: "distribution";
  outputs: {
    distribution: {
      columns: DistributionColumn[];
    };
  };
}

export interface TabulateRun extends AnalysisRun {
  method: "tabulate";
  outputs: {
    tabulate: {
      y_columns: string[];
      group_columns: string[];
      rows: Record<string, string | number | null>[];
    };
  };
}

export interface FitYByXRun extends AnalysisRun {
  method: "fit_y_by_x";
  outputs: {
    fit_y_by_x: {
      y: string;
      x: string;
      n: number;
      missing: number;
      correlation: { r: number; r2: number };
      coefficients: { intercept: number; slope: number };
      metrics: { r2: number; rmse: number; sse: number; df_error: number; mse: number };
      points: { x: number; y: number; rowIndex: number }[];
      fit_line: { x: number; y: number; lower: number; upper: number }[];
      residuals: { x: number; actual: number; predicted: number; residual: number }[];
    };
  };
}

export interface OnewayGroup {
  level: string;
  n: number;
  mean: number;
  std: number;
  stderr: number;
  lower95: number;
  upper95: number;
  min: number;
  max: number;
}

export interface OnewayRun extends AnalysisRun {
  method: "oneway_anova";
  outputs: {
    oneway_anova: {
      platform: "oneway";
      y: string;
      x: string;
      n: number;
      missing: number;
      levels: number;
      overall_mean: number;
      groups: OnewayGroup[];
      anova: {
        status: "ok" | "insufficient_levels";
        source: {
          term: string;
          df: number;
          sum_squares: number;
          mean_square: number | null;
          f_ratio: number | null;
          p_value: number | null;
        }[];
      };
      comparisons: {
        left: string;
        right: string;
        difference: number;
        stderr: number;
        q: number;
        p_value: number | null;
      }[];
      points: { x: string; y: number; rowIndex: number }[];
    };
  };
}

export interface MultivariateCell {
  x: string;
  y: string;
  r: number | null;
  p_value: number | null;
  n: number;
}

export interface MultivariateRun extends AnalysisRun {
  method: "multivariate";
  outputs: {
    multivariate: {
      columns: string[];
      matrix: MultivariateCell[][];
      covariance: (number | null)[][];
      summaries: {
        column: string;
        n: number;
        mean: number | null;
        std: number;
        missing: number;
      }[];
    };
  };
}

export interface ControlChartRun extends AnalysisRun {
  method: "control_chart";
  outputs: {
    control_chart: {
      chart_type: "imr" | "xbar_r" | "p" | "np" | "c" | "u";
      y: string;
      x: string | null;
      phase: string | null;
      sample_size?: string | null;
      n: number;
      missing: number;
      subgroup_count?: number;
      subgroup_size?: number;
      individuals?: {
        center: number;
        ucl: number;
        lcl: number;
        points: { rowIndex: number; label: string; phase: string; value: number; beyondLimits: boolean }[];
      };
      moving_range?: {
        center: number;
        ucl: number;
        lcl: number;
        points: { rowIndex: number; label: string; phase: string; value: number; beyondLimits: boolean }[];
      };
      xbar?: {
        center: number;
        ucl: number;
        lcl: number;
        points: { rowIndex: number; label: string; phase: string; value: number; subgroupSize: number; beyondLimits: boolean }[];
      };
      range?: {
        center: number;
        ucl: number;
        lcl: number;
        points: { rowIndex: number; label: string; phase: string; value: number; subgroupSize: number; beyondLimits: boolean }[];
      };
      attribute?: {
        center: number;
        points: { rowIndex: number; label: string; phase: string; value: number; count: number; sampleSize: number; ucl: number; lcl: number; beyondLimits: boolean }[];
      };
      violations: { chart: string; rule: string; rowIndex: number; label: string; value: number }[];
    };
  };
}

export interface ProcessCapabilityRun extends AnalysisRun {
  method: "process_capability";
  outputs: {
    process_capability: {
      column: string;
      lsl: number | null;
      target: number | null;
      usl: number | null;
      n: number;
      missing: number;
      mean: number;
      std: number;
      overall_std: number;
      cp: number;
      cpk: number;
      cpl: number;
      cpu: number;
      pp: number;
      ppk: number;
      ppl: number;
      ppu: number;
      observed: { below_lsl: number; above_usl: number; total_out: number; out_percent: number };
      spec_distance: { mean_to_lsl: number | null; usl_to_mean: number | null; mean_to_target: number | null };
    };
  };
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
  anova: Record<string, { source: string; df: number; sum_squares: number; mean_square: number | null; f_ratio: number | null; p_value: number | null }[]>;
  parameter_estimates: Record<string, { term: string; estimate: number; stderr: number; t_ratio: number | null; p_value: number | null }[]>;
  effect_tests: Record<string, { effect: string; df: number; sum_squares: number; f_ratio: number | null; p_value: number | null }[]>;
  effect_leverage: Record<string, { effect: string; estimate: number; sum_squares: number; f_ratio: number | null; p_value: number | null; leverage_score: number }[]>;
  lack_of_fit: Record<string, { status: "ok" | "not_estimable"; distinct_points: number; replicated_points: number; rows: { source: string; df: number; sum_squares: number; mean_square: number; f_ratio: number | null; p_value: number | null }[] }>;
  residuals: Record<string, { rowIndex: number; sourceRowIndex?: number; actual: number; predicted: number; residual: number; studentized: number; leverage: number; cook: number }[]>;
  information_criteria: Record<string, { aic: number; aicc: number; bic: number }>;
  prediction_formulas: Record<string, string>;
  profiler_effects: ProfilerEffect[];
  profiler: Record<string, Record<string, { x: number; y: number; lower95?: number; upper95?: number }[]>>;
  status: "completed" | "failed";
}
