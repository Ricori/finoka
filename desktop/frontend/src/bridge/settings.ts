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
  llmKeyConfigured: boolean;
  retrievalKeyConfigured: boolean;
  protection: "empty" | "protected" | "plaintext" | "unreadable";
}

export const fineSubSettings = {
  read: () => ProviderService.Settings() as Promise<unknown> as Promise<FineSubSettingsState>,
  saveKeys: (keys: Record<string, string | null>) =>
    ProviderService.SaveKeys(keys) as Promise<unknown> as Promise<FineSubSettingsState>,
};
