declare const __BUILD_TIMESTAMP__: string;

export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export function buildTimestampText(timestamp: string): string {
  return timestamp.trim();
}

export function currentBuildInfo(version: string): BuildInfo {
  return {
    version,
    buildTimestamp: buildTimestampText(
      typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : '',
    ),
  };
}
