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
});
