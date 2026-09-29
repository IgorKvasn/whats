import { vi } from 'vitest';

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(),
}));

import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';
import { installHideToTray } from '../src/main/tray';

function setup() {
  const app = new EventEmitter();
  const window = Object.assign(new EventEmitter(), { hide: vi.fn() });
  installHideToTray(app, window);
  const close = () => {
    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    return event;
  };
  return { app, window, close };
}

describe('installHideToTray', () => {
  it('hides instead of closing when the user closes the window', () => {
    const { window, close } = setup();
    const event = close();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.hide).toHaveBeenCalled();
  });

  it('lets the window close once the app is quitting (e.g. SIGTERM at poweroff)', () => {
    const { app, window, close } = setup();
    app.emit('before-quit');
    const event = close();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
