import { describe, it, expect } from 'vitest';
import {
  CONFIGURATIONS,
  readConfiguration,
  resolveWindowOptions,
  parseCycleCount,
  attributeObservations,
  summarizeRun,
  type Cycle,
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
    expect(readConfiguration({})).toEqual(
      CONFIGURATIONS.find((configuration) => configuration.id === 'control'),
    );
  });

  it('selects a configuration by id', () => {
    expect(readConfiguration({ WHATS_EXPERIMENT_CONFIG: 'cheap-only' })?.id).toBe('cheap-only');
  });

  // A typo in the variable must not silently measure the control and get
  // written up as a passing cheap configuration.
  it('returns null for an unknown id', () => {
    expect(readConfiguration({ WHATS_EXPERIMENT_CONFIG: 'chepa-only' })).toBeNull();
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

describe('parseCycleCount', () => {
  it('reports no cycles when the variable is absent, so a normal run is untouched', () => {
    expect(parseCycleCount(undefined)).toBe(0);
  });

  it('reads a positive count', () => {
    expect(parseCycleCount('30')).toBe(30);
  });

  it('rejects values that are not positive integers', () => {
    expect(parseCycleCount('0')).toBe(0);
    expect(parseCycleCount('-5')).toBe(0);
    expect(parseCycleCount('abc')).toBe(0);
    expect(parseCycleCount('2.5')).toBe(0);
  });
});

describe('attributeObservations', () => {
  const cycles: Cycle[] = [
    { index: 1, shownAt: 1000, hiddenAt: 3000 },
    { index: 2, shownAt: 5000, hiddenAt: 7000 },
    { index: 3, shownAt: 9000, hiddenAt: 11000 },
  ];

  it('attributes a keypress to the cycle that was on screen at the time', () => {
    expect(attributeObservations(cycles, [6000])).toEqual([
      { observedAt: 6000, cycleIndex: 2, attribution: 'exact' },
    ]);
  });

  // Reaction time means a keypress can land just after the window is hidden;
  // blaming the next cycle instead of the one just seen would be wrong.
  it('attributes a keypress shortly after a cycle ends to that cycle', () => {
    expect(attributeObservations(cycles, [7300])).toEqual([
      { observedAt: 7300, cycleIndex: 2, attribution: 'reaction-window' },
    ]);
  });

  it('prefers the visible cycle over the previous one when both could match', () => {
    expect(attributeObservations(cycles, [9100])).toEqual([
      { observedAt: 9100, cycleIndex: 3, attribution: 'exact' },
    ]);
  });

  it('marks a keypress it cannot attribute rather than dropping it', () => {
    expect(attributeObservations(cycles, [20000])).toEqual([
      { observedAt: 20000, cycleIndex: null, attribution: 'unattributed' },
    ]);
  });

  it('counts repeated presses within one cycle once', () => {
    const observations = attributeObservations(cycles, [5500, 5600, 6000]);
    expect(observations).toHaveLength(3);
    expect(new Set(observations.map((observation) => observation.cycleIndex))).toEqual(new Set([2]));
  });

  it('handles a run with no observations', () => {
    expect(attributeObservations(cycles, [])).toEqual([]);
  });
});

describe('summarizeRun', () => {
  const cycles: Cycle[] = [
    { index: 1, shownAt: 1000, hiddenAt: 3000 },
    { index: 2, shownAt: 5000, hiddenAt: 7000 },
    { index: 3, shownAt: 9000, hiddenAt: 11000 },
  ];

  it('reports zero blank frames for a clean run', () => {
    const summary = summarizeRun('cheap-only', cycles, []);
    expect(summary.blankFrameCount).toBe(0);
    expect(summary.blankCycles).toEqual([]);
    expect(summary.cycleCount).toBe(3);
  });

  it('counts distinct blank cycles rather than keypresses', () => {
    const summary = summarizeRun('cheap-only', cycles, [5500, 5600]);
    expect(summary.blankFrameCount).toBe(1);
    expect(summary.blankCycles).toEqual([2]);
  });

  it('lists blank cycles in order', () => {
    const summary = summarizeRun('control', cycles, [9500, 1500]);
    expect(summary.blankCycles).toEqual([1, 3]);
  });

  // An unattributed press means the record is incomplete; a run reported as
  // clean while a press could not be placed would overstate the result.
  it('surfaces unattributed observations separately', () => {
    const summary = summarizeRun('control', cycles, [20000]);
    expect(summary.blankFrameCount).toBe(0);
    expect(summary.unattributedCount).toBe(1);
  });
});
