import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings, type Settings } from './settings';
import { currentBuildInfo } from './buildInfo';
import {
  shouldDispatch,
  showNotification,
  closeAllNotifications,
  isSafeExternalUrl,
  type LastNotification,
} from './notifications';
import { createTray, updateTray, type TrayHandle } from './tray';
import {
  decideUpdate,
  buildUpdateInfo,
  fetchLatestRelease,
  shouldRunCheck,
  REPO,
  FAILURE_THRESHOLD,
  type UpdateInfo,
  type FetchOutcome,
} from './updater';
import {
  setMainWindow,
  getMainWindow,
  showMainWindow,
  toggleMainWindow,
  mainInForeground,
  createDialogOpeners,
} from './windows';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings: Settings = loadSettings(settingsPath);
let lastNotification: LastNotification | null = null;
let currentUpdate: UpdateInfo | null = null;
let trayHandle: TrayHandle | null = null;
let dialogs: ReturnType<typeof createDialogOpeners>;
let notificationIconPath = '';

if (!settings.hardwareAccelerationEnabled) {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(initialize);
}

function getVersion(): string {
  return app.getVersion();
}

async function initialize(): Promise<void> {
  // WhatsApp Web rejects Electron's UA; present as plain Chrome.
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s+Electron\/[\w.]+/, '')
    .replace(/\s+whats\/[\w.]+/, '');

  const preloadDialogPath = path.join(__dirname, '../preload/index.cjs');
  const preloadWhatsappPath = path.join(__dirname, '../preload/whatsapp.cjs');

  const mainWindow = new BrowserWindow({
    title: 'WhatsApp',
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: preloadWhatsappPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setMainWindow(mainWindow);
  mainWindow.on('focus', closeAllNotifications);
  mainWindow.loadURL('https://web.whatsapp.com/');

  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ??
    `file://${path.join(__dirname, '../renderer/index.html')}`;

  dialogs = createDialogOpeners(preloadDialogPath, rendererUrl);

  const iconDir = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'),
    'icons',
  );

  notificationIconPath = path.join(iconDir, 'icon.png');

  trayHandle = createTray(iconDir, {
    onShow: showMainWindow,
    onSettings: dialogs.openSettings,
    onAbout: dialogs.openAbout,
    onDevTools: () => {
      const win = getMainWindow();
      if (win) win.webContents.openDevTools();
    },
    onQuit: () => app.exit(0),
    onToggle: toggleMainWindow,
  });

  mainWindow.on('close', (e) => {
    if (trayHandle) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  registerIpcHandlers(iconDir);

  if (settings.autoUpdateCheckEnabled) {
    setTimeout(() => runStartupCheck(), 5000);
  }
}

function registerIpcHandlers(iconDir: string): void {
  ipcMain.handle('build-info:get', () => {
    return currentBuildInfo(getVersion());
  });

  ipcMain.handle('settings:get', () => {
    return settings;
  });

  ipcMain.handle('settings:set', (_event, newSettings: Settings) => {
    saveSettings(settingsPath, newSettings);
    settings = newSettings;
  });

  ipcMain.handle('settings:preview-notification', () => {
    showNotification('WhatsApp', 'Notification preview', false, notificationIconPath, showMainWindow);
  });

  ipcMain.handle('settings:preview-sound', () => {
    showNotification('WhatsApp', 'Sound preview', true, notificationIconPath, showMainWindow);
  });

  ipcMain.handle('update:get-info', () => {
    return currentUpdate;
  });

  ipcMain.handle('update:check-now', async () => {
    return await runManualCheck();
  });

  ipcMain.handle('update:skip-version', (_event, version: string) => {
    settings.updateState.skippedVersion = version;
    saveSettings(settingsPath, settings);
  });

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (!isSafeExternalUrl(url)) {
      throw new Error(`rejected url scheme: ${url}`);
    }
    shell.openExternal(url);
  });

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.on('whatsapp:notify', (_event, payload: { sender: string; body: string | null }) => {
    const { sender, body } = payload;
    const senderTrunc = sender.slice(0, 200);
    const bodyTrunc = body ? body.slice(0, 1000) : '';

    if (mainInForeground()) return;

    const now = Date.now();
    if (!shouldDispatch(lastNotification, now, senderTrunc, bodyTrunc, 1500)) return;

    lastNotification = { time: now, sender: senderTrunc, body: bodyTrunc };

    if (!settings.notificationsEnabled) return;

    const bodyText = settings.includePreview ? bodyTrunc : '';
    showNotification(senderTrunc, bodyText, settings.soundEnabled, notificationIconPath, showMainWindow);
  });

  ipcMain.on('whatsapp:unread', (_event, count: number) => {
    if (trayHandle) {
      updateTray(trayHandle, iconDir, count, undefined);
    }
  });

  ipcMain.on('whatsapp:disconnected', (_event, disconnected: boolean) => {
    if (trayHandle) {
      updateTray(trayHandle, iconDir, undefined, disconnected);
    }
  });

  ipcMain.on('shell:open-external', (_event, url: string) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  });
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function runStartupCheck(): Promise<void> {
  const now = currentUnixSeconds();
  if (!shouldRunCheck(now, settings.updateState.lastCheckedAt)) return;

  const outcome = await fetchLatestRelease(REPO, getVersion());
  handleFetchOutcome(outcome, now, settings.updateState.skippedVersion);
}

async function runManualCheck(): Promise<
  { status: 'update_available' } | { status: 'up_to_date'; current: string } | { status: 'failed'; error: string }
> {
  const outcome = await fetchLatestRelease(REPO, getVersion());

  if (outcome.kind === 'failed') {
    return { status: 'failed', error: outcome.error };
  }

  const now = currentUnixSeconds();
  if (outcome.kind === 'no-releases') {
    recordSuccess(now);
    return { status: 'up_to_date', current: getVersion() };
  }

  recordSuccess(now);
  if (decideUpdate(getVersion(), outcome.release.tag_name, null)) {
    const info = buildUpdateInfo(outcome.release, getVersion());
    currentUpdate = info;
    dialogs.openUpdate();
    return { status: 'update_available' };
  }
  return { status: 'up_to_date', current: getVersion() };
}

function handleFetchOutcome(
  outcome: FetchOutcome,
  now: number,
  skippedVersion: string | null,
): void {
  if (outcome.kind === 'failed') {
    handleFailure();
    return;
  }
  if (outcome.kind === 'no-releases') {
    recordSuccess(now);
    return;
  }
  recordSuccess(now);
  if (decideUpdate(getVersion(), outcome.release.tag_name, skippedVersion)) {
    currentUpdate = buildUpdateInfo(outcome.release, getVersion());
    dialogs.openUpdate();
  }
}

function recordSuccess(now: number): void {
  settings.updateState.lastCheckedAt = now;
  settings.updateState.consecutiveFailures = 0;
  saveSettings(settingsPath, settings);
}

function handleFailure(): void {
  settings.updateState.consecutiveFailures += 1;
  const fire = settings.updateState.consecutiveFailures >= FAILURE_THRESHOLD;
  if (fire) {
    settings.updateState.consecutiveFailures = 0;
  }
  saveSettings(settingsPath, settings);
  if (fire && settings.notificationsEnabled) {
    showNotification(
      'WhatsApp',
      "Couldn't check for updates — please verify your internet connection.",
      false,
      notificationIconPath,
      showMainWindow,
    );
  }
}
