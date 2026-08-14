// Support for the blank-window experiment (issue #43): which parts of the
// c3057c4 repaint fix are actually required to prevent a blank main window.
//
// The two options under test are selected at runtime from the environment so a
// single packaged build can exercise every configuration, and so the shipped
// defaults stay exactly as they are when the variables are absent. This is
// measurement scaffolding, not a feature: nothing here runs on a normal launch.

export interface ExperimentConfiguration {
  id: string;
  description: string;
  paintWhenInitiallyHidden: boolean;
  backgroundThrottling: boolean;
}

export interface WindowOptions {
  paintWhenInitiallyHidden: boolean;
  backgroundThrottling: boolean;
}

export interface Cycle {
  index: number;
  shownAt: number;
  hiddenAt: number;
}

export type Attribution = 'exact' | 'reaction-window' | 'unattributed';

export interface Observation {
  observedAt: number;
  cycleIndex: number | null;
  attribution: Attribution;
}

export interface RunSummary {
  configurationId: string;
  cycleCount: number;
  blankFrameCount: number;
  blankCycles: number[];
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
    description: 'both expensive options off; forced repaint and background colour kept',
    paintWhenInitiallyHidden: false,
    backgroundThrottling: true,
  },
  {
    id: 'no-paint-when-hidden',
    description: 'compositing while hidden off, background throttling still disabled',
    paintWhenInitiallyHidden: false,
    backgroundThrottling: false,
  },
  {
    id: 'control',
    description: 'shipped configuration',
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

/**
 * Returns null for an unrecognised id so a typo can be reported rather than
 * silently measuring the shipped configuration under another name.
 */
export function readConfiguration(
  environment: Record<string, string | undefined>,
): ExperimentConfiguration | null {
  const requested = environment.WHATS_EXPERIMENT_CONFIG;
  if (requested === undefined || requested === '') {
    return shippedConfiguration();
  }
  return CONFIGURATIONS.find((configuration) => configuration.id === requested) ?? null;
}

export function resolveWindowOptions(
  environment: Record<string, string | undefined>,
): WindowOptions {
  const configuration = readConfiguration(environment) ?? shippedConfiguration();
  return {
    paintWhenInitiallyHidden: configuration.paintWhenInitiallyHidden,
    backgroundThrottling: configuration.backgroundThrottling,
  };
}

export function parseCycleCount(raw: string | undefined): number {
  if (raw === undefined) {
    return 0;
  }
  if (!/^\d+$/.test(raw.trim())) {
    return 0;
  }
  const count = Number(raw.trim());
  return count > 0 ? count : 0;
}

export function attributeObservations(cycles: Cycle[], observedAt: number[]): Observation[] {
  return observedAt.map((timestamp) => {
    const visible = cycles.find(
      (cycle) => timestamp >= cycle.shownAt && timestamp <= cycle.hiddenAt,
    );
    if (visible) {
      return { observedAt: timestamp, cycleIndex: visible.index, attribution: 'exact' as const };
    }

    const justHidden = cycles.find(
      (cycle) => timestamp > cycle.hiddenAt && timestamp - cycle.hiddenAt <= REACTION_WINDOW_MS,
    );
    if (justHidden) {
      return {
        observedAt: timestamp,
        cycleIndex: justHidden.index,
        attribution: 'reaction-window' as const,
      };
    }

    return { observedAt: timestamp, cycleIndex: null, attribution: 'unattributed' as const };
  });
}

export function summarizeRun(
  configurationId: string,
  cycles: Cycle[],
  observedAt: number[],
): RunSummary {
  const observations = attributeObservations(cycles, observedAt);
  const blankCycles = [
    ...new Set(
      observations
        .map((observation) => observation.cycleIndex)
        .filter((index): index is number => index !== null),
    ),
  ].sort((a, b) => a - b);

  return {
    configurationId,
    cycleCount: cycles.length,
    blankFrameCount: blankCycles.length,
    blankCycles,
    unattributedCount: observations.filter(
      (observation) => observation.attribution === 'unattributed',
    ).length,
    observations,
  };
}
