import { describe, it, expect, vi } from 'vitest';
import { parseUnread, makeNotificationShim } from '../src-tauri/resources/inject.lib.js';

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
