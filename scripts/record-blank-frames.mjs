#!/usr/bin/env node
// Records which trials showed a blank frame, given their numbers after a
// configuration has finished running (issue #43).
//
// No live terminal session is needed during the run: the observer watches the
// screen and notes the trial numbers the run script prints, then passes them
// here with --blank, or omits it to be prompted.
//
// Usage:
//   npm run record-blank-frames -- --log <trials.jsonl> --out <summary.json> --blank "4 17 23"
//   npm run record-blank-frames -- --log <trials.jsonl> --out <summary.json> --blank none

import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseReportedTrials, summarizeReportedTrials } from './blank-frame-experiment/blankFrameExperiment.ts';

function parseArguments(argv) {
  const options = { log: null, out: null, blank: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--log') {
      options.log = argv[(index += 1)];
    } else if (argument === '--out') {
      options.out = argv[(index += 1)];
    } else if (argument === '--blank') {
      options.blank = argv[(index += 1)] ?? '';
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.log || !options.out) {
    throw new Error('both --log and --out are required');
  }
  return options;
}

async function readTrialLog(path) {
  const raw = await readFile(path, 'utf8');
  const trials = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.kind === 'trial');

  return {
    configurationId: trials[0]?.configurationId ?? 'unknown',
    trials: trials.map(({ index, shownAt, hiddenAt }) => ({ index, shownAt, hiddenAt })),
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n`);
    console.error(
      'Usage: npm run record-blank-frames -- --log <trials.jsonl> --out <summary.json> [--blank "4 17"]',
    );
    process.exitCode = 2;
    return;
  }

  const { configurationId, trials } = await readTrialLog(options.log);
  if (trials.length === 0) {
    console.error(`No trials found in ${options.log}. Did the app run with WHATS_BLANK_TRIAL set?`);
    process.exitCode = 1;
    return;
  }

  console.log(`${configurationId}: ${trials.length} trials ran (1-${trials.length}).`);

  let answer = options.blank;
  if (answer === null) {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    answer = await readline.question(
      'Which trials showed a blank or white frame? (numbers, or blank for none): ',
    );
    readline.close();
  }
  // "none" reads more clearly than an empty string in a scripted invocation.
  if (answer.trim().toLowerCase() === 'none') {
    answer = '';
  }

  const reported = parseReportedTrials(answer, trials.length);
  if (reported.rejected.length > 0) {
    console.error(
      `\nNot recorded, outside trials 1-${trials.length} or not a number: ` +
        `${reported.rejected.join(', ')}`,
    );
    console.error('Re-run with corrected numbers; nothing was written.');
    process.exitCode = 1;
    return;
  }

  const summary = summarizeReportedTrials(configurationId, trials, reported.trials);
  await writeFile(options.out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`\n=== ${summary.configurationId} ===`);
  console.log(`Trials:       ${summary.trialCount}`);
  console.log(`Blank frames: ${summary.blankFrameCount}`);
  console.log(`Blank trials: ${summary.blankTrials.join(', ') || '(none)'}`);
  console.log(`\nWritten to ${options.out}`);
}

await main();
