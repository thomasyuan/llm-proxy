import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { ProviderRegistry } from "../src/providers/registry.js";

const MAIN_WINDOW_TITLE = "LLM Proxy";

let mainWindow: BrowserWindow | null = null;
let registry: ProviderRegistry | null = null;
let activeProviderId: string = "default";
const requestLog: Array<{ timestamp: string; provider: string; model: string; status: number; latencyMs: number }> = [];

ipcMain.handle("app:ping", () => "pong");

function getRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry();
  }
  return registry;
}

ipcMain.handle("providers:list", async () => {
  const reg = getRegistry();
  return reg.list().map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat,
    keys: p.keys.map((k) => ({ status: k.status })),
    subscription: p.subscription
      ? { type: p.subscription.type, tokenMasked: p.subscription.token.slice(0, 8) + "…", expiresAt: p.subscription.expiresAt ?? null }
      : null,
  }));
});

ipcMain.handle("providers:add", async (_event, providerData) => {
  const reg = getRegistry();
  reg.add(providerData);
  return { ok: true };
});

ipcMain.handle("providers:remove", async (_event, id) => {
  const reg = getRegistry();
  reg.remove(id);
  return { ok: true };
});

ipcMain.handle("providers:setActive", async (_event, id) => {
  activeProviderId = id;
  return { ok: true, activeProviderId };
});

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

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
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
