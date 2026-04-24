# WhatsApp Desktop (Tauri) — Design

Date: 2026-04-24
Status: Draft — pending user review

## Goal

A small Tauri v2 desktop application that hosts `https://web.whatsapp.com` in a persistent webview, with:

- QR-pairing once; auth (multi-device keys in IndexedDB) persists across restarts.
- System tray icon reflecting unread / connection state with a tooltip count.
- Native OS notifications when new messages arrive, configurable from a settings window.
- Hide-to-tray on window close; true exit only via tray menu.

## Non-goals

- Reimplementing the WhatsApp multi-device protocol (whatsmeow / Baileys style). The app is a webview wrapper, not a native client.
- Multi-account support.
- Numeric badge rendered into the tray icon image (count is shown in the tooltip instead).
- Automated end-to-end testing against live web.whatsapp.com.

## Approach

Tauri v2 application with two windows and a system tray. The main window navigates directly to `https://web.whatsapp.com` and uses a persistent on-disk webview profile so the multi-device session survives restarts. Two small JavaScript snippets are injected into the WhatsApp page to extract two signals:

1. The total unread count, parsed from `document.title` (which WhatsApp Web maintains as `(N) WhatsApp`).
2. New-message notifications, by overriding `window.Notification` and forwarding the constructor arguments to Rust.

Rust owns all OS-facing concerns (tray, notifications, settings persistence, window lifecycle). A separate, lazily-created React settings window exposes user-facing toggles.

## Architecture

```
┌────────────────────────── Tauri App Process ──────────────────────────┐
│                                                                       │
│   ┌─ Rust core ──────────────────────────────────────────────────┐    │
│   │  - App lifecycle, window manager, tray manager                │   │
│   │  - IPC commands (report_unread, notify_message, …)            │   │
│   │  - Settings store (JSON in app data dir)                      │   │
│   │  - Native notification dispatcher                              │   │
│   │  - Tray icon + tooltip + menu                                  │   │
│   └───────────────────────────────────────────────────────────────┘   │
│            ▲                                  ▲                       │
│            │ IPC                              │ IPC                   │
│   ┌────────┴──────────────────┐    ┌──────────┴──────────────────┐    │
│   │ WhatsApp Window           │    │ Settings Window             │    │
│   │ (webview → web.whatsapp)  │    │ (React app, local URL)      │    │
│   │ + injected JS bridge:     │    │ - Notifications on/off      │    │
│   │   - title watcher → unread│    │ - Sound on/off              │    │
│   │   - Notification override │    │ - Include preview on/off    │    │
│   │ Persistent profile dir    │    │                             │    │
│   └───────────────────────────┘    └─────────────────────────────┘    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Tech stack

- Tauri v2.
- Rust core (`src-tauri/`).
- React + TypeScript + Vite for the settings window (`src/`), generated from the standard `create-tauri-app` template.
- Tauri plugins: `tauri-plugin-notification`, `tauri-plugin-single-instance`, plus tray APIs from `tauri::tray`.
- Persistent webview profile via Tauri v2's webview data-directory configuration, located in the OS-default app data directory.

## Components

### Rust core (`src-tauri/src/`)

- `main.rs` — Tauri builder, plugin registration, `setup()` wires up windows + tray.
- `tray.rs` — owns the tray icon, current state (`Normal | Unread | Disconnected`), `set_state(state, count)` that swaps the icon and updates the tooltip. Owns the right-click menu (Show / Settings / Quit) and left-click toggle handler. Exposes a pure helper `derive_state(unread: u32, disconnected: bool) -> TrayState` for unit testing.
- `windows.rs` — `show_or_create_main()`, `show_or_create_settings()`, plus a close-handler that hides the main window instead of destroying it (only when tray creation succeeded).
- `settings.rs` — `Settings { notifications_enabled: bool, sound_enabled: bool, include_preview: bool }`. Defaults `{true, true, false}`. Loaded from `<app-data>/settings.json` on startup; written atomically (`settings.json.tmp` + rename) on every change. Corrupt file → log + use defaults.
- `notify.rs` — `dispatch(sender, body)` consults settings and dispatches a notification with/without body, with/without sound, via `tauri-plugin-notification`.
- `ipc.rs` — Tauri commands: `report_unread(count: u32)`, `report_disconnected(disconnected: bool)`, `notify_message(sender: String, body: Option<String>)`, `get_settings()`, `set_settings(...)`. Helper `parse_unread_from_title(&str) -> u32` exposed for unit testing.

### Injected JS (`src-tauri/resources/inject.js`)

Loaded into the WhatsApp window via Tauri's `initialization_script`.

- **Title watcher** — `MutationObserver` on `<title>`; parses a leading parenthesised integer (e.g. `(3) WhatsApp`) into a number, defaulting to 0 if absent or unparseable. On change, invokes `report_unread`.
- **Notification interceptor** — replaces `window.Notification` with a shim. The constructor invokes `notify_message` with `{ sender: title, body: options?.body }`. `Notification.permission` reads as `"granted"` and `requestPermission()` resolves to `"granted"`, so WhatsApp Web continues to fire notifications.
- **Disconnected detector** — periodic (≈5s) DOM check for WhatsApp's "Phone not connected" / "Computer not connected" banner via a documented selector. On state change, invokes `report_disconnected`.

All `invoke` calls are wrapped in try/catch; failures are swallowed so the page is never broken by a bridge error.

### Settings window React app (`src/`)

- One screen, three toggles bound to settings IPC.
- No router, no state library. `useState` + a thin `settingsApi.ts` wrapper around `@tauri-apps/api/core`'s `invoke`.

### Assets

- Three tray icon PNGs in `src-tauri/icons/`: `tray-normal.png`, `tray-unread.png`, `tray-disconnected.png`. Monochrome silhouettes at 22×22 / 44×44 (HiDPI). Placeholder art at scaffolding time, swappable later.
- App icon set generated by `cargo tauri icon`.

## Data flow

### Startup

1. Settings loaded (or defaults written if file missing).
2. Tray created in `Normal`, tooltip `"WhatsApp"`. If tray creation fails, log and continue without close-to-tray behavior.
3. WhatsApp window created, navigates to `https://web.whatsapp.com`, injects `inject.js`. Persistent profile means previous-session cookies/IndexedDB are present → WhatsApp Web auto-resumes. First run only: user scans QR.
4. Settings window is not created.

### New incoming message

```
WhatsApp Web JS  ──new Notification("Alice", {body:"hi"})──▶  injected shim
                                                                    │
                                                  invoke("notify_message", …)
                                                                    ▼
                                                              Rust ipc.rs
                                                                    │
                                                  if settings.notifications_enabled:
                                                    build Notification (body iff include_preview;
                                                                        sound iff sound_enabled)
                                                                    ▼
                                              tauri-plugin-notification ──▶  OS
```

### Unread count change

```
WhatsApp Web updates document.title  ──▶  MutationObserver in inject.js
                                                       │
                                          parse leading "(N)" → N (0 if absent)
                                                       │
                                          invoke("report_unread", { count: N })
                                                       ▼
                                                 Rust tray.rs
                                            ┌─ N == 0 → state = Normal
                                            ├─ N  > 0 → state = Unread, tooltip "WhatsApp — N unread"
                                            └─ swap icon if state changed; update tooltip
```

### Disconnected detection

`inject.js` polls every ~5s for the disconnect banner. On change, invokes `report_disconnected`. Rust `tray.rs` applies `derive_state(unread, disconnected)` — disconnected wins over unread. Reverts when reconnected.

### Tray interactions

- Left-click → toggle main window (show + focus if hidden, hide if visible).
- Right-click → menu: "Show WhatsApp", "Settings…", "Quit".
- Quit is the only way to truly exit the app.

### Window close

- Main window close → intercept, `window.hide()`. App keeps running. (Only when tray was created successfully; otherwise fall back to default close → quit so the app stays reachable.)
- Settings window close → destroy normally (lazy recreate next time).

### Settings change

Settings window toggle → `invoke("set_settings", …)` → Rust updates in-memory `Settings`, atomic write to disk. Next notification picks up the new values immediately.

## Error handling

- **WhatsApp Web fails to load**: webview shows its own error page; user reloads or restarts. No special handling.
- **WhatsApp Web changes title format / DOM**: parsers fail gracefully (count stays at 0; disconnected detector never trips). One-time console warning during development. No crash.
- **Notification interceptor mismatch**: if WhatsApp ever stops using `window.Notification`, no notifications fire. We update the shim. No crash.
- **Settings file corrupt**: log, fall back to defaults, overwrite on next save. No prompt.
- **Settings write crash**: atomic tmp + rename prevents partial files.
- **IPC errors**: JS side catches and swallows; Rust side returns `Result` and logs.
- **Tray creation failure**: log, continue; do not hide-to-tray (otherwise app becomes unreachable).
- **Notification API failure**: log, continue; tray + unread still work.
- **Multi-instance**: `tauri-plugin-single-instance` focuses existing instance.
- **Webview profile lock contention**: prevented by single-instance; if it somehow occurs, app exits with stderr message. Misuse case.

## Testing

### Automated — Rust unit tests (`cargo test`)

- `settings.rs`: defaults when file missing; serialize/deserialize round-trip; corrupt JSON → defaults; atomic write leaves no partial file.
- `tray.rs::derive_state`: `(0, false) → Normal`; `(N>0, false) → Unread`; `(_, true) → Disconnected`.
- `parse_unread_from_title`: `"WhatsApp" → 0`; `"(3) WhatsApp" → 3`; `"(0) WhatsApp" → 0`; `"(120) WhatsApp" → 120`; garbage → 0.

### Automated — JS unit tests (vitest)

- Title-parse helper mirror.
- Notification shim: invokes stubbed `invoke` with expected args (with and without body); `permission === "granted"`; `requestPermission()` resolves to `"granted"`.

### Manual verification checklist

Lives at `docs/superpowers/specs/manual-test-checklist.md` (created during implementation). Covers: first-run QR pairing; auth persistence across restart; unread tray transitions; notification toggles (master, sound, preview); window close hides to tray; tray menu actions; disconnected detection; single-instance focusing.

### Out of scope for testing

- Live web.whatsapp.com integration (brittle, ToS-adjacent).
- OS tray / notification rendering across desktop environments.

## Open questions / future work

- Tray icon art is placeholder; final icons to be designed later.
- Settings expansion: "start minimized", "launch on system startup", "close behavior" — explicitly out of scope for now.
- Multi-account support — explicitly out of scope.
