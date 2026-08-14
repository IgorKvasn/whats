#!/usr/bin/env node
// Reports resident (RSS) and proportional (PSS) memory for a running whats
// instance, with per-process attribution. Reads /proc directly so it works
// against an already-running app without a rebuild or a debug port.
//
// Usage:
//   node scripts/measure-memory.mjs                  sample once, now
//   node scripts/measure-memory.mjs --at 10,60       sample at T+10s and T+60s
//   node scripts/measure-memory.mjs --json           machine-readable output
//   node scripts/measure-memory.mjs --exe /opt/whats/whats
//
// --at counts from the app's own start time, not from when this script runs,
// so a launch-and-measure run and an attach-to-running run report the same
// point in the app's life.

import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  splitCmdline,
  classifyProcess,
  parseSmapsRollup,
  summarize,
  formatMebibytes,
} from '../src/main/memoryHarness.ts';

const DEFAULT_EXECUTABLE = '/opt/whats/whats';

async function readProcessIds() {
  const entries = await readdir('/proc');
  return entries.filter((entry) => /^\d+$/.test(entry)).map(Number);
}

async function readArgv(pid) {
  try {
    return splitCmdline(await readFile(`/proc/${pid}/cmdline`, 'utf8'));
  } catch {
    return null;
  }
}

async function sampleProcess(pid, processType) {
  let raw;
  try {
    raw = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8');
  } catch {
    // The process exited between discovery and sampling, or belongs to
    // another user; either way it cannot be attributed.
    return null;
  }
  const reading = parseSmapsRollup(raw);
  return reading ? { pid, processType, ...reading } : null;
}

async function collect(executable) {
  const pids = await readProcessIds();
  const samples = [];
  for (const pid of pids) {
    const argv = await readArgv(pid);
    if (!argv || argv[0] !== executable) {
      continue;
    }
    const sample = await sampleProcess(pid, classifyProcess(argv));
    if (sample) {
      samples.push(sample);
    }
  }
  return samples;
}

// Field 22 of /proc/<pid>/stat is starttime in clock ticks since boot. The
// comm field can contain spaces and parentheses, so parse after the last ')'.
async function readUptimeSeconds(pid) {
  const [stat, uptime] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile('/proc/uptime', 'utf8'),
  ]);
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const startTicks = Number(fields[19]);
  // USER_HZ, which /proc/<pid>/stat is denominated in. Effectively always 100
  // on Linux userspace; Node cannot read sysconf(_SC_CLK_TCK) without a native
  // addon, so a kernel built with a different USER_HZ would skew --at timing.
  const ticksPerSecond = 100;
  return Number(uptime.split(' ')[0]) - startTicks / ticksPerSecond;
}

function findBrowserPid(samples) {
  return samples.find((sample) => sample.processType === 'browser')?.pid ?? null;
}

function renderText(label, summary, elapsedSeconds) {
  const at = elapsedSeconds === null ? '' : ` at T+${Math.round(elapsedSeconds)}s`;
  console.log(`\n=== ${label}${at} ===`);
  console.log(
    `Summed resident (RSS):      ${formatMebibytes(summary.totalResidentKib)} MiB  ` +
      `<- the figure a system monitor displays`,
  );
  console.log(
    `Summed proportional (PSS):  ${formatMebibytes(summary.totalProportionalKib)} MiB  ` +
      `<- shared pages counted once`,
  );
  if (summary.totalSwapKib > 0) {
    console.log(
      `Summed swap:                ${formatMebibytes(summary.totalSwapKib)} MiB  ` +
        `<- swapped-out pages; resident figures understate real cost by this much`,
    );
  }
  console.log(`Processes: ${summary.processCount}`);

  console.log('\nBy process type:');
  for (const group of summary.byType) {
    console.log(
      `  ${group.processType.padEnd(38)} x${String(group.count).padEnd(3)} ` +
        `RSS ${formatMebibytes(group.residentKib).padStart(8)} MiB   ` +
        `PSS ${formatMebibytes(group.proportionalKib).padStart(8)} MiB`,
    );
  }

  console.log('\nPer process:');
  for (const process of summary.processes) {
    console.log(
      `  ${String(process.pid).padStart(7)}  ${process.processType.padEnd(38)} ` +
        `RSS ${formatMebibytes(process.residentKib).padStart(8)} MiB   ` +
        `PSS ${formatMebibytes(process.proportionalKib).padStart(8)} MiB`,
    );
  }
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function parseArguments(argv) {
  const options = { executable: DEFAULT_EXECUTABLE, at: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--exe') {
      options.executable = requireValue(argv, (index += 1), '--exe');
    } else if (argument === '--at') {
      options.at = requireValue(argv, (index += 1), '--at')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      if (options.at.length === 0) {
        throw new Error('--at needs at least one number of seconds, e.g. --at 10,60');
      }
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n`);
    console.error('Usage: npm run measure-memory -- [--at 10,60] [--json] [--exe <path>]');
    process.exitCode = 2;
    return;
  }

  const initial = await collect(options.executable);
  if (initial.length === 0) {
    console.error(
      `No running processes found for ${options.executable}.\n` +
        `Start the app first, or pass --exe with the correct path.`,
    );
    process.exitCode = 1;
    return;
  }

  const browserPid = findBrowserPid(initial);
  const readings = [];
  const targets = options.at.length > 0 ? options.at : [null];

  for (const target of targets) {
    let missedBy = null;
    if (target !== null) {
      const elapsed = browserPid === null ? 0 : await readUptimeSeconds(browserPid);
      const remaining = target - elapsed;
      if (remaining > 0) {
        await delay(remaining * 1000);
      } else {
        // The app was already older than the target when this run started, so
        // the reading is not comparable to a baseline taken at that target.
        missedBy = -remaining;
        console.error(
          `warning: T+${target}s had already passed when sampling began ` +
            `(app was ${elapsed.toFixed(1)}s old); this reading is not a valid T+${target}s sample.`,
        );
      }
    }
    const samples = await collect(options.executable);
    const elapsedSeconds = browserPid === null ? null : await readUptimeSeconds(browserPid);
    readings.push({
      target,
      elapsedSeconds,
      missedBy,
      summary: summarize(samples),
    });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          executable: options.executable,
          capturedAt: new Date().toISOString(),
          readings,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const reading of readings) {
    renderText(
      reading.target === null ? 'whats memory' : `whats memory T+${reading.target}s`,
      reading.summary,
      reading.elapsedSeconds,
    );
  }
}

await main();
