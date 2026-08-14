import { app, BrowserWindow, ipcMain, shell, type IpcMainEvent } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings, shouldShowOnLaunch, type Settings } from './settings';
import { currentBuildInfo } from './buildInfo';
import {
  shouldDispatch,
  showNotification,
  resolveNotificationIconPath,
  removeCachedNotificationIcon,
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
import {
  installNavigationGuards,
  isTrustedWhatsappEvent,
} from './navigation';
import { installAutoReload, MAIN_URL, type AutoReloadController } from './reload';
import { ReconnectOverlay } from './reconnectOverlay';
import { shouldShowIncomingNotification } from './notificationPolicy';
import { readConfiguration, resolveWindowOptions, parseTrialIndex } from './blankFrameExperiment';
import { runTrial } from './blankFrameRunner';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings: Settings = loadSettings(settingsPath);
let lastNotification: LastNotification | null = null;
let currentUpdate: UpdateInfo | null = null;
let trayHandle: TrayHandle | null = null;
let dialogs: ReturnType<typeof createDialogOpeners>;
let notificationIconPath = '';
let autoReload: AutoReloadController | null = null;

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

  // Both values match the shipped configuration unless WHATS_EXPERIMENT_CONFIG
  // overrides them; see docs/memory/blank-frame-experiment.md (issue #43).
  const experimentOptions = resolveWindowOptions(process.env);
  if (!readConfiguration(process.env).recognised) {
    console.error(
      `[experiment] unknown WHATS_EXPERIMENT_CONFIG=${process.env.WHATS_EXPERIMENT_CONFIG}; ` +
        `using the shipped configuration`,
    );
  }

  const mainWindow = new BrowserWindow({
    title: 'WhatsApp',
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    show: false,
    backgroundColor: '#111b21',
    // Keep compositing the page while the window is hidden (tray / start-minimized);
    // without this Chromium can show a blank frame on the first show().
    paintWhenInitiallyHidden: experimentOptions.paintWhenInitiallyHidden,
    webPreferences: {
      preload: preloadWhatsappPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: experimentOptions.backgroundThrottling,
    },
  });

  if (shouldShowOnLaunch(settings)) {
    mainWindow.show();
  }

  setMainWindow(mainWindow);
  mainWindow.on('focus', closeAllNotifications);
  installNavigationGuards(mainWindow.webContents, (url) => {
    void shell.openExternal(url);
  });

  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ??
    `file://${path.join(__dirname, '../renderer/index.html')}`;

  const reconnectOverlay = new ReconnectOverlay({
    parent: mainWindow,
    preloadPath: preloadDialogPath,
    rendererUrl,
  });
  autoReload = installAutoReload(mainWindow.webContents, {
    onStatusChange: (status) => reconnectOverlay.handleStatus(status),
  });
  mainWindow.loadURL(MAIN_URL);

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

  startBlankFrameExperiment(mainWindow);
}

// One first-show trial for issue #43. Inert unless WHATS_BLANK_TRIAL is set.
// The window must never have been shown before the trial, which is what makes
// paintWhenInitiallyHidden observable, so this requires startMinimizedToTray
// and quits afterwards to leave the next launch a clean first show.
function startBlankFrameExperiment(mainWindow: BrowserWindow): void {
  const trialIndex = parseTrialIndex(process.env.WHATS_BLANK_TRIAL);
  if (trialIndex === 0) {
    return;
  }

  const logPath = process.env.WHATS_BLANK_LOG;
  if (!logPath) {
    console.error('[experiment] WHATS_BLANK_TRIAL is set but WHATS_BLANK_LOG is not; not running');
    return;
  }

  if (!settings.startMinimizedToTray) {
    console.error(
      '[experiment] startMinimizedToTray must be enabled: the window has to be unshown ' +
        'until the trial for paintWhenInitiallyHidden to have any effect',
    );
    app.exit(2);
    return;
  }

  const { configuration } = readConfiguration(process.env);
  mainWindow.webContents.once('did-finish-load', () => {
    // Let the page settle before the show, so the trial measures presenting a
    // loaded page rather than racing first paint.
    setTimeout(() => {
      void runTrial(mainWindow, showMainWindow, {
        trialIndex,
        configurationId: configuration.id,
        logPath,
      }).then(() => {
        console.log('[experiment] trial complete');
        app.exit(0);
      });
    }, 5000);
  });
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

  ipcMain.on('reconnect:now', () => {
    autoReload?.reconnectNow();
  });

  ipcMain.on('whatsapp:notify', async (
    _event,
    payload: { sender: string; body: string | null; icon?: string | null },
  ) => {
    if (!isTrustedWhatsappIpcEvent(_event)) return;

    const { sender, body } = payload;
    const senderTrunc = sender.slice(0, 200);
    const bodyTrunc = body ? body.slice(0, 1000) : '';

    if (!shouldShowIncomingNotification(settings, mainInForeground())) return;

    const now = Date.now();
    if (!shouldDispatch(lastNotification, now, senderTrunc, bodyTrunc, 1500)) return;

    lastNotification = { time: now, sender: senderTrunc, body: bodyTrunc };

    const bodyText = settings.includePreview ? bodyTrunc : '';
    const senderIconPath = await resolveNotificationIconPath(
      payload.icon,
      notificationIconPath,
      path.join(app.getPath('userData'), 'notification-icons'),
    );
    showNotification(
      senderTrunc,
      bodyText,
      settings.soundEnabled,
      notificationIconPath,
      showMainWindow,
      senderIconPath,
      () => removeCachedNotificationIcon(senderIconPath, notificationIconPath),
    );
  });

  ipcMain.on('whatsapp:unread', (_event, count: number) => {
    if (!isTrustedWhatsappIpcEvent(_event)) return;

    if (trayHandle) {
      updateTray(trayHandle, iconDir, count, undefined);
    }
  });

  ipcMain.on('whatsapp:disconnected', (_event, disconnected: boolean) => {
    if (!isTrustedWhatsappIpcEvent(_event)) return;

    if (trayHandle) {
      updateTray(trayHandle, iconDir, undefined, disconnected);
    }
  });

  ipcMain.on('shell:open-external', (_event, url: string) => {
    if (!isTrustedWhatsappIpcEvent(_event)) return;

    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  });
}

function isTrustedWhatsappIpcEvent(event: IpcMainEvent): boolean {
  const mainWindow = getMainWindow();
  return isTrustedWhatsappEvent({
    sender: event.sender,
    senderFrameUrl: event.senderFrame?.url,
    mainWebContents: mainWindow?.webContents,
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
