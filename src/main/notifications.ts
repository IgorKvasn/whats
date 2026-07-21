import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
    hints: DbusHints,
    timeout: number,
    callback: (error: Error | null, id?: number) => void,
  ): void;
  CloseNotification(id: number, callback: (error: Error | null) => void): void;
  on(signal: 'ActionInvoked', handler: (id: number, actionKey: string) => void): void;
  on(signal: 'NotificationClosed', handler: (id: number, reason: number) => void): void;
  removeListener(signal: 'ActionInvoked', handler: (id: number, actionKey: string) => void): void;
  removeListener(signal: 'NotificationClosed', handler: (id: number, reason: number) => void): void;
}

interface DbusConnection {
  once(event: 'error', handler: (error: Error) => void): void;
  removeListener(event: 'error', handler: (error: Error) => void): void;
}

interface DbusService {
  getInterface(
    path: string,
    interfaceName: string,
    callback: (error: Error | null, iface?: NotificationsInterface) => void,
  ): void;
}

interface DbusMessageBus {
  connection: DbusConnection;
  getService(name: string): DbusService;
}

type DbusNativeModule = {
  default?: { sessionBus: () => DbusMessageBus };
  sessionBus?: () => DbusMessageBus;
};

type DbusVariant = [signature: string, value: unknown];
type DbusHints = Array<[key: string, value: DbusVariant]>;

interface ActiveNotification {
  iface: NotificationsInterface;
  actionHandler: (id: number, actionKey: string) => void;
  closedHandler: (id: number, reason: number) => void;
  cleanupIcon?: () => void | Promise<void>;
}

const activeNotificationIds = new Set<number>();
const activeNotifications = new Map<number, ActiveNotification>();
let cachedInterface: NotificationsInterface | null = null;

let dbusModulePromise: Promise<DbusNativeModule> | null = null;

function loadDbus(): Promise<DbusNativeModule> {
  // The package's shipped types only declare systemBus(), but the runtime also
  // exports sessionBus(), which we rely on. Cast through unknown to reconcile.
  dbusModulePromise ??= import('@homebridge/dbus-native') as unknown as Promise<DbusNativeModule>;
  return dbusModulePromise;
}

function getSessionBus(dbusModule: DbusNativeModule): DbusMessageBus {
  const dbus = dbusModule.default ?? dbusModule;
  if (!dbus.sessionBus) {
    throw new Error('D-Bus sessionBus export is unavailable');
  }
  return dbus.sessionBus();
}

function getNotificationsInterface(dbusModule: DbusNativeModule): Promise<NotificationsInterface> {
  return new Promise((resolve, reject) => {
    const bus = getSessionBus(dbusModule);
    let settled = false;
    const onConnectionError = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    bus.connection.once('error', onConnectionError);
    bus.getService(DBUS_DEST).getInterface(DBUS_PATH, DBUS_DEST, (error, iface) => {
      if (settled) return;
      settled = true;
      bus.connection.removeListener('error', onConnectionError);
      if (error) {
        reject(error);
        return;
      }
      if (!iface) {
        reject(new Error('D-Bus notifications interface is unavailable'));
        return;
      }
      resolve(iface);
    });
  });
}

function notify(
  iface: NotificationsInterface,
  sender: string,
  body: string,
  iconPath: string,
  senderIconPath: string | null | undefined,
): Promise<number> {
  const actions = ['open', 'Open', 'dismiss', 'Dismiss'];
  const senderIconUri = senderIconPath ? pathToFileURL(senderIconPath).href : null;
  const hints: DbusHints = senderIconUri
    ? [
        ['image-path', ['s', senderIconUri]],
        ['image_path', ['s', senderIconUri]],
      ]
    : [];

  return new Promise((resolve, reject) => {
    iface.Notify('WhatsApp', 0, iconPath, sender, body, actions, hints, -1, (error, notificationId) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(notificationId ?? 0);
    });
  });
}

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
  const displayIconPath = senderIconPath || iconPath;

  loadDbus()
    .then((dbusModule) => getNotificationsInterface(dbusModule))
    .then((iface) => {
      cachedInterface = iface;

      return notify(iface, sender, body, iconPath, senderIconPath)
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
    iface.CloseNotification(id, () => {});
    finalizeNotification(id);
  }
}

export function resetNotificationState(): void {
  activeNotificationIds.clear();
  activeNotifications.clear();
  cachedInterface = null;
}
