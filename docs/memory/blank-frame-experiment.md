# Which part of the blank-window repaint fix is required

Issue [#43](https://github.com/IgorKvasn/whats/issues/43). Commit `c3057c4`
fixed an intermittent blank/white main window on show by applying four remedies
at once:

1. a forced repaint after show (`webContents.invalidate()`) — cheap
2. a dark `backgroundColor` — cheap
3. `paintWhenInitiallyHidden: true` — intended to keep the page compositing while hidden
4. `backgroundThrottling: false` — keeps the renderer unthrottled while hidden

Because all four landed together, which one fixed the bug was unknown. This
experiment isolates the two expensive ones.

**This document does not change the shipped configuration.** Acting on the
recommendation is deliberately a separate change.

## Finding that reshaped the experiment

`paintWhenInitiallyHidden` **defaults to `true` in Electron**
([BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window)).
The shipped `paintWhenInitiallyHidden: true` is therefore a no-op: it sets what
Chromium was already doing.

Two consequences:

- Remedy 3 cannot have contributed to the fix, and removing the line cannot
  save any memory. The line is documentation of intent, nothing more.
- The ticket's configuration 2, "only the compositing-while-hidden option
  removed", would as literally worded be identical to the control. To actually
  disable compositing while hidden the option must be set to **`false`**, which
  is what the configurations below do. Setting it to `false` also suppresses the
  `ready-to-show` event; nothing in this app listens for it (`rg 'ready-to-show'
  src/` finds nothing), so it is safe to test here.

## Configurations compared

All three keep the two cheap remedies — the forced repaint and the background
colour — so only the expensive options vary.

| id | `paintWhenInitiallyHidden` | `backgroundThrottling` | meaning |
|---|---|---|---|
| `cheap-only` | `false` | `true` | both expensive options off |
| `no-paint-when-hidden` | `false` | `false` | only compositing-while-hidden off |
| `control` | `true` | `false` | shipped configuration |

`backgroundThrottling: true` is Chromium's default, so `cheap-only` is "neither
expensive option applied".

Selection is by environment variable, so one packaged build exercises all three
and the shipped defaults are untouched when the variables are absent:

```bash
WHATS_EXPERIMENT_CONFIG=cheap-only /opt/whats/whats
```

An unrecognised value logs a warning and falls back to the shipped
configuration rather than silently measuring the wrong thing.

## How blank frames are detected

**By eye.** This is a deliberate limitation forced by the platform.

The bug is a failure to *present* a composited frame to the Wayland surface, so
it must be observed on screen. Automated capture was not available:

- GNOME's Mutter on Wayland exposes only
  `org.gnome.Shell.Screenshot.InteractiveScreenshot`, which requires a user
  click per shot. The direct `Screenshot` method returns
  `AccessDenied` for unsandboxed callers.
- `grim` and similar tools are wlroots-only and do not work under Mutter.
- Electron's own `webContents.capturePage()` was rejected: it reads the
  renderer's surface rather than what the compositor actually put on screen, so
  it can miss exactly this failure mode — and calling it on a hidden or
  unpainted window itself forces compositing, perturbing the behaviour under
  test.

So the harness drives the cycles and the observer watches. `scripts/run-blank-frame-experiment.sh`
hides and shows the window on a fixed schedule, logging when each cycle was on
screen; the observer presses SPACE on any blank or white frame, and
`scripts/observe-blank-frames.mjs` attributes each keypress to the cycle that
was visible at that moment.

A keypress landing up to 1s after a cycle is hidden is still attributed to that
cycle, to absorb reaction time. A keypress that matches no cycle is reported as
`unattributedCount` rather than dropped, so an incomplete record cannot be
mistaken for a clean run.

What this costs: human observation can miss a single-frame flash that a capture
would catch, and cannot be replayed. Counts here are a floor, not an exact
figure.

## Running it

Needs a packaged build at `/opt/whats/whats` containing this code, per the
protocol in [`README.md`](./README.md) — dev-build memory is not comparable to
the baseline.

```bash
scripts/run-blank-frame-experiment.sh cheap-only 30
scripts/run-blank-frame-experiment.sh no-paint-when-hidden 30
scripts/run-blank-frame-experiment.sh control 30
```

Each run quits any running instance, relaunches under the chosen
configuration, captures memory at T+10s and T+60s, waits 10s after page load,
then runs the cycles (2.5s visible, 1.5s hidden). Watch the window; press SPACE
for any blank frame, then `q` when the app logs `cycles complete`. Results land
in `docs/memory/blank-frame-<date>/<config>/`.

## Results

Not yet run. See [`RESULTS.md`](#) once the runs are complete.

## Recommendation

Pending results.
