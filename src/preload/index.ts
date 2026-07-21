import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getBuildInfo: () => ipcRenderer.invoke('build-info:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  previewNotification: () => ipcRenderer.invoke('settings:preview-notification'),
  previewSound: () => ipcRenderer.invoke('settings:preview-sound'),
  getUpdateInfo: () => ipcRenderer.invoke('update:get-info'),
  checkForUpdatesNow: () => ipcRenderer.invoke('update:check-now'),
  setSkippedVersion: (version: string) => ipcRenderer.invoke('update:skip-version', version),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  closeWindow: () => ipcRenderer.send('window:close'),
  reconnectNow: () => ipcRenderer.send('reconnect:now'),
  onReconnectStatus: (listener: (status: string) => void) => {
    const handler = (_event: unknown, status: string) => listener(status);
    ipcRenderer.on('reconnect:status', handler);
    return () => ipcRenderer.removeListener('reconnect:status', handler);
  },
});
