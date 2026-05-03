import { describe, expect, it, vi } from 'vitest';
import {
  WHATSAPP_ORIGIN,
  installNavigationGuards,
  isAllowedWhatsappUrl,
  isTrustedWhatsappEvent,
} from '../src/main/navigation';

describe('isAllowedWhatsappUrl', () => {
  it('allows the WhatsApp Web origin', () => {
    expect(isAllowedWhatsappUrl(WHATSAPP_ORIGIN)).toBe(true);
    expect(isAllowedWhatsappUrl('https://web.whatsapp.com/')).toBe(true);
    expect(isAllowedWhatsappUrl('https://web.whatsapp.com/send?phone=123')).toBe(true);
  });

  it('rejects non-WhatsApp origins and malformed URLs', () => {
    expect(isAllowedWhatsappUrl('https://evil.example/')).toBe(false);
    expect(isAllowedWhatsappUrl('https://web.whatsapp.com.evil.example/')).toBe(false);
    expect(isAllowedWhatsappUrl('http://web.whatsapp.com/')).toBe(false);
    expect(isAllowedWhatsappUrl('not a url')).toBe(false);
  });
});

describe('installNavigationGuards', () => {
  function createWebContents() {
    const listeners = new Map<string, (event: { preventDefault: () => void }, url: string) => void>();
    const webContents = {
      on: vi.fn((eventName: string, handler: (event: { preventDefault: () => void }, url: string) => void) => {
        listeners.set(eventName, handler);
      }),
      setWindowOpenHandler: vi.fn(),
    };
    return { webContents, listeners };
  }

  it('blocks top-level navigation away from WhatsApp and opens safe URLs externally', () => {
    const { webContents, listeners } = createWebContents();
    const openExternal = vi.fn();
    installNavigationGuards(webContents, openExternal);

    const event = { preventDefault: vi.fn() };
    listeners.get('will-navigate')!(event, 'https://example.com/');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('allows top-level navigation within WhatsApp', () => {
    const { webContents, listeners } = createWebContents();
    const openExternal = vi.fn();
    installNavigationGuards(webContents, openExternal);

    const event = { preventDefault: vi.fn() };
    listeners.get('will-navigate')!(event, 'https://web.whatsapp.com/');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('denies window.open and only routes safe URLs externally', () => {
    const { webContents } = createWebContents();
    const openExternal = vi.fn();
    installNavigationGuards(webContents, openExternal);

    const handler = webContents.setWindowOpenHandler.mock.calls[0][0];

    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');

    openExternal.mockClear();
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('isTrustedWhatsappEvent', () => {
  it('requires the main webContents and a WhatsApp frame URL', () => {
    const mainWebContents = {};
    expect(
      isTrustedWhatsappEvent({
        sender: mainWebContents,
        senderFrameUrl: 'https://web.whatsapp.com/',
        mainWebContents,
      }),
    ).toBe(true);

    expect(
      isTrustedWhatsappEvent({
        sender: {},
        senderFrameUrl: 'https://web.whatsapp.com/',
        mainWebContents,
      }),
    ).toBe(false);

    expect(
      isTrustedWhatsappEvent({
        sender: mainWebContents,
        senderFrameUrl: 'https://example.com/',
        mainWebContents,
      }),
    ).toBe(false);
  });
});
