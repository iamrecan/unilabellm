import axios from 'axios'

const api = axios.create({ baseURL: '/' })

export interface DatasetSource {
  path: string
  name: string
  format: string
  classes: string[]
  image_count: number
  label_count: number
}

export interface CanonicalClass {
  id: number
  name: string
  aliases: string[]
  source_map: Record<string, string[]>
  confidence: number
}

export interface HarmonizationSession {
  id: string
  sources: DatasetSource[]
  canonical_classes: CanonicalClass[]
  status: 'pending' | 'reviewing' | 'confirmed' | 'exported'
  created_at: string
  updated_at: string
}

export interface ExportSummary {
  session_id: string
  output_path: string
  total_images: number
  split_counts: Record<string, number>
  class_counts: Record<string, number>
  duplicate_count: number
}

export interface ExportStatus {
  status: 'running' | 'done' | 'failed'
  phase?: string
  done?: number
  total?: number
  summary?: ExportSummary
  error?: string
}

export interface AnnotationBox {
  class_name: string
  class_id: number
  cx: number
  cy: number
  w: number
  h: number
  confidence?: number   // present in inference results
}

export interface InferenceResult {
  image_path:    string
  predictions:   AnnotationBox[]
  model_classes: string[]
  inference_ms:  number
}

export interface BatchResult {
  results:       InferenceResult[]
  model_classes: string[]
  total_ms:      number
}

export interface ImageSample {
  image_path: string
  source_name: string
  annotations: AnnotationBox[]
}

export const sessionsApi = {
  list: () => api.get<HarmonizationSession[]>('/sessions').then(r => r.data),
  get: (id: string) => api.get<HarmonizationSession>(`/sessions/${id}`).then(r => r.data),
  create: (body: { source_paths: string[]; source_names?: string[]; domain_hint?: string }) =>
    api.post<HarmonizationSession>('/sessions', body).then(r => r.data),
  updateClasses: (id: string, canonical_classes: CanonicalClass[]) =>
    api.patch<HarmonizationSession>(`/sessions/${id}/classes`, { canonical_classes }).then(r => r.data),
  confirm: (id: string) =>
    api.post<HarmonizationSession>(`/sessions/${id}/confirm`).then(r => r.data),
  addSource: (id: string, source_paths: string[], source_names?: string[]) =>
    api.post<HarmonizationSession>(`/sessions/${id}/sources`, { source_paths, source_names }).then(r => r.data),
  delete: (id: string) => api.delete(`/sessions/${id}`),
  export: (id: string, output_path: string, split_ratio: [number,number,number] = [0.7,0.2,0.1]) =>
    api.post<{ status: string; session_id: string }>(`/sessions/${id}/export`, { output_path, split_ratio }).then(r => r.data),
  exportStatus: (id: string) =>
    api.get<ExportStatus>(`/sessions/${id}/export/status`).then(r => r.data),
  samples: (id: string, per_source = 8) =>
    api.get<ImageSample[]>(`/sessions/${id}/samples`, { params: { per_source } }).then(r => r.data),
  packageZip: (id: string, output_path: string) =>
    api.post<{ zip_path: string; size_mb: number }>(`/sessions/${id}/package-zip`, { output_path }).then(r => r.data),
  saveAnnotations: (id: string, image_path: string, annotations: AnnotationBox[]) =>
    api.post<HarmonizationSession>(`/sessions/${id}/annotations`, { image_path, annotations }).then(r => r.data),
  clearAnnotations: (id: string, image_path: string) =>
    api.delete<HarmonizationSession>(`/sessions/${id}/annotations`, { params: { image_path } }).then(r => r.data),
}

export const inferenceApi = {
  predict: (model_path: string, image_path: string, conf = 0.25, iou = 0.45) =>
    api.post<InferenceResult>('/inference', { model_path, image_path, conf, iou }).then(r => r.data),
  batch: (model_path: string, image_dir: string, conf = 0.25, iou = 0.45, max_images = 20) =>
    api.post<BatchResult>('/inference/batch', { model_path, image_dir, conf, iou, max_images }).then(r => r.data),
}

export const sourcesApi = {
  scan: (path: string, name?: string) =>
    api.post<DatasetSource>('/sources/scan', { path, name }).then(r => r.data),
}

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
  is_dataset: boolean
}

export interface BrowseResponse {
  path: string
  parent: string | null
  entries: DirEntry[]
}

export const filesystemApi = {
  pickFolder: (initialPath?: string) =>
    api.post<{ path: string | null; available: boolean }>(
      '/filesystem/pick-folder',
      null,
      { params: initialPath ? { initial_path: initialPath } : {} }
    ).then(r => r.data),

  browse: (path?: string) =>
    api.get<BrowseResponse>('/filesystem/browse', {
      params: path ? { path } : {},
    }).then(r => r.data),
}
