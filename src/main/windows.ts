import { BrowserWindow } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
const dialogWindows: Map<string, BrowserWindow> = new Map();

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function mainInForeground(): boolean {
  if (!mainWindow) return false;
  return mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
}

export function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function hideMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.hide();
}

export function toggleMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

interface DialogOptions {
  label: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  preloadPath: string;
  rendererUrl: string;
}

function showDialogWindow(options: DialogOptions): void {
  const existing = dialogWindows.get(options.label);
  if (existing && !existing.isDestroyed()) {
    existing.restore();
    existing.show();
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    resizable: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dialogWindows.set(options.label, win);
  win.on('closed', () => dialogWindows.delete(options.label));

  const separator = options.rendererUrl.includes('?') ? '&' : '?';
  const url = `${options.rendererUrl}${separator}view=${options.label}`;
  win.loadURL(url);
}

export function createDialogOpeners(preloadPath: string, rendererUrl: string) {
  return {
    openSettings(): void {
      showDialogWindow({
        label: 'settings',
        title: 'WhatsApp — Settings',
        width: 480,
        height: 360,
        minWidth: 320,
        minHeight: 240,
        preloadPath,
        rendererUrl,
      });
    },
    openAbout(): void {
      showDialogWindow({
        label: 'about',
        title: 'WhatsApp — About',
        width: 440,
        height: 240,
        minWidth: 320,
        minHeight: 220,
        preloadPath,
        rendererUrl,
      });
    },
    openUpdate(): void {
      showDialogWindow({
        label: 'update',
        title: 'WhatsApp — Update available',
        width: 480,
        height: 420,
        minWidth: 360,
        minHeight: 320,
        preloadPath,
        rendererUrl,
      });
    },
  };
}
