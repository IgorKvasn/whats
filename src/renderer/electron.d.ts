export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: unknown;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releasedAt: string;
  bodyExcerpt: string;
  htmlUrl: string;
}

export type ManualCheckResult =
  | { status: 'update_available' }
  | { status: 'up_to_date'; current: string }
  | { status: 'failed'; error: string };

interface ElectronAPI {
  getBuildInfo(): Promise<BuildInfo>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  previewNotification(): Promise<void>;
  previewSound(): Promise<void>;
  getUpdateInfo(): Promise<UpdateInfo | null>;
  checkForUpdatesNow(): Promise<ManualCheckResult>;
  setSkippedVersion(version: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  closeWindow(): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
