// Drives the scripted hide/show cycles for the blank-window experiment
// (issue #43) and records when each cycle was on screen, so a human observer's
// keypresses can be attributed to a cycle afterwards.
//
// Runs only when WHATS_BLANK_CYCLES is set, so a normal launch never enters it.

import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import { type Cycle } from './blankFrameExperiment';

export interface RunnerOptions {
  cycleCount: number;
  configurationId: string;
  logPath: string;
  // How long the window stays visible: long enough for the observer to judge
  // the frame, and long enough for a slow repaint to resolve itself.
  dwellMs?: number;
  hiddenMs?: number;
}

const DEFAULT_DWELL_MS = 2500;
const DEFAULT_HIDDEN_MS = 1500;

function record(logPath: string, entry: unknown): void {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

/**
 * Cycle timings use Date.now() rather than a monotonic clock because the
 * observer's keypresses are timestamped by a separate process, and wall clock
 * is the only shared reference between the two.
 */
export async function runCycles(
  window: BrowserWindow,
  options: RunnerOptions,
): Promise<Cycle[]> {
  const dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
  const hiddenMs = options.hiddenMs ?? DEFAULT_HIDDEN_MS;
  const cycles: Cycle[] = [];

  record(options.logPath, {
    kind: 'run-start',
    configurationId: options.configurationId,
    cycleCount: options.cycleCount,
    dwellMs,
    hiddenMs,
    at: Date.now(),
  });

  for (let index = 1; index <= options.cycleCount; index += 1) {
    if (window.isDestroyed()) {
      break;
    }

    window.hide();
    await delay(hiddenMs);
    if (window.isDestroyed()) {
      break;
    }

    const shownAt = Date.now();
    window.show();
    window.focus();
    window.webContents.invalidate();
    setImmediate(() => {
      if (!window.isDestroyed()) window.webContents.invalidate();
    });

    await delay(dwellMs);
    const hiddenAt = Date.now();

    const cycle = { index, shownAt, hiddenAt };
    cycles.push(cycle);
    record(options.logPath, { kind: 'cycle', ...cycle });
    console.log(`[experiment] cycle ${index}/${options.cycleCount}`);
  }

  record(options.logPath, { kind: 'run-end', at: Date.now() });
  return cycles;
}
