import type { WebContents } from 'electron';

export const MAIN_URL = 'https://web.whatsapp.com/';

// Chromium error code for an aborted load (normal navigations/redirects).
// Retrying on this would fight the browser's own navigation, so ignore it.
const ERR_ABORTED = -3;

export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

export interface FailedLoad {
  errorCode: number;
  isMainFrame: boolean;
}

export function shouldRetryLoad(failure: FailedLoad): boolean {
  if (!failure.isMainFrame) return false;
  if (failure.errorCode === ERR_ABORTED) return false;
  return true;
}

export function retryDelayMs(attempt: number): number {
  const index = Math.min(attempt, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

interface ReloadableWebContents extends Pick<WebContents, 'loadURL'> {
  on(
    eventName: 'did-fail-load',
    handler: (
      event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => void,
  ): unknown;
  on(eventName: 'did-finish-load', handler: () => void): unknown;
}

type Scheduler = (callback: () => void, delayMs: number) => unknown;
type CancelScheduled = (handle: unknown) => void;

/**
 * Status the auto-reload controller reports so the UI can reflect what is
 * happening: the page failed to load and a retry is pending, or a load (manual
 * or automatic) is in flight, or the page loaded successfully.
 */
export type ReloadStatus = 'waiting' | 'reconnecting' | 'connected';

export interface AutoReloadController {
  /**
   * Reload the main URL immediately at the user's request. Does not disturb any
   * pending automatic retry: if this manual attempt fails, the scheduled timer
   * still fires as planned; if it succeeds, `did-finish-load` clears everything.
   */
  reconnectNow(): void;
}

export interface AutoReloadOptions {
  scheduleRetry?: Scheduler;
  cancelRetry?: CancelScheduled;
  onStatusChange?: (status: ReloadStatus) => void;
}

/**
 * Automatically reloads the main window when its top-level document fails to
 * load — most commonly when there is no network at startup, which otherwise
 * leaves a blank window until the user reloads by hand. Retries back off and
 * reset once any load succeeds.
 */
export function installAutoReload(
  webContents: ReloadableWebContents,
  options: AutoReloadOptions = {},
): AutoReloadController {
  const scheduleRetry: Scheduler = options.scheduleRetry ?? setTimeout;
  const cancelRetry: CancelScheduled =
    options.cancelRetry ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onStatusChange = options.onStatusChange ?? (() => {});

  let attempt = 0;
  let retryScheduled = false;
  let retryHandle: unknown = null;

  function report(status: ReloadStatus): void {
    onStatusChange(status);
  }

  function clearPendingRetry(): void {
    if (retryScheduled) {
      cancelRetry(retryHandle);
      retryScheduled = false;
      retryHandle = null;
    }
  }

  function load(): void {
    report('reconnecting');
    void webContents.loadURL(MAIN_URL);
  }

  webContents.on('did-finish-load', () => {
    attempt = 0;
    clearPendingRetry();
    report('connected');
  });

  webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!shouldRetryLoad({ errorCode, isMainFrame })) return;
    if (retryScheduled) return;

    const delay = retryDelayMs(attempt);
    attempt += 1;
    retryScheduled = true;
    report('waiting');
    retryHandle = scheduleRetry(() => {
      retryScheduled = false;
      retryHandle = null;
      load();
    }, delay);
  });

  return {
    reconnectNow(): void {
      load();
    },
  };
}
