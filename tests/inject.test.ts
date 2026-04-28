import { describe, it, expect, vi } from 'vitest';
import {
  parseUnread,
  makeNotificationShim,
  shouldNotifyFromUnreadDelta,
  pickFallbackNotificationPayload,
} from '../src/preload/inject';

function makeDocumentFixture(map: Record<string, unknown>) {
  return {
    querySelector(selector: string) {
      return (map as Record<string, unknown>)[selector] ?? null;
    },
  };
}

function makeElement({ textContent = '', title = null as string | null } = {}) {
  return {
    textContent,
    getAttribute(name: string) {
      if (name === 'title') return title;
      return null;
    },
  };
}

describe('parseUnread', () => {
  it('returns 0 with no parens', () => expect(parseUnread('WhatsApp')).toBe(0));
  it('parses simple count', () => expect(parseUnread('(3) WhatsApp')).toBe(3));
  it('handles 0', () => expect(parseUnread('(0) WhatsApp')).toBe(0));
  it('handles large counts', () => expect(parseUnread('(120) WhatsApp')).toBe(120));
  it('returns 0 for garbage', () => expect(parseUnread('hello')).toBe(0));
  it('returns 0 for non-numeric parens', () => expect(parseUnread('(abc) X')).toBe(0));
  it('returns 0 for null/undefined', () => {
    expect(parseUnread(null as unknown as string)).toBe(0);
    expect(parseUnread(undefined as unknown as string)).toBe(0);
  });
});

describe('notification shim', () => {
  it('invokes notify_message with sender + body', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    (Shim as unknown as Function)('Alice', { body: 'hi' });
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Alice', body: 'hi' });
  });

  it('passes null body when options omitted', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    (Shim as unknown as Function)('Bob');
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Bob', body: null });
  });

  it('exposes permission as granted', () => {
    const Shim = makeNotificationShim(() => {});
    expect(Shim.permission).toBe('granted');
  });

  it('requestPermission resolves to granted', async () => {
    const Shim = makeNotificationShim(() => {});
    await expect(Shim.requestPermission()).resolves.toBe('granted');
  });
});

describe('unread delta fallback', () => {
  it('triggers when unread increases without recent direct notification', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 1,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 0,
        dedupeWindowMs: 1500,
      }),
    ).toBe(true);
  });

  it('does not trigger when unread does not increase', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 2,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 0,
        dedupeWindowMs: 1500,
      }),
    ).toBe(false);
  });

  it('does not trigger when direct notification was just forwarded', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 1,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 4500,
        dedupeWindowMs: 1500,
      }),
    ).toBe(false);
  });
});

describe('fallback payload extraction', () => {
  it('prefers active conversation title and preview', () => {
    const doc = makeDocumentFixture({
      'header [title]': makeElement({ title: 'Alice', textContent: 'Alice' }),
      '[data-pre-plain-text] span[dir="auto"]': makeElement({ textContent: 'latest message' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Alice',
      body: 'latest message',
    });
  });

  it('falls back to unread chat row', () => {
    const doc = makeDocumentFixture({
      '[aria-label*="Unread"] [title]': makeElement({ title: 'Bob', textContent: 'Bob' }),
      '[aria-label*="Unread"] span[dir="auto"]': makeElement({ textContent: 'ping' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Bob',
      body: 'ping',
    });
  });

  it('returns null when no plausible sender found', () => {
    const doc = makeDocumentFixture({});
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toBeNull();
  });

  it('ignores UI labels like "Profile details" as sender', () => {
    const doc = makeDocumentFixture({
      'header [title]': makeElement({ title: 'Profile details' }),
      '[aria-label*="Unread"] [title]': makeElement({ title: 'Charlie', textContent: 'Charlie' }),
      '[aria-label*="Unread"] span[dir="auto"]': makeElement({ textContent: 'hey' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Charlie',
      body: 'hey',
    });
  });

  it('returns null when only UI labels are found', () => {
    const doc = makeDocumentFixture({
      'header [title]': makeElement({ title: 'Profile details' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toBeNull();
  });

  it('prefers #main header over generic header', () => {
    const doc = makeDocumentFixture({
      '#main header [title]': makeElement({ title: 'Dana', textContent: 'Dana' }),
      'header [title]': makeElement({ title: 'Profile details' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Dana',
      body: null,
    });
  });
});
