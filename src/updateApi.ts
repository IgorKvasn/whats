import { invoke } from '@tauri-apps/api/core';

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  release_name: string;
  released_at: string;
  body_excerpt: string;
  html_url: string;
}

export type ManualCheckResult =
  | { status: 'update_available' }
  | { status: 'up_to_date'; current: string }
  | { status: 'failed'; error: string };

export async function getUpdateInfo(): Promise<UpdateInfo> {
  return await invoke<UpdateInfo>('get_update_info');
}

export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  return await invoke<ManualCheckResult>('check_for_updates_now');
}

export async function setSkippedVersion(tag: string): Promise<void> {
  await invoke('set_skipped_version', { tag });
}
