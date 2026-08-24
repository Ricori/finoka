import * as ProviderService from "../../bindings/github.com/Ricori/finoka/desktop/internal/provider/service.js";

export interface RuntimeItem {
  id: string;
  version?: string;
  state: "missing" | "downloading" | "outdated" | "ready" | "failed";
  detail?: string;
}

export interface RuntimeProvisionState {
  schema: 1;
  platform: string;
  supported: boolean;
  runtime_supported: boolean;
  media_supported: boolean;
  media_ready: boolean;
  root: string;
  runtime: RuntimeItem;
  resources: RuntimeItem[];
  models: RuntimeItem[];
  job: {
    state: "idle" | "running" | "completed" | "failed";
    target: string;
    resource: string;
    stage: string;
    message: string;
    progress: { completed: number; total: number; unit: string; bytes_per_second?: number } | null;
    error: { code: string; message: string } | null;
  };
}

export const fineSubRuntime = {
  status: () => ProviderService.RuntimeProvisionStatus() as Promise<unknown> as Promise<RuntimeProvisionState>,
  install: (target: "media" | "runtime" | "models" | "all") => ProviderService.InstallRuntime(target) as Promise<unknown> as Promise<RuntimeProvisionState>,
};
