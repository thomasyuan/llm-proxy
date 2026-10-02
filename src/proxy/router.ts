import * as http from "http";
import * as https from "https";
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

  async resolve(): Promise<RoutingDecision | null> {
    const provider: Provider | undefined = this.registry.get(this.activeProviderId);
    if (!provider) return null;

    if (provider.subscription && this.registry.subscriptionExpired(this.activeProviderId)) {
      const refreshed = await this.tryRefreshSubscription(provider);
      if (!refreshed) return null;
    }

    const keyIndex = this.registry.nextKeyIndex(this.activeProviderId);
    if (keyIndex === -1) return null;

    let authHeader: string;
    if (provider.subscription) {
      authHeader = `Bearer ${provider.subscription.token}`;
    } else {
      authHeader = `Bearer ${provider.keys[keyIndex].value}`;
    }

    return {
      provider,
      keyIndex,
      format: provider.apiFormat,
      authHeader,
    };
  }

  private async tryRefreshSubscription(provider: Provider): Promise<boolean> {
    const sub = provider.subscription;
    if (!sub || !sub.refreshToken || !sub.refreshUrl) return false;

    try {
      const result = await this.httpPost(sub.refreshUrl, {
        grant_type: "refresh_token",
        refresh_token: sub.refreshToken,
      });
      if (result.ok && result.token) {
        sub.token = result.token;
        if (result.expiresAt) {
          sub.expiresAt = result.expiresAt;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private httpPost(url: string, body: Record<string, string>): Promise<{ ok: boolean; token?: string; expiresAt?: string }> {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);

    return new Promise((resolve) => {
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              resolve({ ok: true, token: data.access_token ?? data.token, expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined });
            } catch {
              resolve({ ok: false });
            }
          } else {
            resolve({ ok: false });
          }
        });
      });
      req.on("error", () => resolve({ ok: false }));
      req.end(payload);
    });
  }

  handleFailure(failedKeyIndex: number): void {
    this.registry.rotateKey(this.activeProviderId, failedKeyIndex);
  }

  isExhausted(): boolean {
    return this.registry.allExhausted(this.activeProviderId);
  }
}
