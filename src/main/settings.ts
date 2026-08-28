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
  hardwareAccelerationEnabled: boolean;
  startMinimizedToTray: boolean;
  downloadPromptEnabled: boolean;
  updateState: UpdateState;
}

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  soundEnabled: true,
  includePreview: false,
  autoUpdateCheckEnabled: true,
  hardwareAccelerationEnabled: true,
  startMinimizedToTray: false,
  downloadPromptEnabled: true,
  updateState: {
    lastCheckedAt: null,
    skippedVersion: null,
    consecutiveFailures: 0,
  },
};

export function shouldShowOnLaunch(settings: Settings): boolean {
  return !settings.startMinimizedToTray;
}

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
}

type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

function pickBoolean(
  raw: Record<string, unknown>,
  key: BooleanSettingKey,
  fallback: boolean,
): boolean {
  return typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback;
}

export function normalizeSettings(raw: unknown, base: Settings): Settings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const updateStateRaw =
    (obj.updateState && typeof obj.updateState === 'object'
      ? (obj.updateState as Record<string, unknown>)
      : {});

  return {
    notificationsEnabled: pickBoolean(obj, 'notificationsEnabled', base.notificationsEnabled),
    soundEnabled: pickBoolean(obj, 'soundEnabled', base.soundEnabled),
    includePreview: pickBoolean(obj, 'includePreview', base.includePreview),
    autoUpdateCheckEnabled: pickBoolean(obj, 'autoUpdateCheckEnabled', base.autoUpdateCheckEnabled),
    hardwareAccelerationEnabled: pickBoolean(
      obj,
      'hardwareAccelerationEnabled',
      base.hardwareAccelerationEnabled,
    ),
    startMinimizedToTray: pickBoolean(obj, 'startMinimizedToTray', base.startMinimizedToTray),
    downloadPromptEnabled: pickBoolean(obj, 'downloadPromptEnabled', base.downloadPromptEnabled),
    updateState: {
      lastCheckedAt:
        typeof updateStateRaw.lastCheckedAt === 'number'
          ? updateStateRaw.lastCheckedAt
          : base.updateState.lastCheckedAt,
      skippedVersion:
        typeof updateStateRaw.skippedVersion === 'string'
          ? updateStateRaw.skippedVersion
          : base.updateState.skippedVersion,
      consecutiveFailures:
        typeof updateStateRaw.consecutiveFailures === 'number'
          ? updateStateRaw.consecutiveFailures
          : base.updateState.consecutiveFailures,
    },
  };
}

export function loadSettings(path: string): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return defaultSettings();
    }
    console.error('settings: read failed, using defaults:', err);
    return defaultSettings();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('settings: corrupt file, using defaults:', err);
    return defaultSettings();
  }

  return normalizeSettings(parsed, DEFAULT_SETTINGS);
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
