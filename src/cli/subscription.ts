import * as fs from "fs";
import * as path from "path";
import type { Provider, Subscription } from "../types.js";
import { ProviderRegistry } from "../providers/registry.js";

interface AddOptions {
  provider: string;
  type: string;
  token: string;
  refreshToken?: string;
  refreshUrl?: string;
}

interface RemoveOptions {
  provider: string;
}

interface StatusOptions {
  provider: string;
}

export function subscriptionAdd(opts: AddOptions): void {
  const registry = new ProviderRegistry();
  const provider = registry.get(opts.provider);
  if (!provider) {
    console.error(`Provider "${opts.provider}" not found`);
    process.exit(1);
  }

  const subscription: Subscription = {
    type: opts.type as Subscription["type"],
    token: opts.token,
  };
  if (opts.refreshToken) subscription.refreshToken = opts.refreshToken;
  if (opts.refreshUrl) subscription.refreshUrl = opts.refreshUrl;

  provider.subscription = subscription;
  registry.persist();
  console.log(`Subscription added for provider "${opts.provider}"`);
}

export function subscriptionRemove(opts: RemoveOptions): void {
  const registry = new ProviderRegistry();
  const provider = registry.get(opts.provider);
  if (!provider) {
    console.error(`Provider "${opts.provider}" not found`);
    process.exit(1);
  }

  if (!provider.subscription) {
    console.log(`No subscription found for provider "${opts.provider}"`);
    return;
  }

  delete provider.subscription;
  registry.persist();
  console.log(`Subscription removed for provider "${opts.provider}"`);
}

export function subscriptionStatus(opts: StatusOptions): void {
  const registry = new ProviderRegistry();
  const provider = registry.get(opts.provider);
  if (!provider) {
    console.error(`Provider "${opts.provider}" not found`);
    process.exit(1);
  }

  if (!provider.subscription) {
    console.log(`No subscription for provider "${opts.provider}"`);
    return;
  }

  const sub = provider.subscription;
  const expired = sub.expiresAt ? new Date(sub.expiresAt).getTime() < Date.now() : false;
  console.log(JSON.stringify({
    provider: opts.provider,
    type: sub.type,
    token: sub.token.slice(0, 8) + "…",
    expiresAt: sub.expiresAt ?? "unknown",
    expired,
    hasRefreshToken: !!sub.refreshToken,
    hasRefreshUrl: !!sub.refreshUrl,
  }, null, 2));
}
