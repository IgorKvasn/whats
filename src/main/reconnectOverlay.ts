import { BrowserWindow } from 'electron';
import type { ReloadStatus } from './reload';

interface OverlayOptions {
  parent: BrowserWindow;
  preloadPath: string;
  rendererUrl: string;
}

/**
 * A frameless, transparent window layered over the main window that shows the
 * reconnect UI while WhatsApp Web is unreachable. It tracks the parent's bounds
 * and is torn down the moment the page connects, so the WhatsApp page itself is
 * never touched.
 */
export class ReconnectOverlay {
  private readonly parent: BrowserWindow;
  private readonly preloadPath: string;
  private readonly rendererUrl: string;
  private window: BrowserWindow | null = null;
  private lastStatus: ReloadStatus = 'connected';
  private readonly boundsListeners: Array<() => void> = [];

  constructor(options: OverlayOptions) {
    this.parent = options.parent;
    this.preloadPath = options.preloadPath;
    this.rendererUrl = options.rendererUrl;
  }

  handleStatus(status: ReloadStatus): void {
    this.lastStatus = status;
    if (status === 'connected') {
      this.hide();
      return;
    }
    this.show();
    this.pushStatus();
  }

  private show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.syncBounds();
      if (!this.window.isVisible()) this.window.show();
      return;
    }

    const overlay = new BrowserWindow({
      parent: this.parent,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window = overlay;
    overlay.on('closed', () => {
      this.detachBoundsListeners();
      if (this.window === overlay) this.window = null;
    });

    overlay.webContents.on('did-finish-load', () => this.pushStatus());

    this.attachBoundsListeners();
    this.syncBounds();

    const separator = this.rendererUrl.includes('?') ? '&' : '?';
    overlay.loadURL(`${this.rendererUrl}${separator}view=reconnect`);
    overlay.show();
  }

  private hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  private pushStatus(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('reconnect:status', this.lastStatus);
  }

  private syncBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.parent.isDestroyed()) return;
    this.window.setBounds(this.parent.getContentBounds());
  }

  private attachBoundsListeners(): void {
    const sync = () => this.syncBounds();
    this.parent.on('resize', sync);
    this.parent.on('move', sync);
    this.boundsListeners.push(() => this.parent.removeListener('resize', sync));
    this.boundsListeners.push(() => this.parent.removeListener('move', sync));
  }

  private detachBoundsListeners(): void {
    for (const remove of this.boundsListeners) remove();
    this.boundsListeners.length = 0;
  }
}
