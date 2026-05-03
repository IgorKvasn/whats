import type { WebContents } from 'electron';
import { isSafeExternalUrl } from './notifications';

export const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';

interface NavigationEvent {
  preventDefault(): void;
}

interface WindowOpenDetails {
  url: string;
}

type OpenExternal = (url: string) => void;

type GuardedWebContents = Pick<WebContents, 'setWindowOpenHandler'> & {
  on(eventName: 'will-navigate' | 'will-redirect', handler: (event: NavigationEvent, url: string) => void): WebContents;
};

export interface TrustedWhatsappEventInput {
  sender: unknown;
  senderFrameUrl: string | null | undefined;
  mainWebContents: unknown;
}

export function isAllowedWhatsappUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === WHATSAPP_ORIGIN;
  } catch {
    return false;
  }
}

export function installNavigationGuards(
  webContents: GuardedWebContents,
  openExternal: OpenExternal,
): void {
  webContents.on('will-navigate', (event, navigationUrl) => {
    if (isAllowedWhatsappUrl(navigationUrl)) return;

    event.preventDefault();
    if (isSafeExternalUrl(navigationUrl)) {
      openExternal(navigationUrl);
    }
  });

  webContents.on('will-redirect', (event, navigationUrl) => {
    if (!isAllowedWhatsappUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  webContents.setWindowOpenHandler(({ url }: WindowOpenDetails) => {
    if (isSafeExternalUrl(url)) {
      openExternal(url);
    }

    return { action: 'deny' };
  });
}

export function isTrustedWhatsappEvent(input: TrustedWhatsappEventInput): boolean {
  return (
    input.sender === input.mainWebContents &&
    typeof input.senderFrameUrl === 'string' &&
    isAllowedWhatsappUrl(input.senderFrameUrl)
  );
}
