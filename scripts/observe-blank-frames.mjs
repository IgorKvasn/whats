#!/usr/bin/env node
// Records a human observer's blank-frame reports for the experiment in issue
// #43 and attributes each to a hide/show cycle.
//
// Screen capture is not available on a GNOME Wayland session without an
// interactive portal prompt per shot, so the frames are judged by eye. Press
// SPACE whenever the window shows a blank or white frame; press q when the app
// reports that its cycles are complete.
//
// Usage:
//   node scripts/observe-blank-frames.mjs --log <cycles.jsonl> --out <summary.json>

import { readFile, writeFile } from 'node:fs/promises';
import { summarizeRun } from '../src/main/blankFrameExperiment.ts';

function parseArguments(argv) {
  const options = { log: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--log') {
      options.log = argv[(index += 1)];
    } else if (argument === '--out') {
      options.out = argv[(index += 1)];
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.log || !options.out) {
    throw new Error('both --log and --out are required');
  }
  return options;
}

async function readCycleLog(path) {
  const raw = await readFile(path, 'utf8');
  const entries = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

  const start = entries.find((entry) => entry.kind === 'run-start');
  const cycles = entries
    .filter((entry) => entry.kind === 'cycle')
    .map(({ index, shownAt, hiddenAt }) => ({ index, shownAt, hiddenAt }));

  return { configurationId: start?.configurationId ?? 'unknown', cycles };
}

function collectKeypresses() {
  return new Promise((resolve) => {
    const observedAt = [];
    // Raw mode delivers each key immediately, so a report is timestamped when
    // the frame was seen rather than when Enter was pressed. It needs a TTY;
    // when stdin is a pipe, fall back to line-buffered input.
    const isTerminal = typeof process.stdin.setRawMode === 'function' && process.stdin.isTTY;
    if (isTerminal) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    console.log('Recording. SPACE = blank frame seen.  q = finish.\n');

    const finish = () => {
      if (isTerminal) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve(observedAt);
    };

    process.stdin.on('data', (chunk) => {
      for (const key of chunk) {
        if (key === ' ') {
          observedAt.push(Date.now());
          console.log(`  blank frame reported (${observedAt.length} so far)`);
        } else if (key === 'q' || key === '') {
          // Ctrl-C must still finish the run in raw mode, where the terminal no
          // longer translates it into SIGINT for us.
          finish();
          return;
        }
      }
    });

    process.stdin.on('end', finish);
  });
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n`);
    console.error('Usage: node scripts/observe-blank-frames.mjs --log <cycles.jsonl> --out <summary.json>');
    process.exitCode = 2;
    return;
  }

  const observedAt = await collectKeypresses();

  const { configurationId, cycles } = await readCycleLog(options.log);
  if (cycles.length === 0) {
    console.error(`\nNo cycles found in ${options.log}. Did the app run with WHATS_BLANK_CYCLES set?`);
    process.exitCode = 1;
    return;
  }

  const summary = summarizeRun(configurationId, cycles, observedAt);
  await writeFile(options.out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`\n=== ${summary.configurationId} ===`);
  console.log(`Cycles:              ${summary.cycleCount}`);
  console.log(`Blank frames:        ${summary.blankFrameCount}`);
  console.log(`Blank cycles:        ${summary.blankCycles.join(', ') || '(none)'}`);
  if (summary.unattributedCount > 0) {
    console.log(
      `Unattributed presses: ${summary.unattributedCount}  ` +
        `<- landed outside any cycle; record is incomplete`,
    );
  }
  console.log(`\nWritten to ${options.out}`);
}

await main();
