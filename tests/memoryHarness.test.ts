import { describe, it, expect } from 'vitest';
import {
  splitCmdline,
  classifyProcess,
  parseSmapsRollup,
  summarize,
  formatMebibytes,
  type ProcessSample,
} from '../src/main/memoryHarness';

describe('splitCmdline', () => {
  it('splits NUL-separated arguments', () => {
    expect(splitCmdline('/opt/whats/whats\0--type=renderer\0--lang=en-US\0')).toEqual([
      '/opt/whats/whats',
      '--type=renderer',
      '--lang=en-US',
    ]);
  });

  // Electron child processes write cmdline as one space-separated blob rather than
  // the NUL-separated form the kernel documents, so both shapes must parse.
  it('splits space-separated arguments', () => {
    expect(splitCmdline('/opt/whats/whats --type=gpu-process --use-gl=disabled')).toEqual([
      '/opt/whats/whats',
      '--type=gpu-process',
      '--use-gl=disabled',
    ]);
  });

  it('prefers NUL boundaries when a NUL-separated argument contains spaces', () => {
    expect(splitCmdline('/opt/whats/whats\0--title=My App\0')).toEqual([
      '/opt/whats/whats',
      '--title=My App',
    ]);
  });

  it('returns an empty list for an empty cmdline', () => {
    expect(splitCmdline('')).toEqual([]);
    expect(splitCmdline('\0')).toEqual([]);
  });

  it('ignores trailing whitespace', () => {
    expect(splitCmdline('/opt/whats/whats --type=zygote \n')).toEqual([
      '/opt/whats/whats',
      '--type=zygote',
    ]);
  });
});

describe('classifyProcess', () => {
  it('treats a process without --type as the browser process', () => {
    expect(classifyProcess(['/opt/whats/whats'])).toBe('browser');
  });

  it('reads the type flag', () => {
    expect(classifyProcess(['/opt/whats/whats', '--type=renderer'])).toBe('renderer');
    expect(classifyProcess(['/opt/whats/whats', '--type=gpu-process'])).toBe('gpu-process');
  });

  it('appends the utility sub-type so utility processes are distinguishable', () => {
    expect(
      classifyProcess([
        '/opt/whats/whats',
        '--type=utility',
        '--utility-sub-type=network.mojom.NetworkService',
      ]),
    ).toBe('utility:network.mojom.NetworkService');
  });

  it('reports a bare utility process when no sub-type is present', () => {
    expect(classifyProcess(['/opt/whats/whats', '--type=utility'])).toBe('utility');
  });

  it('distinguishes the sandboxed zygote from the unsandboxed one', () => {
    expect(classifyProcess(['/opt/whats/whats', '--type=zygote'])).toBe('zygote');
    expect(
      classifyProcess(['/opt/whats/whats', '--type=zygote', '--no-zygote-sandbox']),
    ).toBe('zygote:no-sandbox');
  });
});

describe('parseSmapsRollup', () => {
  const rollup = [
    '61cfe3fa4000-7ffdd4a97000 ---p 00000000 00:00 0 [rollup]',
    'Rss:              247924 kB',
    'Pss:              109075 kB',
    'Pss_Anon:          59868 kB',
    'Private_Clean:      1234 kB',
    'Swap:                  0 kB',
  ].join('\n');

  it('reads resident and proportional sizes in kibibytes', () => {
    const parsed = parseSmapsRollup(rollup);
    expect(parsed).toEqual({ residentKib: 247924, proportionalKib: 109075, swapKib: 0 });
  });

  it('does not confuse Pss_Anon with Pss', () => {
    expect(parseSmapsRollup(rollup)?.proportionalKib).toBe(109075);
  });

  it('returns null when the required fields are missing', () => {
    expect(parseSmapsRollup('Rss:  100 kB')).toBeNull();
    expect(parseSmapsRollup('')).toBeNull();
  });

  it('reads swap when it is non-zero', () => {
    const swapped = rollup.replace('Swap:                  0 kB', 'Swap:               512 kB');
    expect(parseSmapsRollup(swapped)?.swapKib).toBe(512);
  });
});

describe('summarize', () => {
  const samples: ProcessSample[] = [
    { pid: 1, processType: 'browser', residentKib: 247924, proportionalKib: 109075, swapKib: 0 },
    { pid: 2, processType: 'renderer', residentKib: 352560, proportionalKib: 283363, swapKib: 0 },
    { pid: 3, processType: 'gpu-process', residentKib: 108036, proportionalKib: 25062, swapKib: 0 },
  ];

  it('sums resident memory across the process tree', () => {
    expect(summarize(samples).totalResidentKib).toBe(708520);
  });

  it('sums proportional memory across the process tree', () => {
    expect(summarize(samples).totalProportionalKib).toBe(417500);
  });

  it('counts the sampled processes', () => {
    expect(summarize(samples).processCount).toBe(3);
  });

  it('orders per-process attribution by resident memory, largest first', () => {
    expect(summarize(samples).processes.map((process) => process.pid)).toEqual([2, 1, 3]);
  });

  it('groups repeated process types so renderers are attributable as a class', () => {
    const withTwoRenderers: ProcessSample[] = [
      ...samples,
      { pid: 4, processType: 'renderer', residentKib: 118216, proportionalKib: 57446, swapKib: 0 },
    ];
    const renderers = summarize(withTwoRenderers).byType.find(
      (row) => row.processType === 'renderer',
    );
    expect(renderers).toEqual({
      processType: 'renderer',
      count: 2,
      residentKib: 470776,
      proportionalKib: 340809,
    });
  });

  it('orders type groups by resident memory, largest first', () => {
    expect(summarize(samples).byType.map((row) => row.processType)).toEqual([
      'renderer',
      'browser',
      'gpu-process',
    ]);
  });

  // A process swapped out looks artificially cheap in RSS, so swap is summed
  // to keep a shrinking resident figure from reading as a genuine improvement.
  it('sums swap across the process tree', () => {
    const swapped: ProcessSample[] = [
      { pid: 1, processType: 'browser', residentKib: 100, proportionalKib: 50, swapKib: 128 },
      { pid: 2, processType: 'renderer', residentKib: 200, proportionalKib: 90, swapKib: 384 },
    ];
    expect(summarize(swapped).totalSwapKib).toBe(512);
  });

  it('handles an empty sample set without dividing by zero', () => {
    expect(summarize([])).toEqual({
      totalResidentKib: 0,
      totalProportionalKib: 0,
      totalSwapKib: 0,
      processCount: 0,
      processes: [],
      byType: [],
    });
  });
});

describe('formatMebibytes', () => {
  it('converts kibibytes to mebibytes with one decimal', () => {
    expect(formatMebibytes(247924)).toBe('242.1');
  });

  it('formats zero', () => {
    expect(formatMebibytes(0)).toBe('0.0');
  });
});
