import * as fs from "fs";
import type { AppConfig } from "../types.js";

export interface ProxySetting {
  url: string;
  apiKey: string;
}

export function writeAppConfig(app: AppConfig, setting: ProxySetting): void {
  if (!fs.existsSync(app.configPath)) {
    throw new Error(`Config file not found: ${app.configPath}`);
  }

  const content = fs.readFileSync(app.configPath, "utf-8");

  if (app.configType === "json") {
    writeJson(app, content, setting);
  } else if (app.configType === "toml") {
    writeToml(app, content, setting);
  } else {
    throw new Error(`Unsupported config type: ${app.configType}`);
  }
}

function writeJson(app: AppConfig, content: string, setting: ProxySetting): void {
  const data = JSON.parse(content);
  for (const [key, value] of Object.entries(app.proxySetting)) {
    setNested(data, key, value === "__PROXY_URL__" ? setting.url : value === "__PROXY_KEY__" ? setting.apiKey : value);
  }
  const dir = app.configPath.slice(0, app.configPath.lastIndexOf("/"));
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(app.configPath, JSON.stringify(data, null, 2) + "\n");
}

function setNested(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  current[last] = value;
}

function writeToml(app: AppConfig, content: string, setting: ProxySetting): void {
  const lines = content.split("\n");
  const result: string[] = [];
  let inProxySection = false;

  for (const line of lines) {
    if (line.trim().startsWith("[proxy]") || line.trim().startsWith("[model_providers.proxy")) {
      inProxySection = true;
      continue;
    }
    if (inProxySection && line.trim() === "") {
      inProxySection = false;
      continue;
    }
    if (!inProxySection) {
      result.push(line);
    }
  }

  const sectionLines: string[] = ["[proxy]"];
  for (const [key, value] of Object.entries(app.proxySetting)) {
    const resolved = resolveValue(value, setting);
    sectionLines.push(`${key} = ${tomlValue(resolved)}`);
  }

  const final = result.join("\n").trimEnd() + "\n\n" + sectionLines.join("\n") + "\n";
  fs.writeFileSync(app.configPath, final);
}

function resolveValue(value: string, setting: ProxySetting): string {
  if (value === "__PROXY_URL__") return setting.url;
  if (value === "__PROXY_KEY__") return setting.apiKey;
  return value;
}

function tomlValue(v: string): string {
  if (/^[a-z0-9_]+$/.test(v)) return v;
  return `"${v}"`;
}
