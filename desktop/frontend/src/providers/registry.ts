import type { ExecutionProvider, ProviderID } from "./types.ts";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderID, ExecutionProvider>();

  register(id: ProviderID, provider: ExecutionProvider): void {
    if (this.providers.has(id)) throw new Error(`provider ${id} is already registered`);
    this.providers.set(id, provider);
  }

  get(id: ProviderID): ExecutionProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`provider ${id} is not available`);
    return provider;
  }

  has(id: ProviderID): boolean {
    return this.providers.has(id);
  }
}
