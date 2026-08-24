import type { MediaEntry } from "../bridge/library.ts";
import type { TaskRequest } from "../providers/types.ts";

export function localTaskRequest(entry: MediaEntry): TaskRequest {
  return {
    schema: 1,
    provider: "local",
    source: {
      kind: "local_file",
      path: entry.sourcePath,
      title: entry.title,
      fingerprint: entry.fingerprint,
      video_id: entry.id,
      duration: entry.duration,
    },
    target: "raw-srt",
    language: "ja",
    device: "cuda",
    gpu_budget_gb: 8,
    correction: {
      enabled: false,
      media: "audio",
      retrieval: "none",
      difficulty: "intermediate",
      fast: "auto",
      extra_info: "",
      extra_style: "",
    },
    knowledge: "none",
    cleanup_intermediate: false,
  };
}

export function cloudTaskRequest(entry: MediaEntry): TaskRequest {
  return {
    schema: 1,
    provider: "cloud",
    source: {
      kind: "uploaded_audio",
      object_id: entry.id,
      title: entry.title,
      fingerprint: entry.fingerprint,
      duration: entry.duration,
    },
    target: "final-srt",
    language: "ja",
    device: "cuda",
    gpu_budget_gb: 8,
    correction: {
      enabled: true,
      media: "text",
      retrieval: "none",
      difficulty: "quality",
      fast: "auto",
      extra_info: "",
      extra_style: "",
    },
    knowledge: "none",
    cleanup_intermediate: false,
  };
}
