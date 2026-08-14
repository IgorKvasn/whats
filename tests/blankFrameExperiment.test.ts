import { describe, it, expect } from 'vitest';
import {
  CONFIGURATIONS,
  readConfiguration,
  parseTrialIndex,
  parseReportedTrials,
  summarizeReportedTrials,
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

// These are the values that reach the BrowserWindow, so they guard the promise
// that a normal launch is untouched by the experiment.
describe('window options from the selected configuration', () => {
  const windowOptions = (environment: Record<string, string | undefined>) => {
    const { configuration } = readConfiguration(environment);
    return {
      paintWhenInitiallyHidden: configuration.paintWhenInitiallyHidden,
      backgroundThrottling: configuration.backgroundThrottling,
    };
  };

  it('leaves a normal run on the shipped values', () => {
    expect(windowOptions({})).toEqual({
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    });
  });

  it('applies the selected configuration', () => {
    expect(windowOptions({ WHATS_EXPERIMENT_CONFIG: 'cheap-only' })).toEqual({
      paintWhenInitiallyHidden: false,
      backgroundThrottling: true,
    });
  });

  it('falls back to the shipped values for an unknown id', () => {
    expect(windowOptions({ WHATS_EXPERIMENT_CONFIG: 'nonsense' })).toEqual({
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

describe('parseReportedTrials', () => {
  it('reads a space-separated list of trial numbers', () => {
    expect(parseReportedTrials('4 17 23', 30)).toEqual({ trials: [4, 17, 23], rejected: [] });
  });

  it('accepts commas and extra whitespace', () => {
    expect(parseReportedTrials(' 4, 17 ,23 ', 30)).toEqual({ trials: [4, 17, 23], rejected: [] });
  });

  it('treats an empty answer as no blank frames', () => {
    expect(parseReportedTrials('', 30)).toEqual({ trials: [], rejected: [] });
    expect(parseReportedTrials('   ', 30)).toEqual({ trials: [], rejected: [] });
  });

  it('sorts and de-duplicates', () => {
    expect(parseReportedTrials('9 4 9', 30).trials).toEqual([4, 9]);
  });

  // A number outside the run cannot be a real observation; reporting it back is
  // better than silently recording a blank frame for a trial that never ran.
  it('rejects numbers outside the range of trials that ran', () => {
    expect(parseReportedTrials('0 4 31', 30)).toEqual({ trials: [4], rejected: ['0', '31'] });
  });

  it('rejects tokens that are not numbers', () => {
    expect(parseReportedTrials('4 none 7', 30)).toEqual({ trials: [4, 7], rejected: ['none'] });
  });
});

describe('summarizeReportedTrials', () => {
  const trials: Trial[] = [
    { index: 1, shownAt: 1000, hiddenAt: 3000 },
    { index: 2, shownAt: 5000, hiddenAt: 7000 },
    { index: 3, shownAt: 9000, hiddenAt: 11000 },
  ];

  it('reports zero blank frames for a clean run', () => {
    const summary = summarizeReportedTrials('cheap-only', trials, []);
    expect(summary.blankFrameCount).toBe(0);
    expect(summary.blankTrials).toEqual([]);
    expect(summary.trialCount).toBe(3);
  });

  it('records the reported trials as blank', () => {
    const summary = summarizeReportedTrials('control', trials, [1, 3]);
    expect(summary.blankFrameCount).toBe(2);
    expect(summary.blankTrials).toEqual([1, 3]);
  });

  it('de-duplicates and sorts the reported trials', () => {
    const summary = summarizeReportedTrials('control', trials, [3, 1, 3]);
    expect(summary.blankTrials).toEqual([1, 3]);
    expect(summary.blankFrameCount).toBe(2);
  });
});
