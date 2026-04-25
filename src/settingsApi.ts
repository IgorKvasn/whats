import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  include_preview: boolean;
  auto_update_check_enabled: boolean;
  // update_state is internal Rust bookkeeping; round-tripped opaquely
  update_state: unknown;
}

export async function getSettings(): Promise<Settings> {
  return await invoke<Settings>('get_settings');
}

export async function setSettings(s: Settings): Promise<void> {
  await invoke('set_settings', { newSettings: s });
}

export async function previewNotification(): Promise<void> {
  await invoke('preview_notification');
}

export async function previewSound(): Promise<void> {
  await invoke('preview_sound');
}
