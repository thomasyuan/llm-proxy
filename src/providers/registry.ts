import * as fs from "fs";
import * as path from "path";
import type { Provider, KeyEntry } from "../types.js";

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const DEGRADATION_THRESHOLD = 3;
const PROVIDER_COOLDOWN_MS = 30_000; // 30 seconds

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();
  private configDir: string;
  private filePath: string;
  private healthState: Map<string, { consecutiveFailures: number; degradedAt?: string }> = new Map();

  constructor(configDir?: string) {
    this.configDir = configDir ?? path.resolve(process.env.LLM_PROXY_HOME ?? "~/.llm-proxy");
    this.filePath = path.join(this.configDir, "providers.json");
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data: Provider[] = JSON.parse(raw);
      for (const p of data) {
        this.providers.set(p.id, p);
      }
    }
  }

  private save(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    const data = Array.from(this.providers.values());
    // Atomic write: write to temp file then rename
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  persist(): void {
    this.save();
  }

  add(provider: Provider): void {
    this.providers.set(provider.id, provider);
    this.save();
  }

  remove(id: string): void {
    this.providers.delete(id);
    this.save();
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  list(): Provider[] {
    return Array.from(this.values());
  }

  private values(): IterableIterator<Provider> {
    return this.providers.values();
  }

  /**
   * Find the next active key index, applying cooldown recovery.
   * Returns -1 if no active keys remain.
   */
  nextKeyIndex(providerId: string): number {
    const provider = this.get(providerId);
    if (!provider) return -1;

    for (let i = 0; i < provider.keys.length; i++) {
      const key = provider.keys[i];
      if (key.status === "active") return i;
      if (key.status === "cooldown" && this.isCooldownExpired(key)) {
        key.status = "active";
        delete key.failedAt;
        this.save();
        return i;
      }
    }
    return -1;
  }

  /**
   * Mark a key as exhausted after a failed request.
   */
  rotateKey(providerId: string, failedIndex: number): void {
    const provider = this.get(providerId);
    if (!provider) return;
    const key = provider.keys[failedIndex];
    key.status = "exhausted";
    key.failedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Check if all keys for a provider are exhausted.
   */
  allExhausted(providerId: string): boolean {
    const provider = this.get(providerId);
    if (!provider) return true;
    return provider.keys.every((k: KeyEntry) => k.status !== "active");
  }

  /**
   * Check if a provider's subscription token is expired.
   * Returns true if expired, false otherwise (including no subscription).
   */
  subscriptionExpired(providerId: string): boolean {
    const provider = this.get(providerId);
    if (!provider || !provider.subscription) return false;
    if (!provider.subscription.expiresAt) return false;
    return new Date(provider.subscription.expiresAt).getTime() < Date.now();
  }

  private isCooldownExpired(key: KeyEntry): boolean {
    if (!key.failedAt) return false;
    const failed = new Date(key.failedAt).getTime();
    return Date.now() - failed >= COOLDOWN_MS;
  }

  /**
   * Check if a provider is degraded (too many consecutive failures).
   */
  isDegraded(providerId: string): boolean {
    const state = this.healthState.get(providerId);
    if (!state || !state.degradedAt) return false;
    const degraded = new Date(state.degradedAt).getTime();
    return Date.now() - degraded < PROVIDER_COOLDOWN_MS;
  }

  /**
   * Record a failure for a provider. Marks degraded after threshold.
   */
  recordFailure(providerId: string): void {
    const state = this.healthState.get(providerId) ?? { consecutiveFailures: 0 };
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= DEGRADATION_THRESHOLD) {
      state.degradedAt = new Date().toISOString();
    }
    this.healthState.set(providerId, state);
  }

  /**
   * Reset health state after a successful request.
   */
  resetHealth(providerId: string): void {
    const state = this.healthState.get(providerId);
    if (state) {
      state.consecutiveFailures = 0;
      delete state.degradedAt;
      this.healthState.set(providerId, state);
    }
  }

  /**
   * Get the consecutive failure count for a provider.
   */
  getFailureCount(providerId: string): number {
    return this.healthState.get(providerId)?.consecutiveFailures ?? 0;
  }
}
