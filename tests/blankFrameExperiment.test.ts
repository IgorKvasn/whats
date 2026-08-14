import { describe, it, expect } from 'vitest';
import {
  CONFIGURATIONS,
  readConfiguration,
  resolveWindowOptions,
  parseTrialIndex,
  attributeObservations,
  summarizeRun,
  type Trial,
} from '../src/main/blankFrameExperiment';

describe('CONFIGURATIONS', () => {
  it('describes the three configurations the experiment compares', () => {
    expect(CONFIGURATIONS.map((configuration) => configuration.id)).toEqual([
      'cheap-only',
      'no-paint-when-hidden',
      'control',
    ]);
  });

  // The control must reproduce the shipped configuration exactly, or the
  // comparison has no fixed point to measure the other two against.
  it('gives the control the values the app ships', () => {
    const control = CONFIGURATIONS.find((configuration) => configuration.id === 'control');
    expect(control?.paintWhenInitiallyHidden).toBe(true);
    expect(control?.backgroundThrottling).toBe(false);
  });

  it('removes both expensive options from the cheap configuration', () => {
    const cheap = CONFIGURATIONS.find((configuration) => configuration.id === 'cheap-only');
    expect(cheap?.paintWhenInitiallyHidden).toBe(false);
    expect(cheap?.backgroundThrottling).toBe(true);
  });

  it('varies only compositing-while-hidden between the middle configuration and the control', () => {
    const middle = CONFIGURATIONS.find(
      (configuration) => configuration.id === 'no-paint-when-hidden',
    );
    expect(middle?.paintWhenInitiallyHidden).toBe(false);
    expect(middle?.backgroundThrottling).toBe(false);
  });
});

describe('readConfiguration', () => {
  it('defaults to the shipped configuration when no override is set', () => {
    const selection = readConfiguration({});
    expect(selection.configuration.id).toBe('control');
    expect(selection.recognised).toBe(true);
  });

  it('selects a configuration by id', () => {
    const selection = readConfiguration({ WHATS_EXPERIMENT_CONFIG: 'cheap-only' });
    expect(selection.configuration.id).toBe('cheap-only');
    expect(selection.recognised).toBe(true);
  });

  // A typo must be reportable, not silently measured as the control and written
  // up as a passing cheap configuration.
  it('reports an unknown id as unrecognised while falling back to the shipped values', () => {
    const selection = readConfiguration({ WHATS_EXPERIMENT_CONFIG: 'chepa-only' });
    expect(selection.recognised).toBe(false);
    expect(selection.configuration.id).toBe('control');
  });

  it('treats an empty value as no override', () => {
    expect(readConfiguration({ WHATS_EXPERIMENT_CONFIG: '' }).recognised).toBe(true);
  });
});

describe('resolveWindowOptions', () => {
  it('leaves a normal run on the shipped values', () => {
    expect(resolveWindowOptions({})).toEqual({
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    });
  });

  it('applies the selected configuration', () => {
    expect(resolveWindowOptions({ WHATS_EXPERIMENT_CONFIG: 'cheap-only' })).toEqual({
      paintWhenInitiallyHidden: false,
      backgroundThrottling: true,
    });
  });

  it('falls back to the shipped values for an unknown id', () => {
    expect(resolveWindowOptions({ WHATS_EXPERIMENT_CONFIG: 'nonsense' })).toEqual({
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    });
  });
});

describe('parseTrialIndex', () => {
  it('reports no trial when the variable is absent, so a normal run is untouched', () => {
    expect(parseTrialIndex(undefined)).toBe(0);
  });

  it('reads a positive index', () => {
    expect(parseTrialIndex('7')).toBe(7);
  });

  it('rejects values that are not positive integers', () => {
    expect(parseTrialIndex('0')).toBe(0);
    expect(parseTrialIndex('-5')).toBe(0);
    expect(parseTrialIndex('abc')).toBe(0);
    expect(parseTrialIndex('2.5')).toBe(0);
  });
});

describe('attributeObservations', () => {
  const trials: Trial[] = [
    { index: 1, shownAt: 1000, hiddenAt: 3000 },
    { index: 2, shownAt: 5000, hiddenAt: 7000 },
    { index: 3, shownAt: 9000, hiddenAt: 11000 },
  ];

  it('attributes a keypress to the trial that was on screen at the time', () => {
    expect(attributeObservations(trials, [6000])).toEqual([
      { observedAt: 6000, trialIndex: 2, attribution: 'exact' },
    ]);
  });

  // Reaction time means a keypress can land just after the window is hidden;
  // blaming the next trial instead of the one just seen would be wrong.
  it('attributes a keypress shortly after a trial ends to that trial', () => {
    expect(attributeObservations(trials, [7300])).toEqual([
      { observedAt: 7300, trialIndex: 2, attribution: 'reaction-window' },
    ]);
  });

  it('prefers the visible trial over the previous one when both could match', () => {
    expect(attributeObservations(trials, [9100])).toEqual([
      { observedAt: 9100, trialIndex: 3, attribution: 'exact' },
    ]);
  });

  // Trials come from separate app launches, so the log is not guaranteed to be
  // ordered; the nearest preceding trial must win, not the first one listed.
  it('picks the nearest preceding trial when the log is out of order', () => {
    const unordered: Trial[] = [
      { index: 1, shownAt: 5000, hiddenAt: 7000 },
      { index: 2, shownAt: 1000, hiddenAt: 3000 },
    ];
    expect(attributeObservations(unordered, [7200])).toEqual([
      { observedAt: 7200, trialIndex: 1, attribution: 'reaction-window' },
    ]);
  });

  it('marks a keypress it cannot attribute rather than dropping it', () => {
    expect(attributeObservations(trials, [20000])).toEqual([
      { observedAt: 20000, trialIndex: null, attribution: 'unattributed' },
    ]);
  });

  it('handles a run with no observations', () => {
    expect(attributeObservations(trials, [])).toEqual([]);
  });
});

describe('summarizeRun', () => {
  const trials: Trial[] = [
    { index: 1, shownAt: 1000, hiddenAt: 3000 },
    { index: 2, shownAt: 5000, hiddenAt: 7000 },
    { index: 3, shownAt: 9000, hiddenAt: 11000 },
  ];

  it('reports zero blank frames for a clean run', () => {
    const summary = summarizeRun('cheap-only', trials, []);
    expect(summary.blankFrameCount).toBe(0);
    expect(summary.blankTrials).toEqual([]);
    expect(summary.trialCount).toBe(3);
  });

  it('counts distinct blank trials rather than keypresses', () => {
    const summary = summarizeRun('cheap-only', trials, [5500, 5600]);
    expect(summary.blankFrameCount).toBe(1);
    expect(summary.blankTrials).toEqual([2]);
  });

  it('lists blank trials in order', () => {
    const summary = summarizeRun('control', trials, [9500, 1500]);
    expect(summary.blankTrials).toEqual([1, 3]);
  });

  // An unattributed press means the record is incomplete; a run reported as
  // clean while a press could not be placed would overstate the result.
  it('surfaces unattributed observations separately', () => {
    const summary = summarizeRun('control', trials, [20000]);
    expect(summary.blankFrameCount).toBe(0);
    expect(summary.unattributedCount).toBe(1);
  });
});
