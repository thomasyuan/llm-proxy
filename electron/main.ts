import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { ProviderRegistry } from "../src/providers/registry.js";

const MAIN_WINDOW_TITLE = "LLM Proxy";

let mainWindow: BrowserWindow | null = null;
let registry: ProviderRegistry | null = null;

ipcMain.handle("app:ping", () => "pong");

ipcMain.handle("providers:list", async () => {
  if (!registry) {
    registry = new ProviderRegistry();
  }
  return registry.list().map((p) => ({
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
