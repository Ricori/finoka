import type {
  ArtifactManifest,
  ExecutionProvider,
  TaskEvent,
  TaskRequest,
  TaskSnapshot,
} from "../providers/types.ts";

export interface PipelineState {
  snapshot: TaskSnapshot | null;
  events: TaskEvent[];
  artifacts: ArtifactManifest | null;
  error: Error | null;
}

type Listener = (state: Readonly<PipelineState>) => void;

// No login state, upload state, global task key, or backend URL lives here.
// All task behavior comes from the selected provider's capabilities/contract.
export class PipelineController {
  private state: PipelineState = { snapshot: null, events: [], artifacts: null, error: null };
  private listeners = new Set<Listener>();
  private generation = 0;
  private refreshInFlight: Promise<Readonly<PipelineState>> | null = null;

  private readonly provider: ExecutionProvider;

  constructor(provider: ExecutionProvider) {
    this.provider = provider;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  current(): Readonly<PipelineState> {
    return this.state;
  }

  async start(request: TaskRequest): Promise<TaskSnapshot> {
    const capabilities = await this.provider.capabilities();
    if (!capabilities.runtime?.ready) {
      const issue = capabilities.runtime?.issues[0];
      throw new Error(issue?.message ?? "Selected provider runtime is not ready");
    }
    if (request.correction.media === "video" && !capabilities.features.video_multimodal) {
      throw new Error("Selected provider does not support video multimodal correction");
    }
    const snapshot = await this.provider.start(request);
    this.generation += 1;
    this.set({ snapshot, events: [], artifacts: null, error: null });
    return snapshot;
  }

  async refresh(): Promise<Readonly<PipelineState>> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refresh = this.performRefresh();
    this.refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    }
  }

  private async performRefresh(): Promise<Readonly<PipelineState>> {
    const taskId = this.state.snapshot?.task_id;
    if (!taskId) return this.state;
    const run = this.generation;
    try {
      const [snapshot, page] = await Promise.all([
        this.provider.status(taskId),
        this.provider.events(taskId, this.state.events.at(-1)?.cursor ?? 0),
      ]);
      if (run !== this.generation) return this.state;
      const byCursor = new Map(this.state.events.map((event) => [event.cursor, event]));
      for (const event of page.events) byCursor.set(event.cursor, event);
      const events = [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
      let artifacts = this.state.artifacts;
      if (snapshot.state === "completed" && artifacts === null) {
        artifacts = await this.provider.artifacts(taskId);
      }
      this.set({ snapshot, events, artifacts, error: null });
    } catch (value) {
      const error = value instanceof Error ? value : new Error(String(value));
      this.set({ ...this.state, error });
    }
    return this.state;
  }

  async cancel(): Promise<TaskSnapshot | null> {
    const taskId = this.state.snapshot?.task_id;
    if (!taskId) return null;
    const snapshot = await this.provider.cancel(taskId);
    this.set({ ...this.state, snapshot });
    return snapshot;
  }

  async resume(): Promise<TaskSnapshot | null> {
    const taskId = this.state.snapshot?.task_id;
    if (!taskId) return null;
    const snapshot = await this.provider.resume(taskId);
    this.generation += 1;
    this.set({ ...this.state, snapshot, error: null });
    return snapshot;
  }

  private set(state: PipelineState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
