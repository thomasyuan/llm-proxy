import * as fs from "fs";
import * as path from "path";
import type { Provider, KeyEntry } from "../types.js";

const CONFIG_DIR = path.resolve(process.env.LLM_PROXY_HOME ?? "~/.llm-proxy");
const PROVIDERS_FILE = path.join(CONFIG_DIR, "providers.json");

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    if (fs.existsSync(PROVIDERS_FILE)) {
      const raw = fs.readFileSync(PROVIDERS_FILE, "utf-8");
      const data: Provider[] = JSON.parse(raw);
      for (const p of data) {
        this.providers.set(p.id, p);
      }
    }
  }

  private save(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const data = Array.from(this.providers.values());
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2));
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
    return Array.from(this.providers.values());
  }

  setActive(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider not found: ${id}`);
    }
    this.save();
  }

  rotateKey(providerId: string, failedIndex: number): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;
    provider.keys[failedIndex].status = "exhausted";
    provider.keys[failedIndex].failedAt = new Date().toISOString();
    this.save();
  }

  nextKeyIndex(providerId: string): number {
    const provider = this.providers.get(providerId);
    if (!provider) return -1;
    for (let i = 0; i < provider.keys.length; i++) {
      if (provider.keys[i].status === "active") return i;
    }
    return -1;
  }

  allExhausted(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider) return true;
    return provider.keys.every((k: KeyEntry) => k.status !== "active");
  }
}
