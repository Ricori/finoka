import type { CloudEntry } from "../bridge/cloud.ts";
import type { MediaEntry } from "../bridge/library.ts";
import type { TaskSnapshot } from "../providers/types.ts";

export type Section = "library" | "tasks" | "runtime" | "keys" | "adminKeys" | "account" | "editor";
export type NavigationSection = "library" | "tasks" | "runtime" | "settings" | "adminKeys";
export type ExecutionMode = "local" | "cloud";
export type LoadState = "loading" | "ready" | "error";
export type LibraryFilter = "all" | "ready" | "running" | "cloud" | "missing";
export type SortMode = "recent" | "name" | "duration";
export type ViewMode = "grid" | "list";
export type Theme = "dark" | "light";

export type DialogState =
  | { kind: "rename"; entry: MediaEntry; value: string }
  | { kind: "remove"; entry: MediaEntry; deleteDocument: boolean }
  | { kind: "cloud-remove"; entry: CloudEntry };

export type LibraryItem =
  | { kind: "local"; entry: MediaEntry }
  | { kind: "cloud"; entry: CloudEntry };

export interface TaskHistoryEntry {
  taskId: string;
  provider: ExecutionMode;
  mediaId: string;
  title: string;
  snapshot: TaskSnapshot;
}

export const activeStates = new Set(["queued", "running"]);
export const recoverableStates = new Set(["failed", "cancelled", "interrupted"]);
export const taskHistoryLimit = 50;
