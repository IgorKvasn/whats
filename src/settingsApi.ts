import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  include_preview: boolean;
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
