# Linux presence signals for phone handoff

Research for [#87](https://github.com/IgorKvasn/whats/issues/87), part of map [#84](https://github.com/IgorKvasn/whats/issues/84).
Terms follow `CONTEXT.md` (Desktop attended, Desktop away, Heartbeat).

**Question:** On Electron 44 / Linux (GNOME and KDE, X11 and Wayland), which signals reliably report lock/unlock,
idle, suspend/resume and shutdown, and can `whats` finish one outbound HTTPS request on shutdown or suspend?

Versions examined: Electron `v44.4.5` (the pinned version), its Chromium `152.0.7977.130`, systemd `main`,
gnome-shell `main`, KWin/kscreenlocker `master`, NetworkManager `main`, `@homebridge/dbus-native` 0.7.9 (installed).

Legend: **[V]** verified against the cited source (or observed on a live system, stated as such).
**[U]** unconfirmed: plausible, not verified here.

## TL;DR

- **Lock/unlock:** Electron's `lock-screen`/`unlock-screen` events are **not available on Linux** [V]. Use the
  logind session `LockedHint` property (set by both GNOME Shell and KDE kscreenlocker; emits `PropertiesChanged`
  on the system bus) as the primary signal. `ActiveChanged` on `org.gnome.ScreenSaver` / `org.freedesktop.ScreenSaver`
  is a secondary signal: it also fires for the blank-without-lock "shield", which is fine for "away".
- **Idle:** `powerMonitor.getSystemIdleTime()` works on GNOME (X11 + Wayland) and KDE (X11 + Wayland) and must be
  **polled** (no event). On other Wayland compositors (sway, Hyprland, ...) it returns 0 forever [V].
  `getSystemIdleState()` also reports `locked` on Linux through the ScreenSaver D-Bus watcher [V].
- **Suspend/resume:** `powerMonitor` `suspend`/`resume` work on Linux via logind `PrepareForSleep` [V]. Electron
  releases its sleep delay lock **immediately after the synchronous `suspend` emit**, so an async request started
  in the handler is unprotected, and NetworkManager starts taking interfaces down on the same signal [V].
  A final `away` on suspend is best effort only.
- **Shutdown:** `powerMonitor` `shutdown` works on Linux [V]. With `e.preventDefault()` Electron holds a logind
  shutdown delay lock until the process exits, and the network is still up at that point [V], so one short request
  (timeout ≤ ~3 s; default `InhibitDelayMaxSec` is 5 s) is **feasible but not guaranteed**.
- **Design consequence:** the map's premise stands. The heartbeat timeout on the phone is the correctness
  mechanism; the explicit `away` is a fast path that will usually work on lock/idle/shutdown and only sometimes
  on suspend.

## Signal matrix

Rows are events, columns are session types. "Electron API" is what `powerMonitor` gives without extra code;
"D-Bus" is what `whats` can subscribe to itself via `@homebridge/dbus-native` (signals and properties work; see
the fd caveat below).

| Event | GNOME Wayland | GNOME X11 | KDE Plasma Wayland | KDE Plasma X11 | Other Wayland (sway etc.) |
|---|---|---|---|---|---|
| Lock / unlock: Electron `lock-screen`/`unlock-screen` | No (macOS/Windows only) [V1] | No [V1] | No [V1] | No [V1] | No [V1] |
| Lock / unlock: logind `Session.LockedHint` (PropertiesChanged) | Yes, gnome-shell calls `SetLockedHint` [V6] | Yes [V6] | Yes, kscreenlocker calls `SetLockedHint` [V7] | Yes [V7] | Only if the locker calls it (swaylock does not by itself) [U] |
| Lock / blank: `ActiveChanged(b)` | `org.gnome.ScreenSaver` [V5] | same [V5] | `org.freedesktop.ScreenSaver` [V7] | same [V7] | Usually none [U] |
| Lock (polled): `getSystemIdleState(t) === 'locked'` | Yes, via ScreenSaver watcher [V3] | Yes [V3] | Yes [V3] | Yes [V3] | Only if one of the 5 known ScreenSaver services exists [V3] |
| Idle: `getSystemIdleTime()` (poll) | Yes, `org.gnome.Mutter.IdleMonitor` (5 s granularity, 0 during init) [V4] | Yes, XScreenSaver ext [V4] | Yes, `org_kde_kwin_idle` (still served by KWin) [V4][V8] | Yes, XScreenSaver ext [V4] | **No: always 0** (Chromium does not use `ext-idle-notify-v1`) [V4] |
| Idle: logind `IdleHint` | Set by gnome-session [V9] | Set by gnome-session [V9] | Not found in KDE sources [U] | [U] | [U] |
| Suspend / resume: `powerMonitor` `suspend`/`resume` | Yes, logind `PrepareForSleep` [V2] | Yes [V2] | Yes [V2] | Yes [V2] | Yes, any logind system [V2] |
| Shutdown / reboot: `powerMonitor` `shutdown` | Yes, logind `PrepareForShutdown` [V1][V2] | Yes | Yes | Yes | Yes |
| Logout / app killed: `before-quit` via SIGTERM | Yes for SIGTERM [V10]; Wayland-disconnect ordering at logout [U] | [U] | [U] | [U] | [U] |

Electron 44 runs as a native Wayland client in Wayland sessions (`--ozone-platform=auto` default since 38, and
`electron-builder.yml` passes `--ozone-platform-hint=auto`) [V11], so the Wayland column is the one that matters on
current GNOME/KDE.

Live check on the author's machine (Ubuntu, GNOME Shell 50.1, Wayland, systemd 259) [V, observed]:
`org.gnome.ScreenSaver` is owned by a separate `gjs .../org.gnome.ScreenSaver` service (a proxy forwarding
`ActiveChanged` from gnome-shell [V5]); `org.freedesktop.ScreenSaver` is owned by `gsd-screensaver` and answers
`GetActive` with `NotSupported` (Chromium handles this by moving on to the next service [V3]);
`org.gnome.Mutter.IdleMonitor.GetIdletime` works; session `LockedHint` and `IdleHint` are `emits-change`;
`systemd-inhibit --list` shows another Electron app (`teams-for-linux`) holding the
`sleep / delay / "Application cleanup before suspend"` lock that Electron's powerMonitor takes, plus
`NetworkManager: sleep / delay / "NetworkManager needs to turn off networks"`.

## How the Electron pieces actually behave (Electron 44.4.5)

- `powerMonitor` only starts its native monitor once the first listener is added. On Linux it then subscribes to
  logind `PrepareForSleep` and `PrepareForShutdown` on the system bus and takes a **sleep delay inhibitor**
  (`who` = executable name, `why` = "Application cleanup before suspend") [V2][V12].
- On `PrepareForSleep(true)` it emits `suspend` **and then releases the sleep lock right away**; it re-takes the lock
  on `PrepareForSleep(false)` and emits `resume` [V2]. Nothing in the API lets JS extend the sleep lock.
- A shutdown delay lock is only taken while there is at least one `shutdown` listener [V12]. On
  `PrepareForShutdown(true)` it emits `shutdown`; if no listener called `preventDefault()`, the lock is released.
  If one did, **the lock is kept until the process exits** (fd closed) or the last listener is removed [V2].
  The docs say the app "should exit as soon as possible by calling something like `app.quit()`" [V1].
- `getSystemIdleState(threshold)` = `locked` if the ScreenSaver watcher says locked, else `idle` if
  `getSystemIdleTime() >= threshold`, else `active` [V3].
- SIGTERM/SIGINT/SIGHUP are turned into a graceful quit on the main thread (one shot; a second signal kills) [V10].
  That is what makes `before-quit` fire at poweroff, as `src/main/tray.ts` already relies on.

## Recommended detection approach

1. **Lock/unlock (event-driven):** on the **system bus**, read `org.freedesktop.login1.User.Display` of
   `/org/freedesktop/login1/user/self` to get the real session object path (signals are *not* emitted on the
   `session/self` / `session/auto` aliases [V13]), then subscribe to `org.freedesktop.DBus.Properties.PropertiesChanged`
   on that path and watch `LockedHint`. Read the initial value with `Get`.
   Fallback when `LockedHint` never changes (unknown DE): subscribe to `ActiveChanged` on the first of
   `org.gnome.ScreenSaver`, `org.freedesktop.ScreenSaver` (calling `GetActive` first and skipping services that
   answer `NotSupported`, as Chromium does [V3]).
   Note: `whats` currently only uses `sessionBus()` from `dbus-native`; `systemBus()` is the declared export [V, local
   source `src/main/notifications.ts`].
2. **Idle (polled):** poll `powerMonitor.getSystemIdleTime()` on the same timer as the heartbeat or more often
   (e.g. every 10–15 s). Treat "always 0 for a long time on Wayland outside GNOME/KDE" as "idle unknown", not as
   "active forever"; whether to fall back to logind `IdleHint` there is a design decision.
   `getSystemIdleState(t)` can replace both checks in one call, but it gives no events, so lock would only be noticed
   on the next poll; keep the `LockedHint` subscription for a fast `away`.
3. **Suspend/resume:** `powerMonitor.on('suspend')` → stop the heartbeat and fire `away` without awaiting;
   `on('resume')` → re-evaluate attended state (the phone will likely already have timed out). Registering the
   listener makes Electron take the sleep delay lock automatically.
4. **Shutdown:** `powerMonitor.on('shutdown', e => { e.preventDefault(); sendAway({ timeoutMs: ~3000 }).finally(() => app.quit()) })`.
   This must cooperate with `installHideToTray` (`app.quit()` sets `isQuitting` via `before-quit`, so the close
   goes through).
5. **Quit/SIGTERM/logout:** in `before-quit`, call `event.preventDefault()` once, send `away` with a short timeout,
   then `app.quit()` again (guard against loops). Fallback covers logout without shutdown.

Avoid: Electron `lock-screen`/`unlock-screen` (no-ops on Linux); relying on `ext-idle-notify-v1` through Electron
(not used by Chromium 152); calling logind `Inhibit` via `dbus-native` (see below).

## Can one HTTPS request finish on shutdown or suspend?

### Shutdown / reboot: feasible, bounded, not guaranteed

- logind sends `PrepareForShutdown(true)` "right before" the system goes down, and delay locks hold the operation
  until released or `InhibitDelayMaxSec` passes; default **5 s** [V13][V14][V15]. Distros may raise it (the test
  machine has a 30 s drop-in from `unattended-upgrades`) [V, observed], but code must assume 5 s.
- During that window `poweroff.target` has not started, so system services including NetworkManager are still up.
  On the later systemd stop phase, session scopes are ordered after `systemd-user-sessions.service`, which is
  `After=network.target`, so user sessions are stopped **before** the network goes down [V, observed unit
  ordering]. NetworkManager's own `PrepareForShutdown` handler only takes a device down when
  `connection.down-on-poweroff` is set, and the default is no [V16].
- Unverified risks [U]: (a) desktop-initiated poweroff on GNOME Wayland may end the session (compositor exit)
  before or while logind emits `PrepareForShutdown`, which could kill the app's display connection before the request
  finishes; (b) DNS + TLS handshake on a cold connection can approach a few seconds on bad networks; (c) a
  user-scoped VPN may be torn down earlier. Mitigation: keep the HTTPS connection warm from the heartbeat
  (keep-alive), send `away` without waiting for anything else, and cap at ~3 s.

### Suspend / lid close: best effort only

- Electron drops its own sleep lock synchronously after emitting `suspend` [V2], so the request is not protected
  by `whats`' lock. Suspend still waits for other delay locks (GNOME screen lock, NetworkManager, UPower, ...) up to
  `InhibitDelayMaxSec` [V, observed inhibitor list], which in practice gives a short window.
- NetworkManager reacts to the same `PrepareForSleep(true)` by taking down every non-Wake-on-LAN hardware device
  while holding its own delay lock [V16]. Our request therefore **races with network teardown**.
- Taking our own delay lock is not possible with the current dependency: `@homebridge/dbus-native` 0.7.9 neither
  negotiates `NEGOTIATE_UNIX_FD` nor marshals type `h`, and `Inhibit` returns an fd (`ssss` → `h`) [V, local
  source + live introspection]. The workaround would be spawning `systemd-inhibit --what=sleep --mode=delay ...`
  as a child process and killing it after the request. Even then, the NetworkManager race remains, so it is not
  worth the complexity unless prototyping shows a real gain.
- Conclusion: send `away` on `suspend` fire-and-forget; rely on the phone's missed-heartbeat timeout
  (~3 × 60 s) for correctness, exactly as the map already assumes.

### Crash / power loss / SIGKILL

No signal at all. Heartbeat timeout only.

## Open points for the spec (not resolved here)

- Prototype to measure, on GNOME Wayland and KDE Wayland: order and timing of `PrepareForShutdown`, SIGTERM and
  Wayland disconnect on desktop-initiated poweroff and on logout; and how often a fire-and-forget `away` on
  `suspend` reaches the endpoint.
- Whether `IdleHint` (GNOME sets it after the session idle delay) is useful as a non-polled idle source.
- Behaviour when `whats` is not inside a logind session (e.g. started from a terminal in a container) —
  `user/self` `Display` still resolves the graphical session [V, observed], but this needs a guard.

## Sources

- [V1] Electron 44.4.5 `powerMonitor` docs: https://github.com/electron/electron/blob/v44.4.5/docs/api/power-monitor.md
- [V2] Electron Linux power observer: https://github.com/electron/electron/blob/v44.4.5/shell/browser/lib/power_observer_linux.cc
  and https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_power_monitor.cc
- [V3] Chromium 152 idle/lock on Linux (ScreenSaver services list, `GetActive` probe, `CalculateIdleState`):
  https://github.com/chromium/chromium/blob/152.0.7977.130/ui/base/idle/idle_linux.cc,
  https://github.com/chromium/chromium/blob/152.0.7977.130/ui/base/idle/idle.cc
- [V4] Chromium 152 idle time providers: Wayland
  https://github.com/chromium/chromium/blob/152.0.7977.130/ui/ozone/platform/wayland/host/wayland_screen.cc (`CalculateIdleTime`),
  https://github.com/chromium/chromium/blob/152.0.7977.130/ui/ozone/platform/wayland/host/org_gnome_mutter_idle_monitor.cc;
  X11 https://github.com/chromium/chromium/blob/152.0.7977.130/ui/ozone/platform/x11/x11_screen_ozone.cc
- [V5] gnome-shell ScreenShield (`SetLockedHint`, `active-changed`) and D-Bus export:
  https://github.com/GNOME/gnome-shell/blob/main/js/ui/screenShield.js,
  https://github.com/GNOME/gnome-shell/blob/main/js/ui/shellDBus.js,
  https://github.com/GNOME/gnome-shell/blob/main/js/dbusServices/screensaver/screenSaverService.js
- [V6] same as V5 (`_setLocked` → `SetLockedHintAsync`).
- [V7] KDE kscreenlocker: https://github.com/KDE/kscreenlocker/blob/master/logind.cpp (`SetLockedHint`),
  https://github.com/KDE/kscreenlocker/blob/master/interface.cpp (`org.freedesktop.ScreenSaver`, `ActiveChanged`)
- [V8] KWin still creates `org_kde_kwin_idle` and `ext_idle_notifier_v1`:
  https://github.com/KDE/kwin/blob/master/src/wayland_server.cpp, https://github.com/KDE/kwin/blob/master/src/wayland/idle.cpp
- [V9] gnome-session `SetIdleHint`: https://github.com/GNOME/gnome-session/blob/main/gnome-session/gsm-systemd.c
- [V10] Electron SIGTERM/SIGINT/SIGHUP graceful shutdown:
  https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_browser_main_parts_posix.cc
- [V11] Electron breaking changes 38.0 (native Wayland by default):
  https://github.com/electron/electron/blob/v44.4.5/docs/breaking-changes.md
- [V12] Electron `powerMonitor` JS wrapper (lazy start, shutdown listener tracking):
  https://github.com/electron/electron/blob/v44.4.5/lib/browser/api/power-monitor.ts
- [V13] logind D-Bus API (`PrepareForSleep`/`PrepareForShutdown`, `LockedHint`, `Lock`/`Unlock` are requests,
  no signals on `self`/`auto`): https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html
  (source: https://github.com/systemd/systemd/blob/main/man/org.freedesktop.login1.xml)
- [V14] systemd Inhibitor Locks: https://systemd.io/INHIBITOR_LOCKS/
- [V15] `logind.conf` `InhibitDelayMaxSec=` default 5: https://www.freedesktop.org/software/systemd/man/latest/logind.conf.html
- [V16] NetworkManager sleep/shutdown handling (`sleeping_cb` → `do_sleep_wake` device takedown; `shutdown_cb`
  honours `down-on-poweroff`, default no): https://github.com/NetworkManager/NetworkManager/blob/main/src/core/nm-manager.c,
  https://github.com/NetworkManager/NetworkManager/blob/main/src/core/nm-power-monitor.c
