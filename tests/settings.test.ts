import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../src/main/settings';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'whats-settings-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('settings', () => {
  it('returns defaults when file is missing', () => {
    const path = join(testDir, 'settings.json');
    const s = loadSettings(path);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings through save and load', () => {
    const path = join(testDir, 'settings.json');
    const custom: Settings = {
      notificationsEnabled: false,
      soundEnabled: false,
      includePreview: true,
      autoUpdateCheckEnabled: true,
      updateState: {
        lastCheckedAt: null,
        skippedVersion: null,
        consecutiveFailures: 0,
      },
    };
    saveSettings(path, custom);
    const loaded = loadSettings(path);
    expect(loaded).toEqual(custom);
  });

  it('returns defaults on corrupt JSON', () => {
    const path = join(testDir, 'settings.json');
    writeFileSync(path, '{not valid json');
    const s = loadSettings(path);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('leaves no .tmp file after successful save', () => {
    const path = join(testDir, 'settings.json');
    saveSettings(path, DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path + '.tmp')).toBe(false);
  });

  it('creates parent directories on save', () => {
    const path = join(testDir, 'nested', 'sub', 'settings.json');
    saveSettings(path, DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(true);
  });

  it('defaults have auto-update enabled', () => {
    expect(DEFAULT_SETTINGS.autoUpdateCheckEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.updateState.lastCheckedAt).toBeNull();
    expect(DEFAULT_SETTINGS.updateState.skippedVersion).toBeNull();
    expect(DEFAULT_SETTINGS.updateState.consecutiveFailures).toBe(0);
  });

  it('loads legacy settings with missing fields filled by defaults', () => {
    const path = join(testDir, 'settings.json');
    writeFileSync(
      path,
      JSON.stringify({
        notificationsEnabled: true,
        soundEnabled: false,
        includePreview: true,
      }),
    );
    const s = loadSettings(path);
    expect(s.notificationsEnabled).toBe(true);
    expect(s.soundEnabled).toBe(false);
    expect(s.includePreview).toBe(true);
    expect(s.autoUpdateCheckEnabled).toBe(true);
    expect(s.updateState.consecutiveFailures).toBe(0);
  });

  it('round-trips settings with update state', () => {
    const path = join(testDir, 'settings.json');
    const s: Settings = {
      notificationsEnabled: true,
      soundEnabled: true,
      includePreview: false,
      autoUpdateCheckEnabled: false,
      updateState: {
        lastCheckedAt: 1_700_000_000,
        skippedVersion: 'v0.2.0',
        consecutiveFailures: 2,
      },
    };
    saveSettings(path, s);
    const loaded = loadSettings(path);
    expect(loaded).toEqual(s);
  });
});
