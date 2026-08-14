// Support for the blank-window experiment (issue #43): which parts of the
// c3057c4 repaint fix are actually required to prevent a blank main window.
//
// The two options under test are selected at runtime from the environment so a
// single packaged build can exercise every configuration, and so the shipped
// defaults stay exactly as they are when the variables are absent. This is
// measurement scaffolding, not a feature: nothing here runs on a normal launch.
//
// One trial per app launch, because `paintWhenInitiallyHidden` only affects a
// window that has never been shown. Trials from many launches are collected
// into one run and summarized here.

export interface ExperimentConfiguration {
  id: string;
  paintWhenInitiallyHidden: boolean;
  backgroundThrottling: boolean;
}

export interface ExperimentWindowOptions {
  paintWhenInitiallyHidden: boolean;
  backgroundThrottling: boolean;
}

/** One first-show of a freshly launched, tray-hidden app. */
export interface Trial {
  index: number;
  shownAt: number;
  hiddenAt: number;
}

export type Attribution = 'reported';

export interface Observation {
  /** Always null: trials are reported by number after the run, not timestamped
   * live. Kept so the record states how the frame was judged. */
  observedAt: number | null;
  trialIndex: number;
  attribution: Attribution;
}

export interface RunSummary {
  configurationId: string;
  trialCount: number;
  blankFrameCount: number;
  blankTrials: number[];
  observations: Observation[];
}

// `paintWhenInitiallyHidden` defaults to true in Electron, so the shipped
// `paintWhenInitiallyHidden: true` is a no-op and *removing* it would leave
// behaviour unchanged. Disabling compositing while hidden therefore means
// setting it to false, which is what the two non-control configurations do.
export const CONFIGURATIONS: readonly ExperimentConfiguration[] = [
  {
    id: 'cheap-only',
    paintWhenInitiallyHidden: false,
    backgroundThrottling: true,
  },
  {
    id: 'no-paint-when-hidden',
    paintWhenInitiallyHidden: false,
    backgroundThrottling: false,
  },
  {
    id: 'control',
    paintWhenInitiallyHidden: true,
    backgroundThrottling: false,
  },
];

const SHIPPED_CONFIGURATION_ID = 'control';

function shippedConfiguration(): ExperimentConfiguration {
  const shipped = CONFIGURATIONS.find(
    (configuration) => configuration.id === SHIPPED_CONFIGURATION_ID,
  );
  if (!shipped) {
    throw new Error(`missing ${SHIPPED_CONFIGURATION_ID} configuration`);
  }
  return shipped;
}

export interface ConfigurationSelection {
  configuration: ExperimentConfiguration;
  /** False when an id was given but matched nothing, so a typo can be reported
   * rather than silently measuring the shipped configuration under another name. */
  recognised: boolean;
}

export function readConfiguration(
  environment: Record<string, string | undefined>,
): ConfigurationSelection {
  const requested = environment.WHATS_EXPERIMENT_CONFIG;
  if (requested === undefined || requested === '') {
    return { configuration: shippedConfiguration(), recognised: true };
  }
  const match = CONFIGURATIONS.find((configuration) => configuration.id === requested);
  return match
    ? { configuration: match, recognised: true }
    : { configuration: shippedConfiguration(), recognised: false };
}

export function resolveWindowOptions(
  environment: Record<string, string | undefined>,
): ExperimentWindowOptions {
  const { configuration } = readConfiguration(environment);
  return {
    paintWhenInitiallyHidden: configuration.paintWhenInitiallyHidden,
    backgroundThrottling: configuration.backgroundThrottling,
  };
}

export function parseTrialIndex(raw: string | undefined): number {
  if (raw === undefined) {
    return 0;
  }
  if (!/^\d+$/.test(raw.trim())) {
    return 0;
  }
  const count = Number(raw.trim());
  return count > 0 ? count : 0;
}

export interface ReportedTrials {
  trials: number[];
  /** Tokens that could not be a trial in this run, echoed back so a typo is
   * corrected rather than recorded as a blank frame. */
  rejected: string[];
}

export function parseReportedTrials(raw: string, trialCount: number): ReportedTrials {
  const tokens = raw.split(/[\s,]+/).filter((token) => token !== '');
  const trials = new Set<number>();
  const rejected: string[] = [];

  for (const token of tokens) {
    const index = Number(token);
    if (!/^\d+$/.test(token) || index < 1 || index > trialCount) {
      rejected.push(token);
      continue;
    }
    trials.add(index);
  }

  return { trials: [...trials].sort((a, b) => a - b), rejected };
}

export function summarizeReportedTrials(
  configurationId: string,
  trials: Trial[],
  blankTrials: number[],
): RunSummary {
  const unique = [...new Set(blankTrials)].sort((a, b) => a - b);
  return {
    configurationId,
    trialCount: trials.length,
    blankFrameCount: unique.length,
    blankTrials: unique,
    observations: unique.map((trialIndex) => ({
      observedAt: null,
      trialIndex,
      attribution: 'reported' as const,
    })),
  };
}
