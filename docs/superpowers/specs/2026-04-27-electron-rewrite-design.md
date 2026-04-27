# Electron Rewrite Design

Rewrite the Tauri-based WhatsApp Web desktop wrapper to Electron for consistent
cross-platform behavior (Chromium everywhere). Linux-only target. Full feature
parity with the current application.

## Project Structure

```
whats/
├── electron.vite.config.ts          # electron-vite config (main + preload + renderer)
├── electron-builder.yml             # electron-builder config (deb target)
├── package.json
├── tsconfig.json                    # Renderer TypeScript config
├── tsconfig.node.json               # Main + preload TypeScript config
├── src/
│   ├── main/                        # Electron main process (TypeScript)
│   │   ├── index.ts                 # App entry, window creation, IPC registration
│   │   ├── settings.ts              # JSON persistence to userData
│   │   ├── updater.ts               # GitHub API polling, semver comparison
│   │   ├── tray.ts                  # System tray icon + menu + state machine
│   │   ├── notifications.ts         # Electron Notification + paplay for sound
│   │   ├── windows.ts              # Window management (main + dialogs)
│   │   ├── buildInfo.ts            # Version + build timestamp
│   │   └── titleParse.ts           # Unread count extraction from title string
│   ├── preload/
│   │   ├── index.ts                 # contextBridge for dialog windows
│   │   └── whatsapp.ts             # Preload for WhatsApp webview
│   └── renderer/                    # React frontend (settings, about, update views)
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css
│       ├── settingsApi.ts
│       ├── buildInfoApi.ts
│       ├── updateApi.ts
│       └── electron.d.ts           # TypeScript declarations for window.electronAPI
├── resources/
│   └── icons/                       # App + tray icons (reused from src-tauri/icons/)
├── tests/
│   ├── inject.test.ts
│   ├── settingsView.test.tsx
│   ├── updateView.test.tsx
│   ├── bundleConfig.test.ts
│   ├── notifications.test.ts
│   ├── settings.test.ts
│   ├── updater.test.ts
│   ├── tray.test.ts
│   ├── buildInfo.test.ts
│   └── titleParse.test.ts
├── scripts/
│   ├── release.sh
│   └── build-deb.sh
├── commitlint.config.js
├── .husky/
├── CHANGELOG.md
├── README.md
└── LICENSE.md
```

## IPC Contract

All communication between renderer/preload and main process uses typed IPC channels.

### Dialog Windows (via `preload/index.ts` contextBridge)

| Channel | Direction | Purpose | Payload / Return |
|---|---|---|---|
| `build-info:get` | renderer→main | Get version and build timestamp | `{version: string, buildTimestamp: string}` |
| `settings:get` | renderer→main | Get current settings | `Settings` |
| `settings:set` | renderer→main | Save settings | `Settings → void` |
| `settings:preview-notification` | renderer→main | Fire test notification | `void` |
| `settings:preview-sound` | renderer→main | Play test sound | `void` |
| `update:get-info` | renderer→main | Get cached update state | `UpdateInfo \| null` |
| `update:check-now` | renderer→main | Force immediate update check | `UpdateInfo \| null` |
| `update:skip-version` | renderer→main | Mark version as skipped | `string → void` |
| `shell:open-external` | renderer→main | Open URL in system browser | `string → void` |

### WhatsApp Webview (via `preload/whatsapp.ts`)

| Channel | Direction | Purpose | Payload |
|---|---|---|---|
| `whatsapp:notify` | preload→main | Dispatch native notification | `{title: string, body: string, tag?: string}` |
| `whatsapp:unread` | preload→main | Report unread count | `number` |
| `whatsapp:disconnected` | preload→main | Report connection state | `boolean` |

## Main Process Modules

### `index.ts` — App Entry

- Enforces single instance via `app.requestSingleInstanceLock()`
- Creates main BrowserWindow loading `https://web.whatsapp.com/`
  - Size: 1200×800, min: 600×400
  - Preload: `preload/whatsapp.ts`
- Registers all IPC handlers
- Initializes tray, settings state, updater
- "Close to tray" behavior: intercepts `close` event, hides window instead of quitting

### `settings.ts` — Persistence

- Storage path: `app.getPath('userData') + '/settings.json'`
- Settings shape:
  ```ts
  interface Settings {
    notifications: boolean;
    sounds: boolean;
    checkForUpdates: boolean;
    skippedVersion: string | null;
  }
  ```
- Defaults: `{ notifications: true, sounds: true, checkForUpdates: true, skippedVersion: null }`
- Atomic writes: write to `.tmp` file then rename
- Graceful fallback to defaults on corruption or missing file

### `updater.ts` — GitHub Update Checker

- Polls `https://api.github.com/repos/IgorKvasn/whats/releases/latest`
- Uses `semver` npm package for version comparison
- 24-hour throttle between automatic checks
- 3-strike notification: after 3 consecutive check failures, shows a notification
- Respects `skippedVersion` from settings
- On new version found: opens update dialog window
- Startup behavior: if `checkForUpdates` enabled, waits 5 seconds then checks

### `tray.ts` — System Tray

- Three icon states: Normal, Unread, Disconnected
- Icon files: `resources/icons/tray-normal.png`, `tray-unread.png`, `tray-disconnected.png`
- State derivation: Disconnected takes priority over Unread
- Menu items: Show | Settings | About | DevTools | Quit
- Click on tray icon: toggles main window visibility

### `notifications.ts` — Native Notifications

- Uses Electron's `Notification` class for display
- Click handler: focuses and shows the main window
- Sound: `child_process.execFile('paplay', [soundPath])`
- Deduplication: suppresses duplicate notifications within a short time window (same logic as current Rust `should_dispatch`)

### `windows.ts` — Window Management

- `showMainWindow()` / `hideMainWindow()` / `toggleMainWindow()`
- `openSettingsWindow()` / `openAboutWindow()` / `openUpdateWindow()`
- Dialog windows load the renderer entry with a query param: `?view=settings`
- Dialog windows use `preload/index.ts` as their preload script
- Only one instance of each dialog at a time (focus existing if already open)

### `buildInfo.ts` — Build Metadata

- Version: read from `package.json` at build time via electron-vite define
- Build timestamp: captured at build time (same `SOURCE_DATE_EPOCH` pattern or `new Date()`)

### `titleParse.ts` — Unread Count

- Pure function: `parseUnread(title: string): number | null`
- Regex parses `(N) WhatsApp` pattern from document title
- Returns the count or null if no match

### Shared Utilities

Pure functions used by both preload and main process (and imported by tests):

- `src/main/titleParse.ts` — `parseUnread()` (used by preload via import, and tested directly)
- `src/main/notifications.ts` — exports `shouldDispatch()`, `pickFallbackNotificationPayload()` as named exports
- `src/preload/inject.ts` — shared module containing `makeNotificationShim()`, `shouldNotifyFromUnreadDelta()` (imported by `whatsapp.ts` preload and by tests)

## Preload Scripts

### `preload/whatsapp.ts` — WhatsApp Web Injection

Runs in the context of the WhatsApp Web page. Responsibilities:

1. **Notification interception**: Injects a script into the page world (via `webFrame.executeJavaScript` or a script element) that patches `window.Notification` to route notifications to the main process through a bridge exposed by `contextBridge`.

2. **Title watching**: Observes `document.title` changes (MutationObserver on `<title>` element or polling interval). Parses unread count and sends to main process.

3. **Disconnection detection**: MutationObserver on the DOM watching for alert elements indicating connection loss. Reports state to main process.

4. **External link interception**: Captures clicks on `<a>` elements with external hrefs, prevents default navigation, sends URL to main process for `shell.openExternal()`.

### `preload/index.ts` — Dialog Windows

Exposes typed API via `contextBridge.exposeInMainWorld('electronAPI', {...})`:

```ts
electronAPI.getBuildInfo(): Promise<BuildInfo>
electronAPI.getSettings(): Promise<Settings>
electronAPI.setSettings(settings: Settings): Promise<void>
electronAPI.previewNotification(): Promise<void>
electronAPI.previewSound(): Promise<void>
electronAPI.getUpdateInfo(): Promise<UpdateInfo | null>
electronAPI.checkForUpdatesNow(): Promise<UpdateInfo | null>
electronAPI.setSkippedVersion(version: string): Promise<void>
electronAPI.openExternal(url: string): Promise<void>
```

## Renderer Changes

### API Files

Each API file is rewritten to call `window.electronAPI.*` instead of Tauri's `invoke()`:

- `settingsApi.ts` → calls `electronAPI.getSettings()`, `electronAPI.setSettings()`, etc.
- `buildInfoApi.ts` → calls `electronAPI.getBuildInfo()`
- `updateApi.ts` → calls `electronAPI.getUpdateInfo()`, `electronAPI.checkForUpdatesNow()`, etc.

### `App.tsx`

- View routing changes from Tauri window label to URL query param: `new URLSearchParams(window.location.search).get('view')`
- SettingsView groups notification preview controls together: "Show notifications" → "Include message preview" → "Preview notification" button, then sound controls below
- SettingsView shows a green "Setting saved" toast (bottom-right, 2 s fade) after any setting is persisted
- AboutView and UpdateView unchanged

### `electron.d.ts`

TypeScript declarations for `window.electronAPI` so the renderer compiles cleanly.

### Dependencies Removed

- `@tauri-apps/api`
- `@tauri-apps/plugin-opener`

### Dependencies Added (renderer)

None — IPC goes through `window.electronAPI` exposed by preload.

## Testing Strategy

All tests use Vitest. The Rust unit tests are ported 1:1 to TypeScript.

| Test File | Tests | Source |
|---|---|---|
| `tests/inject.test.ts` | 18 | Ported from current `tests/inject.test.js` — pure function tests for `parseUnread`, `makeNotificationShim`, `shouldNotifyFromUnreadDelta`, `pickFallbackNotificationPayload` |
| `tests/settingsView.test.tsx` | 3 | Adapted — mocks `window.electronAPI` instead of `@tauri-apps/api` |
| `tests/updateView.test.tsx` | 3 | Adapted — mocks `window.electronAPI` instead of `@tauri-apps/api` |
| `tests/bundleConfig.test.ts` | 2 | Rewritten to verify `electron-builder.yml` (deb target, desktop category) |
| `tests/notifications.test.ts` | 7 | Ported from Rust `ipc.rs` + `notify.rs` — `shouldDispatch` dedup logic, action parsing |
| `tests/settings.test.ts` | 7 | Ported from Rust `settings.rs` — load/save, JSON round-trip, corruption handling, atomic writes |
| `tests/updater.test.ts` | 14 | Ported from Rust `updater.rs` — version comparison, update decision, body excerpt, throttle |
| `tests/tray.test.ts` | 3 | Ported from Rust `tray.rs` — state derivation (unread count, disconnected flag) |
| `tests/buildInfo.test.ts` | 2 | Ported from Rust `build_info.rs` — timestamp formatting |
| `tests/titleParse.test.ts` | 8 | Ported from Rust `title_parse.rs` — title parsing for unread count |

Total: ~67 tests, matching current coverage.

Integration-level concerns (actual window creation, tray rendering, IPC wiring) are not unit-tested, matching the current approach.

## Packaging & Release

### electron-builder.yml

```yaml
appId: app.whats.desktop
productName: whats
linux:
  target: deb
  category: Network;InstantMessaging
  desktop:
    StartupWMClass: whats
deb:
  depends:
    - libnotify-bin
    - pulseaudio-utils
```

### Build Flow

1. `electron-vite build` — compiles main + preload + renderer
2. `electron-builder --linux deb` — packages into `.deb`

### Release Script Changes

- Version bumping: only `package.json` (no Cargo.toml, no tauri.conf.json)
- Build command: `electron-vite build && electron-builder --linux deb`
- Asset location: `dist/*.deb` (electron-builder output)
- Changelog generation and git tagging: unchanged

### build-deb.sh Simplification

- Remove: webkit2gtk, GTK3, appindicator system package installs
- Remove: Rust toolchain checks (rustc, cargo)
- Keep: Node/npm check, `npm install`, `npm test`, build, package

## Deletions

The following are removed entirely:

- `src-tauri/` — all Rust source, Cargo.toml, Cargo.lock, tauri.conf.json, capabilities/, permissions/, build.rs, resources/, icons/, bundle/, gen/
- `vite.config.ts` — replaced by `electron.vite.config.ts`
- `dist/` — old Vite output directory
- `run.sh` — replaced by `electron-vite dev`

## Key Dependencies

### Added

| Package | Purpose |
|---|---|
| `electron` | Runtime |
| `electron-builder` | Packaging (.deb) |
| `electron-vite` | Build toolchain (main + preload + renderer) |
| `@vitejs/plugin-react` | React support in renderer build |
| `semver` | Version comparison in updater |

### Removed

| Package | Reason |
|---|---|
| `@tauri-apps/api` | Tauri runtime |
| `@tauri-apps/plugin-opener` | Tauri plugin |
| `@tauri-apps/cli` | Tauri CLI |
| `vite` | Replaced by electron-vite (which bundles it) |
