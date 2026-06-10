import type { AnalysisRun, ChartSpec, Dataset, DatasetPreview, DistributionRun, FitModelRun, ModelRun } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export function listDatasets(): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets");
}

export function previewDataset(datasetId: string): Promise<DatasetPreview> {
  return request<DatasetPreview>(`/datasets/${datasetId}/preview?limit=240`);
}

export async function importDataset(file: File): Promise<DatasetPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("project_id", "prj_demo");

  const response = await fetch(`${API_BASE}/datasets/import`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<DatasetPreview>;
}

export function saveChart(spec: ChartSpec): Promise<ChartSpec & { id: string }> {
  return request<ChartSpec & { id: string }>("/charts", {
    method: "POST",
    body: JSON.stringify(spec)
  });
}

export function runDescriptive(datasetId: string, columns: string[]): Promise<AnalysisRun> {
  return request<AnalysisRun>("/analysis/run", {
    method: "POST",
    body: JSON.stringify({ dataset_id: datasetId, method: "descriptive", columns })
  });
}

export function runDistribution(
  datasetId: string,
  columns: string[],
  roles: { by?: string | null; freq?: string | null; weight?: string | null }
): Promise<DistributionRun> {
  return request<DistributionRun>("/analysis/run", {
    method: "POST",
    body: JSON.stringify({
      dataset_id: datasetId,
      method: "distribution",
      columns,
      parameters: roles
    })
  });
}

export function runSpc(datasetId: string, column: string): Promise<AnalysisRun> {
  return request<AnalysisRun>("/analysis/run", {
    method: "POST",
    body: JSON.stringify({ dataset_id: datasetId, method: "spc", columns: [column] })
  });
}

export function runLinearModel(datasetId: string, target: string, feature: string): Promise<ModelRun> {
  return request<ModelRun>("/models/run", {
    method: "POST",
    body: JSON.stringify({
      dataset_id: datasetId,
      model_type: "linear_regression",
      target,
      features: [feature]
    })
  });
}

export function runFitModel(datasetId: string, responses: string[], effects: string[], includeQuadratic: boolean): Promise<FitModelRun> {
  return request<FitModelRun>("/fit-model/run", {
    method: "POST",
    body: JSON.stringify({
      dataset_id: datasetId,
      model_type: "standard_least_squares",
      responses,
      effects,
      include_quadratic: includeQuadratic
    })
  });
}
