import type { IpcMainEvent } from 'electron';
import type { Settings } from './settings';
import type { LastNotification } from './notifications';

export const MAX_SENDER_LENGTH = 200;
export const MAX_BODY_LENGTH = 1000;
export const NOTIFICATION_DEDUPE_MS = 1500;

export interface NotifyPayload {
  sender: string;
  body: string | null;
  icon?: string | null;
}

export interface WhatsappIpcDependencies {
  isTrustedEvent(event: IpcMainEvent): boolean;
  getSettings(): Settings;
  mainInForeground(): boolean;
  shouldShowIncomingNotification(settings: Settings, foreground: boolean): boolean;
  shouldDispatch(
    last: LastNotification | null,
    now: number,
    sender: string,
    body: string,
    windowMs: number,
  ): boolean;
  now(): number;
  resolveNotificationIconPath(icon: string | null | undefined): Promise<string>;
  removeCachedNotificationIcon(iconPath: string): void;
  showNotification(args: {
    sender: string;
    body: string;
    sound: boolean;
    senderIconPath: string;
    onClosed: () => void;
  }): void;
  updateUnread(count: number): void;
  updateDisconnected(disconnected: boolean): void;
  isSafeExternalUrl(url: string): boolean;
  openExternal(url: string): void;
}

export interface WhatsappIpcHandlers {
  notify(event: IpcMainEvent, payload: NotifyPayload): Promise<void>;
  unread(event: IpcMainEvent, count: number): void;
  disconnected(event: IpcMainEvent, disconnected: boolean): void;
  openExternal(event: IpcMainEvent, url: string): void;
}

export function createWhatsappIpcHandlers(deps: WhatsappIpcDependencies): WhatsappIpcHandlers {
  let lastNotification: LastNotification | null = null;

  return {
    async notify(event, payload) {
      if (!deps.isTrustedEvent(event)) return;

      const senderTrunc = payload.sender.slice(0, MAX_SENDER_LENGTH);
      const bodyTrunc = payload.body ? payload.body.slice(0, MAX_BODY_LENGTH) : '';

      const settings = deps.getSettings();
      if (!deps.shouldShowIncomingNotification(settings, deps.mainInForeground())) return;

      const now = deps.now();
      if (!deps.shouldDispatch(lastNotification, now, senderTrunc, bodyTrunc, NOTIFICATION_DEDUPE_MS)) {
        return;
      }

      lastNotification = { time: now, sender: senderTrunc, body: bodyTrunc };

      const bodyText = settings.includePreview ? bodyTrunc : '';
      const senderIconPath = await deps.resolveNotificationIconPath(payload.icon);
      deps.showNotification({
        sender: senderTrunc,
        body: bodyText,
        sound: settings.soundEnabled,
        senderIconPath,
        onClosed: () => deps.removeCachedNotificationIcon(senderIconPath),
      });
    },

    unread(event, count) {
      if (!deps.isTrustedEvent(event)) return;
      deps.updateUnread(count);
    },

    disconnected(event, disconnected) {
      if (!deps.isTrustedEvent(event)) return;
      deps.updateDisconnected(disconnected);
    },

    openExternal(event, url) {
      if (!deps.isTrustedEvent(event)) return;
      if (deps.isSafeExternalUrl(url)) {
        deps.openExternal(url);
      }
    },
  };
}
