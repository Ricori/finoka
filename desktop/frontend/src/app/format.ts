import type { TaskSnapshot } from "../providers/types.ts";
import type { TaskHistoryEntry } from "./types.ts";
import { activeStates, taskHistoryLimit } from "./types.ts";

export function parseTaskHistory(value: unknown): TaskHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TaskHistoryEntry => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<TaskHistoryEntry>;
    return typeof record.taskId === "string"
      && (record.provider === "local" || record.provider === "cloud")
      && typeof record.mediaId === "string"
      && typeof record.title === "string"
      && typeof record.snapshot === "object";
  }).slice(0, taskHistoryLimit);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatDate(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(Date.parse(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function taskStateLabel(state: TaskSnapshot["state"]): string {
  return {
    queued: "排队中",
    running: "处理中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  }[state];
}

export function taskProgress(snapshot: TaskSnapshot): number {
  if (snapshot.state === "completed") return 100;
  if (!snapshot.progress?.total) return activeStates.has(snapshot.state) ? 8 : 0;
  return Math.min(100, Math.max(0, snapshot.progress.completed / snapshot.progress.total * 100));
}
