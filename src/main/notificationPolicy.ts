import type { Settings } from './settings';

export function shouldShowIncomingNotification(
  settings: Pick<Settings, 'notificationsEnabled'>,
  mainWindowIsInForeground: boolean,
): boolean {
  return settings.notificationsEnabled && !mainWindowIsInForeground;
}
