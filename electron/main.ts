import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";

const MAIN_WINDOW_TITLE = "LLM Proxy";

let mainWindow: BrowserWindow | null = null;

ipcMain.handle("app:ping", () => "pong");

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
