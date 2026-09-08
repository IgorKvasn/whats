import type { WebContents } from 'electron';
import { isSafeExternalUrl } from './notifications';

export const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';

const TRUSTED_WHATSAPP_FRAME_HOSTS = ['web.whatsapp.com'] as const;

const TRUSTED_WHATSAPP_FRAME_HOST_SUFFIXES = ['.whatsapp.com', '.whatsapp.net'] as const;

interface NavigationEvent {
  preventDefault(): void;
}

interface FrameNavigationEvent extends NavigationEvent {
  url: string;
  isMainFrame: boolean;
}

interface WindowOpenDetails {
  url: string;
}

type OpenExternal = (url: string) => void;

type GuardedWebContents = Pick<WebContents, 'setWindowOpenHandler'> & {
  on(eventName: 'will-navigate' | 'will-redirect', handler: (event: NavigationEvent, url: string) => void): WebContents;
  on(eventName: 'will-frame-navigate', handler: (event: FrameNavigationEvent) => void): WebContents;
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

export function isTrustedWhatsappFrameUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (TRUSTED_WHATSAPP_FRAME_HOSTS.some((allowed) => host === allowed)) return true;
  return TRUSTED_WHATSAPP_FRAME_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
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

  webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (isTrustedWhatsappFrameUrl(event.url)) return;

    event.preventDefault();
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
