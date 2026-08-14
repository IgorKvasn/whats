// Drives one trial of the blank-window experiment (issue #43) and records when
// the window was on screen, so a human observer's keypresses can be attributed
// to a trial afterwards.
//
// One trial per app launch. `paintWhenInitiallyHidden` governs whether Chromium
// composites a window that has *never been shown*, so its effect exists only on
// a window's first show; cycling an already-shown window in one process cannot
// detect it. Each trial therefore measures a single first show of a freshly
// launched, tray-hidden app.
//
// Runs only when WHATS_BLANK_TRIAL is set, so a normal launch never enters it.

import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';

export interface TrialOptions {
  trialIndex: number;
  configurationId: string;
  logPath: string;
  // How long the window stays visible: long enough for the observer to judge
  // the frame, and long enough for a slow repaint to resolve itself.
  dwellMs?: number;
}

const DEFAULT_DWELL_MS = 2500;

function record(logPath: string, entry: unknown): void {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

/**
 * Timings use Date.now() rather than a monotonic clock because the observer's
 * keypresses are timestamped by a separate process, and wall clock is the only
 * shared reference between the two.
 *
 * `show` must be the app's real show path so the trial exercises what a user
 * triggers, including the always-on-top raise that path performs on Wayland.
 */
export async function runTrial(
  window: BrowserWindow,
  show: () => void,
  options: TrialOptions,
): Promise<void> {
  const dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;

  if (window.isDestroyed()) {
    return;
  }

  const shownAt = Date.now();
  show();
  await delay(dwellMs);
  const hiddenAt = Date.now();

  record(options.logPath, {
    kind: 'trial',
    index: options.trialIndex,
    configurationId: options.configurationId,
    shownAt,
    hiddenAt,
  });
  console.log(`[experiment] trial ${options.trialIndex} shown`);
}
