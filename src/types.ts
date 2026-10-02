export type ApiFormat = "openai" | "anthropic";

export interface KeyEntry {
  value: string;
  status: "active" | "exhausted" | "cooldown";
  failedAt?: string;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  keys: KeyEntry[];
  models: string[];
}

export interface AppConfig {
  id: string;
  name: string;
  configPath: string;
  configType: "json" | "toml";
  proxySetting: Record<string, string>;
}

export interface ProxyConfig {
  host: string;
  port: number;
  activeProviderId: string;
  apps: AppConfig[];
}

export interface RoutingDecision {
  provider: Provider;
  keyIndex: number;
  format: ApiFormat;
}
