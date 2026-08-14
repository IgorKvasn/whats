export interface RollupReading {
  residentKib: number;
  proportionalKib: number;
  swapKib: number;
}

export interface ProcessSample extends RollupReading {
  pid: number;
  processType: string;
}

export interface TypeGroup {
  processType: string;
  count: number;
  residentKib: number;
  proportionalKib: number;
}

export interface MemorySummary {
  totalResidentKib: number;
  totalProportionalKib: number;
  totalSwapKib: number;
  processCount: number;
  processes: ProcessSample[];
  byType: TypeGroup[];
}

/**
 * Electron's own child processes write /proc/<pid>/cmdline as a single
 * space-separated string instead of the NUL-separated form the kernel
 * documents, so arguments containing spaces only survive in the NUL case.
 */
export function splitCmdline(raw: string): string[] {
  const trimmed = raw.replace(/\0+$/, '').trim();
  if (trimmed === '') {
    return [];
  }
  if (trimmed.includes('\0')) {
    return trimmed.split('\0').filter((argument) => argument !== '');
  }
  return trimmed.split(/\s+/);
}

export function classifyProcess(argv: string[]): string {
  const type = readFlag(argv, '--type') ?? 'browser';
  if (type === 'utility') {
    const subType = readFlag(argv, '--utility-sub-type');
    return subType ? `utility:${subType}` : 'utility';
  }
  if (type === 'zygote' && argv.includes('--no-zygote-sandbox')) {
    return 'zygote:no-sandbox';
  }
  return type;
}

function readFlag(argv: string[], name: string): string | null {
  const prefix = `${name}=`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export function parseSmapsRollup(raw: string): RollupReading | null {
  const resident = readRollupField(raw, 'Rss');
  const proportional = readRollupField(raw, 'Pss');
  if (resident === null || proportional === null) {
    return null;
  }
  return {
    residentKib: resident,
    proportionalKib: proportional,
    swapKib: readRollupField(raw, 'Swap') ?? 0,
  };
}

function readRollupField(raw: string, field: string): number | null {
  // Anchored so Pss does not match Pss_Anon, Pss_Dirty, or Pss_Shmem.
  const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm').exec(raw);
  return match ? Number(match[1]) : null;
}

export function summarize(samples: ProcessSample[]): MemorySummary {
  const groups = new Map<string, TypeGroup>();
  for (const sample of samples) {
    const existing = groups.get(sample.processType);
    if (existing) {
      existing.count += 1;
      existing.residentKib += sample.residentKib;
      existing.proportionalKib += sample.proportionalKib;
    } else {
      groups.set(sample.processType, {
        processType: sample.processType,
        count: 1,
        residentKib: sample.residentKib,
        proportionalKib: sample.proportionalKib,
      });
    }
  }

  return {
    totalResidentKib: sum(samples, (sample) => sample.residentKib),
    totalProportionalKib: sum(samples, (sample) => sample.proportionalKib),
    totalSwapKib: sum(samples, (sample) => sample.swapKib),
    processCount: samples.length,
    processes: [...samples].sort((a, b) => b.residentKib - a.residentKib),
    byType: [...groups.values()].sort((a, b) => b.residentKib - a.residentKib),
  };
}

function sum<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

export function formatMebibytes(kibibytes: number): string {
  return (kibibytes / 1024).toFixed(1);
}
