import { Service as ProviderService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/provider/index.js";

export interface FineSubKeyState {
  name: string;
  label: string;
  purpose: string;
  configured: boolean;
  count: number;
  masked: Array<{ name: string; value: string }>;
  storage: "missing" | "protected" | "plaintext" | "unreadable";
}

export interface FineSubSettingsState {
  schema: 1;
  keys: FineSubKeyState[];
  baseUrls: FineSubBaseUrlState[];
  modelRouting: FineSubModelRoutingState;
  llmKeyConfigured: boolean;
  retrievalKeyConfigured: boolean;
  protection: "empty" | "protected" | "plaintext" | "unreadable";
}

export type FineSubModelProviderID = "gemini-free" | "gemini-paid" | "openai" | "anthropic";

export interface FineSubModelOption {
  id: string;
  label: string;
  supportsAudio: boolean;
  supportsVideo: boolean;
}

export interface FineSubModelRoute {
  provider: FineSubModelProviderID | "";
  model: string;
}

export interface FineSubModelProvider {
  id: FineSubModelProviderID;
  label: string;
  mode: "select" | "input";
  models: FineSubModelOption[];
}

export interface FineSubModelRoutingState {
  providers: FineSubModelProvider[];
  defaultRoute: FineSubModelRoute;
  taskRoutes: Array<{ id: string; label: string; route: FineSubModelRoute }>;
}

export interface FineSubBaseUrlState {
  name: string;
  label: string;
  defaultValue: string;
  value: string;
  customized: boolean;
}

export const fineSubSettings = {
  read: () => ProviderService.Settings() as Promise<unknown> as Promise<FineSubSettingsState>,
  saveKeys: (keys: Record<string, string | null>) =>
    ProviderService.SaveKeys(keys) as Promise<unknown> as Promise<FineSubSettingsState>,
};
