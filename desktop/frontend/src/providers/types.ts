export type ProviderID = "local" | "cloud";
export type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type TaskEventType =
  | "started"
  | "stage"
  | "progress"
  | "warning"
  | "handoff"
  | "log"
  | "completed"
  | "failed"
  | "cancelled";

export interface EngineIdentity {
  name?: "finesub";
  version: string;
  commit: string;
  bundle_id?: string;
}

export interface Capabilities {
  provider: ProviderID;
  adapter_schema: 1;
  artifact_schema: 1;
  engine: EngineIdentity;
  features: {
    raw_srt: boolean;
    translation: boolean;
    video_multimodal: boolean;
    knowledge: boolean;
    resume: boolean;
    diarization: boolean;
  };
  devices: Array<{ id: string; name: string; memory_mb: number }>;
  runtime?: {
    ready: boolean;
    issues: Array<{ code: string; message: string }>;
    stages?: Array<{
      id: "media" | "raw-srt" | "final-srt" | "knowledge" | "video-multimodal";
      label: string;
      ready: boolean;
      issues: Array<{ code: string; message: string }>;
    }>;
    localAgent?: string;
  };
  settings?: { llm_key_configured: boolean };
}

export interface LocalSource {
  kind: "local_file";
  path: string;
  title: string;
  fingerprint?: string;
  video_id?: string;
  duration?: number;
}

export interface CloudSource {
  kind: "uploaded_audio";
  object_id: string;
  title: string;
  fingerprint?: string;
  duration?: number;
}

/** 用户导入的已有产物；解析与判型见 subtitles/assAxis.ts。 */
export interface TaskAxis {
  kind: "empty" | "ja" | "zh" | "bi";
  filename: string;
  rows: Array<{ t0: number; t1: number; ja: string; zh: string; spk: string }>;
}

export interface TaskRequest {
  schema: 1;
  provider: ProviderID;
  source: LocalSource | CloudSource;
  target: "raw-srt" | "final-srt";
  language: string;
  device: string;
  gpu_budget_gb: 4 | 8 | 12 | 16;
  vocal_profile: "cost" | "quality";
  correction: {
    enabled: boolean;
    media: "text" | "audio" | "video";
    retrieval: "none" | "local" | "native";
    difficulty: "efficiency" | "intermediate" | "quality";
    fast: "auto" | "on" | "off";
    extra_info: string;
    extra_style: string;
  };
  knowledge: "none" | "collect" | "update";
  cleanup_intermediate: boolean;
  /** 只在日文轴上出现：worker 据它跳过识别，直接补译文。其余轴型不进任务请求 */
  axis?: TaskAxis;
}

export interface TaskProgress {
  completed: number;
  total: number | null;
  unit: string;
  message: string;
}

export interface TaskError {
  code: string;
  message: string;
}

export interface TaskSnapshot {
  schema: 1;
  task_id: string;
  provider: ProviderID;
  state: TaskState;
  stage: string;
  progress: TaskProgress | null;
  engine: Pick<EngineIdentity, "version" | "commit">;
  requested_capabilities: Record<string, unknown>;
  effective_capabilities: Record<string, unknown>;
  error: TaskError | null;
  last_cursor: number;
  created_at: string;
  updated_at: string;
}

export interface TaskListItem {
  snapshot: TaskSnapshot;
  media_id: string;
  title: string;
}

export interface TaskEvent {
  cursor: number;
  task_id: string;
  type: TaskEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TaskEventPage {
  schema: 1;
  task_id: string;
  events: TaskEvent[];
  next_cursor: number;
  state: TaskState;
}

export interface ArtifactEntry {
  uri: string;
  sha256: string;
  bytes: number;
}

export interface ArtifactManifest {
  schema: 1;
  task_id: string;
  engine_commit: string;
  artifacts: Partial<Record<"stable_json" | "raw_srt" | "annotated_csv" | "final_srt", ArtifactEntry>>;
}

export interface ExecutionProvider {
  capabilities(): Promise<Capabilities>;
  listTasks(): Promise<TaskListItem[]>;
  start(request: TaskRequest): Promise<TaskSnapshot>;
  status(taskId: string): Promise<TaskSnapshot>;
  events(taskId: string, afterCursor: number): Promise<TaskEventPage>;
  cancel(taskId: string): Promise<TaskSnapshot>;
  retry(taskId: string): Promise<TaskSnapshot>;
  resume(taskId: string): Promise<TaskSnapshot>;
  artifacts(taskId: string): Promise<ArtifactManifest>;
}
