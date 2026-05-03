import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sessionBus, Variant } from 'dbus-next';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';
const MAX_ICON_BYTES = 2 * 1024 * 1024;

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
  CloseNotification(id: number): Promise<void>;
  on(signal: 'ActionInvoked', handler: (id: number, actionKey: string) => void): void;
  on(signal: 'NotificationClosed', handler: (id: number, reason: number) => void): void;
  removeListener(signal: 'ActionInvoked', handler: (id: number, actionKey: string) => void): void;
  removeListener(signal: 'NotificationClosed', handler: (id: number, reason: number) => void): void;
}

interface ActiveNotification {
  iface: NotificationsInterface;
  actionHandler: (id: number, actionKey: string) => void;
  closedHandler: (id: number, reason: number) => void;
  cleanupIcon?: () => void | Promise<void>;
}

const activeNotificationIds = new Set<number>();
const activeNotifications = new Map<number, ActiveNotification>();
let cachedInterface: NotificationsInterface | null = null;

function showNotificationFallback(
  sender: string,
  body: string,
  iconPath: string,
  cleanupIcon?: () => void | Promise<void>,
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
    runCleanup(cleanupIcon);
  });
}

export function showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  iconPath: string,
  onOpen: () => void,
  senderIconPath?: string | null,
  cleanupIcon?: () => void | Promise<void>,
): void {
  const bus = sessionBus();
  const displayIconPath = senderIconPath || iconPath;

  bus.getProxyObject(DBUS_DEST, DBUS_PATH)
    .then((obj) => {
      const iface = obj.getInterface(DBUS_DEST) as unknown as NotificationsInterface;
      cachedInterface = iface;
      const actions = ['open', 'Open', 'dismiss', 'Dismiss'];
      const senderIconUri = senderIconPath ? pathToFileURL(senderIconPath).href : null;
      const hints = senderIconPath
        ? {
            'image-path': new Variant('s', senderIconUri),
            image_path: new Variant('s', senderIconUri),
          }
        : {};

      return iface.Notify('WhatsApp', 0, iconPath, sender, body, actions, hints, -1)
        .then((notificationId) => {
          activeNotificationIds.add(notificationId);
          const actionHandler = (id: number, actionKey: string): void => {
            if (id !== notificationId) return;
            finalizeNotification(notificationId);
            if (actionKey === 'open') {
              onOpen();
            }
          };
          const closedHandler = (id: number): void => {
            if (id !== notificationId) return;
            finalizeNotification(notificationId);
          };
          activeNotifications.set(notificationId, {
            iface,
            actionHandler,
            closedHandler,
            cleanupIcon,
          });
          iface.on('ActionInvoked', actionHandler);
          iface.on('NotificationClosed', closedHandler);
        });
    })
    .catch((err) => {
      console.error('notify: D-Bus notification failed, falling back to notify-send:', err);
      showNotificationFallback(sender, body, displayIconPath, cleanupIcon);
    });

  if (withSound) {
    execFile('paplay', [SOUND_FILE], (err) => {
      if (err) console.error('notify: paplay failed:', err);
    });
  }
}

function finalizeNotification(notificationId: number): void {
  activeNotificationIds.delete(notificationId);
  const entry = activeNotifications.get(notificationId);
  if (!entry) return;

  activeNotifications.delete(notificationId);
  entry.iface.removeListener('ActionInvoked', entry.actionHandler);
  entry.iface.removeListener('NotificationClosed', entry.closedHandler);
  runCleanup(entry.cleanupIcon);
}

function runCleanup(cleanupIcon: (() => void | Promise<void>) | undefined): void {
  if (!cleanupIcon) return;
  void Promise.resolve(cleanupIcon()).catch((err) => {
    console.error('notify: cached notification icon cleanup failed:', err);
  });
}

export async function resolveNotificationIconPath(
  candidate: string | null | undefined,
  fallbackIconPath: string,
  cacheDir: string,
): Promise<string> {
  const icon = typeof candidate === 'string' ? candidate.trim() : '';
  if (!icon) return fallbackIconPath;

  const dataMatch = icon.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (dataMatch) {
    const ext = extensionForContentType(dataMatch[1]);
    const buffer = Buffer.from(dataMatch[2], 'base64');
    if (buffer.byteLength > MAX_ICON_BYTES) return fallbackIconPath;
    return writeCachedIcon(buffer, cacheDir, `${hash(icon)}.${ext}`);
  }

  if (!/^https:\/\//i.test(icon)) return fallbackIconPath;

  try {
    const response = await fetch(icon, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return fallbackIconPath;
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > MAX_ICON_BYTES) return fallbackIconPath;
    const contentType = response.headers.get('content-type') || '';
    const ext = extensionForContentType(contentType);
    if (!ext) return fallbackIconPath;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_ICON_BYTES) return fallbackIconPath;
    return writeCachedIcon(buffer, cacheDir, `${hash(icon)}.${ext}`);
  } catch {
    return fallbackIconPath;
  }
}

function extensionForContentType(contentType: string): string | null {
  const normalized = contentType.toLowerCase().split(';', 1)[0].trim();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  return null;
}

async function writeCachedIcon(buffer: Buffer, cacheDir: string, fileName: string): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const iconPath = path.join(cacheDir, fileName);
  await writeFile(iconPath, buffer);
  return iconPath;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export async function removeCachedNotificationIcon(
  iconPath: string,
  fallbackIconPath: string,
): Promise<void> {
  if (!iconPath || iconPath === fallbackIconPath) return;
  await unlink(iconPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

export function closeAllNotifications(): void {
  if (!cachedInterface || activeNotificationIds.size === 0) return;
  const iface = cachedInterface;
  for (const id of [...activeNotificationIds]) {
    iface.CloseNotification(id).catch(() => {});
    finalizeNotification(id);
  }
}

export function resetNotificationState(): void {
  activeNotificationIds.clear();
  activeNotifications.clear();
  cachedInterface = null;
}
