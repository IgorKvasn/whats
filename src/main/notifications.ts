import { execFile } from 'node:child_process';
import { sessionBus } from 'dbus-next';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';

const DBUS_DEST = 'org.freedesktop.Notifications';
const DBUS_PATH = '/org/freedesktop/Notifications';

export interface LastNotification {
  time: number;
  sender: string;
  body: string;
}

export function shouldDispatch(
  last: LastNotification | null,
  now: number,
  sender: string,
  body: string,
  windowMs: number,
): boolean {
  if (!last) return true;
  const samePayload = last.sender === sender && last.body === body;
  return !samePayload || now - last.time >= windowMs;
}

export function isSafeExternalUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const colonIdx = lower.indexOf(':');
  if (colonIdx < 1) return false;
  const scheme = lower.slice(0, colonIdx);
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
}

interface NotificationsInterface {
  Notify(
    appName: string,
    replacesId: number,
    icon: string,
    summary: string,
    body: string,
    actions: string[],
    hints: Record<string, unknown>,
    timeout: number,
  ): Promise<number>;
  on(signal: string, handler: (...args: unknown[]) => void): void;
  removeListener(signal: string, handler: (...args: unknown[]) => void): void;
}

function showNotificationFallback(
  sender: string,
  body: string,
  iconPath: string,
): void {
  const args = [
    '--app-name', 'WhatsApp',
    '--icon', iconPath,
    '--', sender, body,
  ];

  execFile('notify-send', args, (err) => {
    if (err) {
      console.error('notify: notify-send fallback failed:', err);
    }
  });
}

export function showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  iconPath: string,
  onOpen: () => void,
): void {
  const bus = sessionBus();

  bus.getProxyObject(DBUS_DEST, DBUS_PATH)
    .then((obj) => {
      const iface = obj.getInterface(DBUS_DEST) as unknown as NotificationsInterface;
      const actions = ['open', 'Open', 'dismiss', 'Dismiss'];

      return iface.Notify('WhatsApp', 0, iconPath, sender, body, actions, {}, -1)
        .then((notificationId) => {
          const handler = (id: number, actionKey: string): void => {
            if (id !== notificationId) return;
            iface.removeListener('ActionInvoked', handler);
            if (actionKey === 'open') {
              onOpen();
            }
          };
          iface.on('ActionInvoked', handler);
        });
    })
    .catch((err) => {
      console.error('notify: D-Bus notification failed, falling back to notify-send:', err);
      showNotificationFallback(sender, body, iconPath);
    });

  if (withSound) {
    execFile('paplay', [SOUND_FILE], (err) => {
      if (err) console.error('notify: paplay failed:', err);
    });
  }
}
