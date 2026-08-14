# Memory measurement

## Why two numbers

Every measurement here reports **both** summed RSS and summed PSS, because they
answer different questions and reporting only one is how this problem got
misdiagnosed in the first place.

- **Summed RSS (resident set size)** — the naive sum of resident memory across
  the process tree. **This is the figure a system monitor displays**, and it is
  what a user reacts to when they say the app is heavy. It double-counts pages
  shared between processes: Electron's processes share a large amount of
  mapped executable and framework memory, so this number is inflated.
- **Summed PSS (proportional set size)** — each page divided by the number of
  processes mapping it, so shared pages are counted once across the tree. This
  is the honest figure for how much the app actually pressures the machine.

A change that only moves RSS is changing what the user sees. A change that
moves PSS is changing real memory pressure. Record both, and say which one a
given claim rests on.

Per-process attribution accompanies both figures so a regression can be traced
to a specific process rather than to the tree as a whole.

## Running the harness

```bash
# sample the running app right now
npm run measure-memory

# sample at T+10s and T+60s, measured from the app's own start time
npm run measure-memory -- --at 10,60

# machine-readable, for recording a new baseline
npm run measure-memory -- --at 10,60 --json > run-1.json
```

The script reads `/proc` directly. It attaches to an **already-running**
instance and needs no rebuild, no debug port, and no code change to the app.
Because `--at` counts from the app's own start time (`/proc/<pid>/stat`), a
launch-and-measure run and an attach-to-running run report the same point in
the app's life.

It discovers the process tree by matching `argv[0]` against the installed
executable (`/opt/whats/whats` by default; override with `--exe`). Process
types come from each process's own `--type=` flag, which is Chromium's own
taxonomy, so the attribution matches how Electron accounts for its processes.

Linux only — it depends on `/proc/<pid>/smaps_rollup`, which is where the PSS
figure comes from. There is no portable way to get PSS without it.

### Why not Electron's `app.getAppMetrics()`

`getAppMetrics()` reports `workingSetSize` and `privateBytes` but no PSS, so
the proportional figure — the one that reflects real memory pressure — cannot
come from it on Linux. It also needs a live IPC channel into the app, which
would mean shipping measurement code in the binary and rebuilding to change
how measurement works. `/proc` avoids both problems and can attach to any
running build, including a released `.deb` a user is already running.

What that costs: `getAppMetrics()` can tie a renderer to its `webContents`,
so it could name *which* window or view a renderer belongs to. This harness
cannot — it reports a renderer's type and PID but not its identity. The open
"why are there two renderers with no window open?" question in the baseline is
exactly the kind of thing that gap makes harder. Adding an opt-in IPC probe
for renderer identity would be a reasonable follow-up; it is not needed to
track totals over time.

### Running against a dev build

Discovery matches `argv[0]` against `--exe`, which defaults to the installed
path `/opt/whats/whats`. An `electron-vite dev` run launches a different
binary, so it reports "No running processes found" until you pass the right
path. Find it while the dev app is running and pass it through:

```bash
pgrep -a electron | head          # read argv[0] of the dev process
npm run measure-memory -- --exe <that path>
```

Dev-build numbers are not comparable to the baseline, which was taken from a
packaged build with production bundles.

## Measurement protocol

A baseline is only comparable to another baseline taken the same way:

1. **Real profile, not a cold one.** An existing profile carries a large
   on-disk cache that inflates file-backed memory at startup, and that is the
   realistic condition. A freshly created profile measures a scenario no
   long-term user is in.
2. **`startMinimizedToTray` enabled, main window never opened.** This is the
   headline scenario users complain about.
3. **Three runs, averaged.** Each run quits any running instance, relaunches,
   and samples the fresh process tree.
4. **Readings at T+10s and T+60s.** The later reading catches the case where
   the app has not finished loading at 10 seconds and a change appears to win
   only because it was measured in a trough. In the recorded baseline memory
   *falls* between the two readings, so a change compared only at T+10s against
   a T+60s baseline would look better than it is.

## Baselines

- [`baseline-2026-08-14.md`](./baseline-2026-08-14.md) — v1.16.2, the first
  recorded baseline. Compare against this one.
