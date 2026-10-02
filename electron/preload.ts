import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld({
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args));
    },
  },
});
