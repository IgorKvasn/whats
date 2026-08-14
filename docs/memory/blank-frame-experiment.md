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

## What this experiment does not cover

The ticket asked for "~30 hide/show cycles each". These are 30 **first shows**
per configuration, one per launch, for the reason above: cycling one window
cannot test `paintWhenInitiallyHidden` at all. That is the right call for the
option under test, but it narrows coverage in a way worth stating plainly.

The repeat-show path — hide an already-shown window, show it again — is
**untested by every configuration here**. If the original blank frames were seen
on ordinary shows rather than the first show after launch, this experiment did
not exercise the failing path, which is a second and independent reason its null
result cannot clear the cheap configuration. `backgroundThrottling` in particular
applies to a hidden window whether or not it has been shown before, so it is
testable by cycling; only `paintWhenInitiallyHidden` requires a fresh launch. A
follow-up could separate the two on that basis.

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

Repeat for `no-paint-when-hidden` and `control`. Each trial relaunches the app
under the chosen configuration, shows the window 5s after page load for 2.5s,
then exits.

Memory is captured once per configuration, in its own launch after the trials.
It cannot be taken inside a trial: a trial lives ~9s, so it dies before the
T+10s reading and never reaches T+60s. The memory launch omits the trial
variable, which leaves the trial hook inert and the app tray-resident — the same
scenario the [#42 baseline](./baseline-2026-08-14.md) measures, and where these
options actually cost their memory. One reading per configuration is enough
because every launch under a configuration is identical.

Results land in `docs/memory/blank-frame-<date>/<config>/`.

## Results

Run 2026-08-14 on GNOME/Mutter Wayland, packaged build 1.16.2, 30 trials per
configuration, 90 trials total. Every trial showed a window; none was skipped.
Frames judged by eye by the maintainer, live against per-trial markers.

| configuration | trials | blank frames | RSS / PSS @T+10s | RSS / PSS @T+60s |
|---|---|---|---|---|
| `cheap-only` | 30 | **0** | 978 / 490 MiB | 990 / 496 MiB |
| `no-paint-when-hidden` | 30 | **0** | 1046 / 541 MiB | 1007 / 500 MiB |
| `control` (shipped) | 30 | **0** | 1146 / 639 MiB | 1034 / 525 MiB |

Raw data in `blank-frame-20260814/<config>/` — `trials.jsonl`, `summary.json`,
`memory.json`. The per-trial `app-*.log` launch logs are written there too but
are not committed: a repo-wide `*.log` ignore rule excludes them.

### The bug did not reproduce

**The control showed zero blank frames.** The control is the shipped
configuration, the one carrying all four remedies, so zero blanks there is
expected — but it also means the experiment never made the bug appear under
*any* configuration, including the one with both expensive options removed.

That is the finding, and it is a null result. The three configurations are
indistinguishable on the outcome that matters. Nothing here shows the cheap
configuration is safe; it shows only that 30 trials did not reproduce an
intermittent bug whose base rate was never established. Issue #43 assumed the
configurations could be separated by counting blanks, which holds only if the
bug reproduces in the control at some usable rate. It did not.

With zero events observed in 30 trials, the per-show blank rate is below roughly
10% at 95% confidence (rule of three). A bug rare enough to sit under that
bound — plausible for something described as intermittent — would produce
exactly these three clean runs whether or not the expensive options do anything.
This experiment cannot distinguish "the cheap remedies are sufficient" from
"the bug simply did not fire".

### What the memory numbers do and don't say

The memory ordering is consistent and in the predicted direction —
`cheap-only` < `no-paint-when-hidden` < `control`, about **168 MiB RSS / 149 MiB
PSS** apart at T+10s — so the expensive options do cost real memory. But these
are single readings per configuration, not repeated samples, and Chromium
startup memory is noisy: the T+60s spread (990 / 1007 / 1034 MiB RSS) is a third
of the T+10s spread, which is itself a sign of how much of the gap is startup
transient rather than steady state. Treat the direction as credible and the
magnitude as indicative only.

Where the gap actually sits, by process type at T+10s (RSS MiB):

| process type | `cheap-only` | `no-paint-when-hidden` | `control` | delta |
|---|---|---|---|---|
| renderer | 429 | 468 | 566 | **+137** |
| browser | 225 | 242 | 242 | +17 |
| gpu-process | 102 | 104 | 104 | +2 |
| network service | 86 | 90 | 90 | +4 |
| zygote (both) | 121 | 127 | 128 | +7 |
| broker | 16 | 16 | 16 | 0 |

**The GPU process is flat — ~102-104 MiB in all three**, including `cheap-only`
with `paintWhenInitiallyHidden: false`. The ticket's stated cost rationale was a
GPU process holding real memory to composite a never-shown window; that cost
does not appear in the data, consistent with remedy 3 being a no-op.

The 168 MiB gap is **renderer memory, 137 MiB of it**, and it tracks
`backgroundThrottling` rather than `paintWhenInitiallyHidden`: the only step that
moves the renderer materially is `no-paint-when-hidden` → `control` (+98 MiB),
which is exactly where throttling is disabled. An unthrottled hidden renderer
keeping timers and compositing work alive is a plausible mechanism, and it means
the memory argument for changing anything rests on remedy 4, not remedy 3.

Single readings, so treat these as one observation apiece rather than
established magnitudes — but the attribution to the renderer is large enough to
survive the noise.

## Recommendation

**Change nothing. Keep the shipped configuration.**

Not because the expensive options were shown to be required — they weren't —
but because nothing was shown either way, and this ticket explicitly does not
change what ships. The ticket allows for "both options are still required" as an
outcome; the actual outcome is weaker still: *undetermined*.

Recommending `cheap-only` on this data would mean removing a remedy from a fix
for an intermittent bug on the strength of an experiment that never observed the
bug once. The memory saving is real but modest against that risk.

To actually settle it, the missing piece is the control's blank rate:

- Establish that the bug reproduces at all under the *pre-`c3057c4`*
  configuration — no forced repaint, no background colour, both expensive
  options off. If it will not reproduce there, no A/B on 30 trials can work, and
  the question should be closed as unfalsifiable with the current method rather
  than re-run at greater length.
- If it does reproduce, measure its rate there, then size the runs from that
  rate. Separating configurations at a 5% base rate needs hundreds of trials per
  configuration, not 30 — which in turn needs automated frame capture, since
  that is far past what eye observation can sustain.
- Worth testing first: whether the forced repaint alone (remedy 1, cheap) is
  what fixed it. That is the hypothesis this experiment was not built to test,
  since all three configurations here keep it.
- Cover the repeat-show path too (see "What this experiment does not cover"). A
  hide/show cycle cannot test `paintWhenInitiallyHidden`, but it can test
  `backgroundThrottling` — which is where the memory cost actually is — so the
  two remedies are separable by method as well as by cost.

Also note remedy 3 is inert regardless: `paintWhenInitiallyHidden: true` sets
Electron's own default, so the shipped line can be deleted as dead
configuration whenever convenient, independent of any of the above.
