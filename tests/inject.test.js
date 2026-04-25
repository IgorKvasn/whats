import { describe, it, expect, vi } from 'vitest';
import {
  parseUnread,
  makeNotificationShim,
  shouldNotifyFromUnreadDelta,
  pickFallbackNotificationPayload,
} from '../src-tauri/resources/inject.lib.js';

function makeDocumentFixture(map) {
  return {
    querySelector(selector) {
      return map[selector] ?? null;
    },
  };
}

function makeElement({ textContent = '', title = null } = {}) {
  return {
    textContent,
    getAttribute(name) {
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
    expect(parseUnread(null)).toBe(0);
    expect(parseUnread(undefined)).toBe(0);
  });
});

describe('notification shim', () => {
  it('invokes notify_message with sender + body', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new Shim('Alice', { body: 'hi' });
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Alice', body: 'hi' });
  });
  it('passes null body when options omitted', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new Shim('Bob');
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
  it('triggers when unread count increases without a recent direct notification', () => {
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

  it('does not trigger when unread count does not increase', () => {
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

  it('does not trigger when a direct notification was just forwarded', () => {
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
  it('prefers the active conversation title and preview text', () => {
    const doc = makeDocumentFixture({
      'header [title]': makeElement({ title: 'Alice', textContent: 'Alice' }),
      '[data-pre-plain-text] span[dir="auto"]': makeElement({ textContent: 'latest message' }),
    });

    expect(pickFallbackNotificationPayload(doc)).toEqual({
      sender: 'Alice',
      body: 'latest message',
    });
  });

  it('falls back to an unread chat row preview when no active conversation is visible', () => {
    const doc = makeDocumentFixture({
      '[aria-label*="Unread"] [title]': makeElement({ title: 'Bob', textContent: 'Bob' }),
      '[aria-label*="Unread"] span[dir="auto"]': makeElement({ textContent: 'ping' }),
    });

    expect(pickFallbackNotificationPayload(doc)).toEqual({
      sender: 'Bob',
      body: 'ping',
    });
  });

  it('returns null when it cannot find a plausible sender', () => {
    const doc = makeDocumentFixture({});
    expect(pickFallbackNotificationPayload(doc)).toBeNull();
  });
});
