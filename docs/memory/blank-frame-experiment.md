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

## One trial per app launch

`paintWhenInitiallyHidden` governs whether Chromium composites a window that
**has never been shown**. Its effect therefore exists only on a window's *first*
show.

An earlier version of this harness hid and showed one long-lived window ~30
times per configuration. That cannot detect the option at all: after the first
show the window has been presented, so every subsequent cycle measures a
scenario where the option no longer applies. It would have reported the cheap
configuration as sufficient on evidence that never tested the thing in question.

So each trial is one app launch: start hidden to tray, wait for the page to
load, perform exactly one show, then exit so the next launch gets a clean first
show. A configuration's result is the collection of those trials.

This also matches where the cost is paid. The option makes Chromium build a
compositor and paint a window that may never be shown — a startup cost, in
exactly the tray-resident scenario the [#42 baseline](./baseline-2026-08-14.md)
measures.

The trial calls the app's real `showMainWindow()`, so it exercises the same path
a user triggers, including the always-on-top raise that path performs on Wayland
and the shipped forced repaint rather than a copy of it.

## How blank frames are detected

**By eye.** This is a deliberate limitation forced by the platform.

The bug is a failure to *present* a composited frame to the Wayland surface, so
it must be observed on screen. Automated capture was not available:

- GNOME's Mutter on Wayland exposes only
  `org.gnome.Shell.Screenshot.InteractiveScreenshot`, which requires a user
  click per shot. The direct `Screenshot` method returns `AccessDenied` for
  unsandboxed callers.
- `grim` and similar tools are wlroots-only and do not work under Mutter.
- Electron's own `webContents.capturePage()` was rejected: it reads the
  renderer's surface rather than what the compositor actually put on screen, so
  it can miss exactly this failure mode — and calling it on a hidden or
  unpainted window itself forces compositing, perturbing the behaviour under
  test.

The run script prints each trial number as it launches; the observer watches the
screen and notes the numbers that showed a blank or white frame, then records
them once at the end. A number outside the trials that ran is rejected rather
than recorded, so a mistyped entry cannot become a false blank frame.

What this costs: human observation can miss a single-frame flash that a capture
would catch, and cannot be replayed. Counts here are a floor, not an exact
figure.

## Running it

Needs a packaged build at `/opt/whats/whats` containing this code, per the
protocol in [`README.md`](./README.md) — dev-build memory is not comparable to
the baseline. Requires `startMinimizedToTray` enabled, which the script checks:
the window must be unshown until the trial's show.

```bash
scripts/run-blank-frame-experiment.sh cheap-only 30
npm run record-blank-frames -- \
  --log docs/memory/blank-frame-<date>/cheap-only/trials.jsonl \
  --out docs/memory/blank-frame-<date>/cheap-only/summary.json
```

Repeat for `no-paint-when-hidden` and `control`. Each trial quits any running
instance, relaunches under the chosen configuration, shows the window 5s after
page load for 2.5s, then exits. Memory is captured at T+10s and T+60s on trial
3 only: every trial is an identical launch, so one reading per configuration is
representative and 30 would add half an hour per configuration.

Results land in `docs/memory/blank-frame-<date>/<config>/`.

## Results

Not yet run.

## Recommendation

Pending results.
