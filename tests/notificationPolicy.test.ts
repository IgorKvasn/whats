import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, shouldShowOnLaunch } from '../src/main/settings';
import { shouldShowIncomingNotification } from '../src/main/notificationPolicy';

describe('shouldShowIncomingNotification', () => {
  it('shows notifications while started hidden to tray', () => {
    const settings = { ...DEFAULT_SETTINGS, startMinimizedToTray: true };

    expect(shouldShowOnLaunch(settings)).toBe(false);
    expect(shouldShowIncomingNotification(settings, false)).toBe(true);
  });

  it('does not show notifications while the main window is foregrounded', () => {
    expect(shouldShowIncomingNotification(DEFAULT_SETTINGS, true)).toBe(false);
  });

  it('honors the notification setting while hidden', () => {
    const settings = { ...DEFAULT_SETTINGS, notificationsEnabled: false };

    expect(shouldShowIncomingNotification(settings, false)).toBe(false);
  });
});
