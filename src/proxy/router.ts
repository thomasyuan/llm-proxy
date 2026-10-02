import type { Provider, RoutingDecision } from "../types.js";
import type { ProviderRegistry } from "../providers/registry.js";

export class Router {
  private registry: ProviderRegistry;
  private activeProviderId: string;

  constructor(registry: ProviderRegistry, activeProviderId: string) {
    this.registry = registry;
    this.activeProviderId = activeProviderId;
  }

  setProvider(id: string): void {
    this.activeProviderId = id;
  }

  resolve(): RoutingDecision | null {
    const provider: Provider | undefined = this.registry.get(this.activeProviderId);
    if (!provider) return null;

    const keyIndex = this.registry.nextKeyIndex(this.activeProviderId);
    if (keyIndex === -1) return null;

    return {
      provider,
      keyIndex,
      format: provider.apiFormat,
    };
  }

  handleFailure(failedKeyIndex: number): void {
    this.registry.rotateKey(this.activeProviderId, failedKeyIndex);
  }

  isExhausted(): boolean {
    return this.registry.allExhausted(this.activeProviderId);
  }
}
