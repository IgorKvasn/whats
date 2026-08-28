import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettings, normalizeSettings } from '../src/main/settings';

describe('defaultSettings', () => {
  it('returns a value that shares no updateState object with the module default', () => {
    const a = defaultSettings();
    const b = defaultSettings();

    a.updateState.consecutiveFailures = 7;

    expect(b.updateState.consecutiveFailures).toBe(0);
    expect(DEFAULT_SETTINGS.updateState.consecutiveFailures).toBe(0);
  });
});

describe('normalizeSettings', () => {
  it('keeps valid preference fields from the payload', () => {
    const result = normalizeSettings(
      { notificationsEnabled: false, includePreview: true },
      defaultSettings(),
    );

    expect(result.notificationsEnabled).toBe(false);
    expect(result.includePreview).toBe(true);
  });

  it('falls back to the base value for missing or wrong-typed fields', () => {
    const base = { ...defaultSettings(), soundEnabled: false };

    const result = normalizeSettings({ soundEnabled: 'yes', startMinimizedToTray: 1 }, base);

    expect(result.soundEnabled).toBe(false);
    expect(result.startMinimizedToTray).toBe(base.startMinimizedToTray);
  });

  it('falls back to the base updateState when the payload omits or corrupts it', () => {
    const base = {
      ...defaultSettings(),
      updateState: { lastCheckedAt: 123, skippedVersion: 'v1.2.3', consecutiveFailures: 2 },
    };

    expect(normalizeSettings({}, base).updateState).toEqual(base.updateState);
    expect(normalizeSettings({ updateState: 'nope' }, base).updateState).toEqual(base.updateState);
    expect(normalizeSettings({ updateState: { lastCheckedAt: 'x' } }, base).updateState).toEqual(
      base.updateState,
    );
  });

  it('accepts non-object payloads without throwing', () => {
    const base = defaultSettings();

    expect(normalizeSettings(null, base)).toEqual(base);
    expect(normalizeSettings('nope', base)).toEqual(base);
  });
});
