import type { DownloadItem } from 'electron';
import { showNotification } from './notifications';
import type { Settings } from './settings';

export function notifyDownloadFailed(
  item: DownloadItem,
  settings: Pick<Settings, 'notificationsEnabled'>,
  notificationIconPath: string,
  onOpen: () => void,
): void {
  if (!settings.notificationsEnabled) return;

  showNotification(
    'WhatsApp',
    `Download failed: ${item.getFilename()}`,
    false,
    notificationIconPath,
    onOpen,
  );
}
