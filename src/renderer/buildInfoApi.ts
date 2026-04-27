export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export async function getBuildInfo(): Promise<BuildInfo> {
  return window.electronAPI.getBuildInfo();
}
