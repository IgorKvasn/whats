import { vi } from 'vitest';

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(),
}));

import { describe, it, expect } from 'vitest';
import { deriveTrayState, TrayState } from '../src/main/tray';

describe('deriveTrayState', () => {
  it('returns Normal when no unread and not disconnected', () => {
    expect(deriveTrayState(0, false)).toBe(TrayState.Normal);
  });

  it('returns Unread when unread count > 0 and not disconnected', () => {
    expect(deriveTrayState(1, false)).toBe(TrayState.Unread);
    expect(deriveTrayState(42, false)).toBe(TrayState.Unread);
  });

  it('returns Disconnected regardless of unread count', () => {
    expect(deriveTrayState(0, true)).toBe(TrayState.Disconnected);
    expect(deriveTrayState(5, true)).toBe(TrayState.Disconnected);
  });
});
