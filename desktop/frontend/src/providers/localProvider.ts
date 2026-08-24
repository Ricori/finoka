import type {
  ArtifactManifest,
  Capabilities,
  ExecutionProvider,
  TaskEventPage,
  TaskRequest,
  TaskListItem,
  TaskSnapshot,
} from "./types.ts";

// This is the renderer-visible surface generated from Go's provider.Service.
// It intentionally contains no base URL, arbitrary endpoint, or session token.
export interface LocalProviderBridge {
  Capabilities(): Promise<unknown>;
  ListTasks(): Promise<unknown>;
  StartTask(request: Record<string, unknown>): Promise<unknown>;
  TaskStatus(taskId: string): Promise<unknown>;
  TaskEvents(taskId: string, afterCursor: number): Promise<unknown>;
  CancelTask(taskId: string): Promise<unknown>;
  RetryTask(taskId: string): Promise<unknown>;
  ResumeTask(taskId: string): Promise<unknown>;
  TaskArtifacts(taskId: string): Promise<unknown>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function snapshot(value: unknown): TaskSnapshot {
  const body = object(value, "TaskSnapshot");
  if (body.schema !== 1 || typeof body.task_id !== "string" || body.provider !== "local") {
    throw new TypeError("Local Provider returned an incompatible TaskSnapshot");
  }
  return body as unknown as TaskSnapshot;
}

export class LocalExecutionProvider implements ExecutionProvider {
  private readonly bridge: LocalProviderBridge;

  constructor(bridge: LocalProviderBridge) {
    this.bridge = bridge;
  }

  async capabilities(): Promise<Capabilities> {
    const body = object(await this.bridge.Capabilities(), "Capabilities");
    if (body.provider !== "local" || body.adapter_schema !== 1 || body.artifact_schema !== 1) {
      throw new TypeError("Local Provider returned incompatible capabilities");
    }
    return body as unknown as Capabilities;
  }

  async listTasks(): Promise<TaskListItem[]> {
    const body = object(await this.bridge.ListTasks(), "TaskList");
    if (body.schema !== 1 || !Array.isArray(body.tasks)) throw new TypeError("Local Provider returned an incompatible task list");
    return body.tasks.map((value) => {
      const record = object(value, "TaskListItem");
      return {
        snapshot: snapshot(record.snapshot),
        media_id: typeof record.media_id === "string" ? record.media_id : "",
        title: typeof record.title === "string" ? record.title : "",
      };
    });
  }

  async start(request: TaskRequest): Promise<TaskSnapshot> {
    if (request.provider !== "local" || request.source.kind !== "local_file") {
      throw new TypeError("Local Provider requires a local_file TaskRequest");
    }
    return snapshot(await this.bridge.StartTask(request as unknown as Record<string, unknown>));
  }

  async status(taskId: string): Promise<TaskSnapshot> {
    return snapshot(await this.bridge.TaskStatus(taskId));
  }

  async events(taskId: string, afterCursor: number): Promise<TaskEventPage> {
    const body = object(await this.bridge.TaskEvents(taskId, afterCursor), "TaskEventPage");
    if (body.schema !== 1 || body.task_id !== taskId || !Array.isArray(body.events)) {
      throw new TypeError("Local Provider returned an incompatible event page");
    }
    return body as unknown as TaskEventPage;
  }

  async cancel(taskId: string): Promise<TaskSnapshot> {
    return snapshot(await this.bridge.CancelTask(taskId));
  }

  async retry(taskId: string): Promise<TaskSnapshot> {
    return snapshot(await this.bridge.RetryTask(taskId));
  }

  async resume(taskId: string): Promise<TaskSnapshot> {
    return snapshot(await this.bridge.ResumeTask(taskId));
  }

  async artifacts(taskId: string): Promise<ArtifactManifest> {
    const body = object(await this.bridge.TaskArtifacts(taskId), "ArtifactManifest");
    if (body.schema !== 1 || body.task_id !== taskId || typeof body.artifacts !== "object") {
      throw new TypeError("Local Provider returned an incompatible artifact manifest");
    }
    return body as unknown as ArtifactManifest;
  }
}
