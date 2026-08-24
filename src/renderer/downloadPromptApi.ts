import type { DownloadPromptInfo } from './electron';

export type { DownloadPromptInfo };

export async function getDownloadPromptInfo(id: string): Promise<DownloadPromptInfo> {
  const info = await window.electronAPI.getDownloadPromptInfo(id);
  if (!info) throw new Error('no download info available');
  return info;
}

export async function openDownload(id: string): Promise<void> {
  return window.electronAPI.openDownload(id);
}

export async function revealDownload(id: string): Promise<void> {
  return window.electronAPI.revealDownload(id);
}

export async function dismissDownload(id: string): Promise<void> {
  return window.electronAPI.dismissDownload(id);
}
