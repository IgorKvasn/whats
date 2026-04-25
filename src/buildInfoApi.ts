import { invoke } from '@tauri-apps/api/core';

export interface BuildInfo {
  version: string;
  build_timestamp: string;
}

export async function getBuildInfo(): Promise<BuildInfo> {
  return await invoke<BuildInfo>('get_build_info');
}
