import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";

const MAIN_WINDOW_TITLE = "LLM Proxy";

let mainWindow: BrowserWindow | null = null;
let activeProviderId: string = "default";
const requestLog: Array<{ timestamp: string; provider: string; model: string; status: number; latencyMs: number }> = [];

// Default providers - user just needs to add a key/token to activate
const DEFAULT_PROVIDERS = [
  { id: "local", name: "Local LLM (Ollama)", baseUrl: "http://localhost:11434/v1", apiFormat: "openai", models: ["*"], keys: [], subscription: null },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", models: ["*"], keys: [], subscription: null },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiFormat: "openai", models: ["*"], keys: [], subscription: null },
  { id: "copilot", name: "GitHub Copilot", baseUrl: "https://api.copilot.github.com/v2", apiFormat: "openai", models: ["*"], keys: [], subscription: { type: "github_copilot", token: "" } },
];

// Supported apps with their config paths
const SUPPORTED_APPS = [
  { id: "codex", name: "Codex", configPath: path.join(process.env.HOME ?? "", ".codex", "config.toml"), configType: "toml" },
  { id: "claude-code", name: "Claude Code", configPath: path.join(process.env.HOME ?? "", ".claude", "settings.json"), configType: "json" },
  { id: "claude-desktop", name: "Claude Desktop", configPath: path.join(process.env.HOME ?? "", ".config", "claude-desktop", "settings.json"), configType: "json" },
  { id: "opencode", name: "OpenCode", configPath: path.join(process.env.HOME ?? "", ".opencode", "config.json"), configType: "json" },
  { id: "cursor", name: "Cursor", configPath: path.join(process.env.HOME ?? "", ".cursor", "cli-config.json"), configType: "json" },
  { id: "copilot", name: "Copilot", configPath: path.join(process.env.HOME ?? "", ".copilot", "settings.json"), configType: "json" },
  { id: "pi", name: "Pi", configPath: path.join(process.env.HOME ?? "", ".pi", "config.json"), configType: "json" },
];

function loadProviders(): Array<Record<string, unknown>> {
  const configDir = path.join(require("os").homedir(), ".llm-proxy");
  const filePath = path.join(configDir, "providers.json");
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveProviders(providers: Array<Record<string, unknown>>): void {
  const configDir = path.join(require("os").homedir(), ".llm-proxy");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, "providers.json");
  fs.writeFileSync(filePath, JSON.stringify(providers, null, 2));
}

function ensureDefaults(): Array<Record<string, unknown>> {
  let providers = loadProviders();
  if (providers.length === 0) {
    for (const d of DEFAULT_PROVIDERS) {
      providers.push({ ...d });
    }
    saveProviders(providers);
  }
  return providers;
}

ipcMain.handle("app:ping", () => "pong");

ipcMain.handle("providers:list", async () => {
  const providers = ensureDefaults();
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat,
    models: p.models,
    keys: (p.keys as Array<{ value: string; status: string }>).map((k) => ({ status: k.status, valueMasked: k.value ? k.value.slice(0, 4) + "…" : "" })),
    subscription: p.subscription
      ? { type: (p.subscription as Record<string, unknown>).type, tokenMasked: ((p.subscription as Record<string, unknown>).token as string).slice(0, 8) + "…", expiresAt: (p.subscription as Record<string, unknown>).expiresAt ?? null }
      : null,
  }));
});

ipcMain.handle("providers:update", async (_event: Electron.IpcMainInvokeEvent, id: string, updates: Record<string, unknown>) => {
  const providers = ensureDefaults();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return { ok: false, error: `Provider not found: ${id}` };
  // Merge updates into the provider
  if (updates.baseUrl) {
    providers[idx].baseUrl = updates.baseUrl as string;
  }
  if (updates.keys) {
    providers[idx].keys = updates.keys as Array<{ value: string; status: string }>;
  }
  if (updates.subscription) {
    providers[idx].subscription = updates.subscription as Record<string, unknown>;
  }
  saveProviders(providers);
  return { ok: true };
});

ipcMain.handle("providers:add", async (_event: Electron.IpcMainInvokeEvent, providerData: Record<string, unknown>) => {
  const providers = ensureDefaults();
  providers.push(providerData);
  saveProviders(providers);
  return { ok: true };
});

ipcMain.handle("providers:remove", async (_event: Electron.IpcMainInvokeEvent, id: string) => {
  const providers = ensureDefaults();
  const filtered = providers.filter((p) => p.id !== id);
  saveProviders(filtered);
  return { ok: true };
});

ipcMain.handle("providers:setActive", async (_event: Electron.IpcMainInvokeEvent, id: string) => {
  activeProviderId = id;
  return { ok: true, activeProviderId };
});

ipcMain.handle("apps:list", async () => {
  return SUPPORTED_APPS.map((a) => ({
    id: a.id,
    name: a.name,
    configPath: a.configPath,
    configExists: fs.existsSync(a.configPath),
  }));
});

ipcMain.handle("apps:setProvider", async (_event: Electron.IpcMainInvokeEvent, appId: string, providerId: string) => {
  const app = SUPPORTED_APPS.find((a) => a.id === appId);
  if (!app) return { ok: false, error: `Unknown app: ${appId}` };

  const providers = ensureDefaults();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };

  try {
    if (app.configType === "toml") {
      writeTomlConfig(app.configPath, provider);
    } else {
      writeJsonConfig(app.configPath, provider);
    }
    return { ok: true, app: app.name, provider: provider.name };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

function writeTomlConfig(configPath: string, provider: Record<string, unknown>): void {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, "utf-8");
  const lines = content.split("\n");
  const result: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim().startsWith("[model_providers.proxy")) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim() === "") {
      inSection = false;
      continue;
    }
    if (!inSection) result.push(line);
  }
  const withProvider = setTomlModelProvider(result.join("\n"), "proxy");
  const section = `[model_providers.proxy]\n` +
    `name = "proxy"\n` +
    `base_url = "${provider.baseUrl}"\n` +
    `wire_api = "responses"\n` +
    `requires_openai_auth = false\n` +
    `experimental_bearer_token = "${(provider.keys as Array<{ value: string }>)[0]?.value ?? ""}"`;
  const final = withProvider.trimEnd() + "\n\n" + section + "\n";
  fs.writeFileSync(configPath, final);
}

function setTomlModelProvider(content: string, provider: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let found = false;
  for (const line of lines) {
    if (line.startsWith("model_provider")) {
      result.push(`model_provider = "${provider}"`);
      found = true;
    } else {
      result.push(line);
    }
  }
  if (!found) result.unshift(`model_provider = "${provider}"`);
  return result.join("\n");
}

function writeJsonConfig(configPath: string, provider: Record<string, unknown>): void {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  data.proxy = {
    baseUrl: provider.baseUrl,
    apiKey: (provider.keys as Array<{ value: string }>)[0]?.value ?? "",
  };
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n");
}

ipcMain.handle("logs:get", async () => {
  return [...requestLog];
});

ipcMain.handle("logs:clear", async () => {
  requestLog.length = 0;
  return { ok: true };
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: MAIN_WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
