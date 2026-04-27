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

export async function getUpdateInfo(): Promise<UpdateInfo> {
  const info = await window.electronAPI.getUpdateInfo();
  if (!info) throw new Error('no update info available');
  return info;
}

export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  return window.electronAPI.checkForUpdatesNow();
}

export async function setSkippedVersion(tag: string): Promise<void> {
  return window.electronAPI.setSkippedVersion(tag);
}
