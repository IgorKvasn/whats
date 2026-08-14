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

export type Attribution = 'exact' | 'reaction-window' | 'unattributed';

export interface Observation {
  observedAt: number;
  trialIndex: number | null;
  attribution: Attribution;
}

export interface RunSummary {
  configurationId: string;
  trialCount: number;
  blankFrameCount: number;
  blankTrials: number[];
  unattributedCount: number;
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

// How long after a cycle is hidden a keypress still counts as reporting that
// cycle. Covers human reaction time without reaching the next cycle's show.
const REACTION_WINDOW_MS = 1000;

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

export function attributeObservations(trials: Trial[], observedAt: number[]): Observation[] {
  return observedAt.map((timestamp) => {
    const visible = trials.find(
      (trial) => timestamp >= trial.shownAt && timestamp <= trial.hiddenAt,
    );
    if (visible) {
      return { observedAt: timestamp, trialIndex: visible.index, attribution: 'exact' as const };
    }

    // The nearest preceding trial, not the first match: trials come from
    // separate app launches, so their windows are not guaranteed ordered.
    const justHidden = trials
      .filter(
        (trial) => timestamp > trial.hiddenAt && timestamp - trial.hiddenAt <= REACTION_WINDOW_MS,
      )
      .sort((a, b) => b.hiddenAt - a.hiddenAt)[0];
    if (justHidden) {
      return {
        observedAt: timestamp,
        trialIndex: justHidden.index,
        attribution: 'reaction-window' as const,
      };
    }

    return { observedAt: timestamp, trialIndex: null, attribution: 'unattributed' as const };
  });
}

export function summarizeRun(
  configurationId: string,
  trials: Trial[],
  observedAt: number[],
): RunSummary {
  const observations = attributeObservations(trials, observedAt);
  const blankTrials = [
    ...new Set(
      observations
        .map((observation) => observation.trialIndex)
        .filter((index): index is number => index !== null),
    ),
  ].sort((a, b) => a - b);

  return {
    configurationId,
    trialCount: trials.length,
    blankFrameCount: blankTrials.length,
    blankTrials,
    unattributedCount: observations.filter(
      (observation) => observation.attribution === 'unattributed',
    ).length,
    observations,
  };
}
