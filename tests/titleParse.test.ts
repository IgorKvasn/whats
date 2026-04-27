import { describe, it, expect } from 'vitest';
import { parseUnread } from '../src/main/titleParse';

describe('parseUnread', () => {
  it('returns 0 with no parens', () => {
    expect(parseUnread('WhatsApp')).toBe(0);
  });

  it('parses simple count', () => {
    expect(parseUnread('(3) WhatsApp')).toBe(3);
  });

  it('returns 0 for zero in parens', () => {
    expect(parseUnread('(0) WhatsApp')).toBe(0);
  });

  it('parses large count', () => {
    expect(parseUnread('(120) WhatsApp')).toBe(120);
  });

  it('returns 0 for empty string', () => {
    expect(parseUnread('')).toBe(0);
  });

  it('returns 0 for garbage', () => {
    expect(parseUnread('hello world')).toBe(0);
  });

  it('returns 0 for non-numeric parens', () => {
    expect(parseUnread('(abc) WhatsApp')).toBe(0);
  });

  it('handles leading whitespace', () => {
    expect(parseUnread('  (5) WhatsApp')).toBe(5);
  });
});
