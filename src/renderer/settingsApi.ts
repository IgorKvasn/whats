export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: unknown;
}

export async function getSettings(): Promise<Settings> {
  return window.electronAPI.getSettings();
}

export async function setSettings(s: Settings): Promise<void> {
  return window.electronAPI.setSettings(s);
}

export async function previewNotification(): Promise<void> {
  return window.electronAPI.previewNotification();
}

export async function previewSound(): Promise<void> {
  return window.electronAPI.previewSound();
}
