import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UpdateState {
  lastCheckedAt: number | null;
  skippedVersion: string | null;
  consecutiveFailures: number;
}

export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: UpdateState;
}

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  soundEnabled: true,
  includePreview: false,
  autoUpdateCheckEnabled: true,
  updateState: {
    lastCheckedAt: null,
    skippedVersion: null,
    consecutiveFailures: 0,
  },
};

export function loadSettings(path: string): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
    }
    console.error('settings: read failed, using defaults:', err);
    return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('settings: corrupt file, using defaults:', err);
    return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
  }

  const obj = parsed as Record<string, unknown>;
  const updateStateRaw = (obj.updateState as Record<string, unknown>) ?? {};

  return {
    notificationsEnabled:
      typeof obj.notificationsEnabled === 'boolean'
        ? obj.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    includePreview:
      typeof obj.includePreview === 'boolean'
        ? obj.includePreview
        : DEFAULT_SETTINGS.includePreview,
    autoUpdateCheckEnabled:
      typeof obj.autoUpdateCheckEnabled === 'boolean'
        ? obj.autoUpdateCheckEnabled
        : DEFAULT_SETTINGS.autoUpdateCheckEnabled,
    updateState: {
      lastCheckedAt:
        typeof updateStateRaw.lastCheckedAt === 'number'
          ? updateStateRaw.lastCheckedAt
          : DEFAULT_SETTINGS.updateState.lastCheckedAt,
      skippedVersion:
        typeof updateStateRaw.skippedVersion === 'string'
          ? updateStateRaw.skippedVersion
          : DEFAULT_SETTINGS.updateState.skippedVersion,
      consecutiveFailures:
        typeof updateStateRaw.consecutiveFailures === 'number'
          ? updateStateRaw.consecutiveFailures
          : DEFAULT_SETTINGS.updateState.consecutiveFailures,
    },
  };
}

export function saveSettings(path: string, settings: Settings): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = path + '.tmp';
  const json = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(tmp, json, 'utf-8');
  renameSync(tmp, path);
}
