# WhatsApp Desktop (Tauri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 desktop application that hosts `https://web.whatsapp.com` in a persistent webview, with a system tray indicating unread/disconnected state, OS notifications on new messages, and a React settings window.

**Architecture:** One Tauri app, one process, two windows (WhatsApp webview + lazy React settings window) plus a system tray. A small injected JS bridge extracts unread count (from `document.title`) and new-message notifications (by overriding `window.Notification`) from the WhatsApp page and forwards them to Rust via Tauri IPC. Rust owns settings persistence, tray state, and native notifications.

**Tech Stack:** Tauri v2, Rust, React + TypeScript + Vite, `tauri-plugin-notification`, `tauri-plugin-single-instance`.

**Design spec:** `docs/superpowers/specs/2026-04-24-whatsapp-tauri-design.md` — read before starting.

**Conventions for every task:**
- After every step that changes code or config, run `cargo check --manifest-path src-tauri/Cargo.toml` to catch breakage early (fast on incremental builds).
- Commit at the end of each task. Commit messages use conventional-commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).
- All paths are relative to the repo root `/data/projects/whats/`.
- The project's `.claude/hooks/post-tool-call.py` is missing; the resulting post-tool-call hook errors are cosmetic and non-blocking.

---

## Task 1: Scaffold the Tauri v2 + React project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/vite-env.d.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*`
- Create: `.gitignore`

- [ ] **Step 1: Run the Tauri v2 scaffolder non-interactively**

Run from repo root:

```bash
npm create tauri-app@latest -- --yes \
  --template react-ts \
  --manager npm \
  --identifier app.whats.desktop \
  --app-name whats .
```

If the CLI refuses to scaffold into a non-empty directory (because `docs/` and `.git/` already exist), use a sibling temp dir and move the files in:

```bash
tmpdir=$(mktemp -d)
(cd "$tmpdir" && npm create tauri-app@latest -- --yes \
  --template react-ts --manager npm \
  --identifier app.whats.desktop --app-name whats whats)
rsync -a "$tmpdir/whats/" ./ --exclude .git
rm -rf "$tmpdir"
```

Expected: creates `package.json`, `src/`, `src-tauri/`, `index.html`, `vite.config.ts`, Tauri config, default icons, and `.gitignore`.

- [ ] **Step 2: Install JS deps**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 3: Verify it builds**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build (warnings OK). Do NOT run `npm run tauri dev` — we're not booting a GUI in this plan, only verifying the toolchain.

- [ ] **Step 4: Set app window title and initial size in `src-tauri/tauri.conf.json`**

Open `src-tauri/tauri.conf.json`. In the `app.windows` array, replace the default window entry so the main window is labeled `"main"`, titled `"WhatsApp"`, 1200×800, not visible at startup (we show it from Rust after setup), and minimum size 600×400:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "WhatsApp",
        "width": 1200,
        "height": 800,
        "minWidth": 600,
        "minHeight": 400,
        "visible": false,
        "url": "https://web.whatsapp.com/"
      }
    ]
  }
}
```

Leave other top-level keys (`productName`, `identifier`, `build`, `bundle`) as scaffolded.

Note: the `url` field at the window level tells Tauri to navigate to that URL instead of loading the frontend bundle. The default dev-server URL for the React app will still be used for any *other* windows (like the settings window, added later).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold tauri v2 + react-ts project"
```

---

## Task 2: Pure helper — `parse_unread_from_title` (TDD)

**Files:**
- Create: `src-tauri/src/title_parse.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod title_parse;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/title_parse.rs`:

```rust
pub fn parse_unread_from_title(title: &str) -> u32 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_parens_is_zero() {
        assert_eq!(parse_unread_from_title("WhatsApp"), 0);
    }

    #[test]
    fn simple_count() {
        assert_eq!(parse_unread_from_title("(3) WhatsApp"), 3);
    }

    #[test]
    fn zero_in_parens() {
        assert_eq!(parse_unread_from_title("(0) WhatsApp"), 0);
    }

    #[test]
    fn large_count() {
        assert_eq!(parse_unread_from_title("(120) WhatsApp"), 120);
    }

    #[test]
    fn empty_string() {
        assert_eq!(parse_unread_from_title(""), 0);
    }

    #[test]
    fn garbage() {
        assert_eq!(parse_unread_from_title("hello world"), 0);
    }

    #[test]
    fn parens_without_number() {
        assert_eq!(parse_unread_from_title("(abc) WhatsApp"), 0);
    }

    #[test]
    fn leading_whitespace() {
        assert_eq!(parse_unread_from_title("  (5) WhatsApp"), 5);
    }
}
```

In `src-tauri/src/lib.rs`, add at the top (below any existing `use`s):

```rust
mod title_parse;
```

- [ ] **Step 2: Run the tests and verify 5 of 8 fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml title_parse`
Expected: tests `no_parens_is_zero`, `zero_in_parens`, `empty_string`, `garbage`, `parens_without_number` pass (all expect 0). `simple_count`, `large_count`, `leading_whitespace` FAIL (expect 3, 120, 5 respectively, got 0).

- [ ] **Step 3: Implement**

Replace the body of `parse_unread_from_title` in `src-tauri/src/title_parse.rs`:

```rust
pub fn parse_unread_from_title(title: &str) -> u32 {
    let trimmed = title.trim_start();
    let rest = match trimmed.strip_prefix('(') {
        Some(r) => r,
        None => return 0,
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    digits.parse().unwrap_or(0)
}
```

- [ ] **Step 4: Run tests and verify all pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml title_parse`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/title_parse.rs src-tauri/src/lib.rs
git commit -m "feat: parse unread count from document title"
```

---

## Task 3: Pure helper — `TrayState::derive` (TDD)

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod tray;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/tray.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Normal,
    Unread,
    Disconnected,
}

impl TrayState {
    pub fn derive(_unread: u32, _disconnected: bool) -> TrayState {
        TrayState::Normal
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_unread_not_disconnected() {
        assert_eq!(TrayState::derive(0, false), TrayState::Normal);
    }

    #[test]
    fn unread_not_disconnected() {
        assert_eq!(TrayState::derive(1, false), TrayState::Unread);
        assert_eq!(TrayState::derive(42, false), TrayState::Unread);
    }

    #[test]
    fn disconnected_beats_unread() {
        assert_eq!(TrayState::derive(0, true), TrayState::Disconnected);
        assert_eq!(TrayState::derive(5, true), TrayState::Disconnected);
    }
}
```

In `src-tauri/src/lib.rs`, add:

```rust
mod tray;
```

- [ ] **Step 2: Run the tests and verify failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml tray::tests`
Expected: `no_unread_not_disconnected` passes. `unread_not_disconnected` and `disconnected_beats_unread` FAIL.

- [ ] **Step 3: Implement**

Replace the body of `TrayState::derive` in `src-tauri/src/tray.rs`:

```rust
impl TrayState {
    pub fn derive(unread: u32, disconnected: bool) -> TrayState {
        if disconnected {
            TrayState::Disconnected
        } else if unread > 0 {
            TrayState::Unread
        } else {
            TrayState::Normal
        }
    }
}
```

- [ ] **Step 4: Run tests and verify all pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml tray::tests`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/lib.rs
git commit -m "feat: tray state derivation from unread + disconnected"
```

---

## Task 4: Settings store with atomic save (TDD)

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod settings;`)
- Modify: `src-tauri/Cargo.toml` (add `serde`, `serde_json`, `tempfile` dev-dep)

- [ ] **Step 1: Add deps to `src-tauri/Cargo.toml`**

Under `[dependencies]` add (if not already present from scaffold):

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Under `[dev-dependencies]` (create the section if missing) add:

```toml
tempfile = "3"
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/settings.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub include_preview: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
        }
    }
}

impl Settings {
    pub fn load_or_default(_path: &Path) -> Settings {
        Settings::default()
    }

    pub fn save(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_when_file_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings::load_or_default(&path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings {
            notifications_enabled: false,
            sound_enabled: false,
            include_preview: true,
        };
        s.save(&path).unwrap();
        let loaded = Settings::load_or_default(&path);
        assert_eq!(loaded, s);
    }

    #[test]
    fn corrupt_file_returns_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, b"{not valid json").unwrap();
        let s = Settings::load_or_default(&path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn atomic_save_leaves_no_tmp_on_success() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        Settings::default().save(&path).unwrap();
        assert!(path.exists());
        assert!(!tmp_path(&path).exists());
    }

    #[test]
    fn save_creates_parent_directory() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/sub/settings.json");
        Settings::default().save(&path).unwrap();
        assert!(path.exists());
    }
}
```

In `src-tauri/src/lib.rs`, add:

```rust
mod settings;
```

- [ ] **Step 3: Run tests and verify most fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::tests`
Expected: `defaults_when_file_missing` passes (stub returns default). `corrupt_file_returns_defaults` passes for same reason. `round_trip`, `atomic_save_leaves_no_tmp_on_success`, `save_creates_parent_directory` FAIL (stub doesn't write).

- [ ] **Step 4: Implement**

Replace `load_or_default` and `save` in `src-tauri/src/settings.rs`:

```rust
impl Settings {
    pub fn load_or_default(path: &Path) -> Settings {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                eprintln!("settings: corrupt file, using defaults: {err}");
                Settings::default()
            }),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Settings::default(),
            Err(err) => {
                eprintln!("settings: read failed, using defaults: {err}");
                Settings::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = tmp_path(path);
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&tmp, &json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }
}
```

- [ ] **Step 5: Run tests and verify all pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::tests`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "feat: settings struct with atomic load/save"
```

---

## Task 5: Register Tauri plugins (notification, single-instance)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add plugin deps to `src-tauri/Cargo.toml`**

Under `[dependencies]`:

```toml
tauri-plugin-notification = "2"
tauri-plugin-single-instance = "2"
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 2: Register plugins in `src-tauri/src/lib.rs`**

Locate the existing `run()` function (from the scaffold). Replace it with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Keep the `mod title_parse;`, `mod tray;`, `mod settings;` declarations at the top.

- [ ] **Step 3: Add notification permission to capabilities**

Open `src-tauri/capabilities/default.json`. In the `"permissions"` array, add:

```
"notification:default"
```

Leave existing permissions intact.

- [ ] **Step 4: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: register notification and single-instance plugins"
```

---

## Task 6: Settings IPC + app-state wiring

**Files:**
- Create: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/ipc.rs`**

```rust
use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    *state.settings.lock().unwrap()
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    new_settings: Settings,
) -> Result<(), String> {
    new_settings.save(&state.settings_path).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = new_settings;
    Ok(())
}

#[tauri::command]
pub fn report_unread(_app: AppHandle, count: u32) {
    // Wired up in Task 9.
    let _ = count;
}

#[tauri::command]
pub fn report_disconnected(_app: AppHandle, disconnected: bool) {
    // Wired up in Task 9.
    let _ = disconnected;
}

#[tauri::command]
pub fn notify_message(
    _app: AppHandle,
    _state: State<'_, AppState>,
    sender: String,
    body: Option<String>,
) {
    // Wired up in Task 8.
    let _ = (sender, body);
}
```

- [ ] **Step 2: Wire commands and state into `src-tauri/src/lib.rs`**

Add `mod ipc;` at the top. Replace `run()`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            use tauri::Manager;
            let settings_path = app
                .path()
                .app_data_dir()
                .expect("app data dir available")
                .join("settings.json");
            let settings = crate::settings::Settings::load_or_default(&settings_path);
            app.manage(crate::ipc::AppState {
                settings: std::sync::Mutex::new(settings),
                settings_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::get_settings,
            crate::ipc::set_settings,
            crate::ipc::report_unread,
            crate::ipc::report_disconnected,
            crate::ipc::notify_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Grant IPC permissions in `src-tauri/capabilities/default.json`**

Ensure the `"permissions"` array includes a custom permission for our commands. Add a new file `src-tauri/capabilities/whats.json`:

```json
{
  "identifier": "whats-capability",
  "description": "Custom commands for the WhatsApp shell",
  "windows": ["main", "settings"],
  "permissions": [
    "core:default",
    "notification:default"
  ],
  "remote": {
    "urls": ["https://web.whatsapp.com/*"]
  }
}
```

Then add inline command permissions by creating `src-tauri/permissions/whats/commands.toml`:

```toml
[default]
description = "Allow whats app commands"
permissions = [
  "allow-get-settings",
  "allow-set-settings",
  "allow-report-unread",
  "allow-report-disconnected",
  "allow-notify-message",
]

[[permission]]
identifier = "allow-get-settings"
description = "Read current settings"
commands.allow = ["get_settings"]

[[permission]]
identifier = "allow-set-settings"
description = "Write settings"
commands.allow = ["set_settings"]

[[permission]]
identifier = "allow-report-unread"
description = "Report unread count from the page"
commands.allow = ["report_unread"]

[[permission]]
identifier = "allow-report-disconnected"
description = "Report disconnected state from the page"
commands.allow = ["report_disconnected"]

[[permission]]
identifier = "allow-notify-message"
description = "Fire a native notification for a new message"
commands.allow = ["notify_message"]
```

Update `src-tauri/capabilities/default.json` to include these permissions. Its `"permissions"` array should contain (merge with what's already there):

```
"core:default",
"notification:default",
"whats:default"
```

- [ ] **Step 4: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build. If a permission identifier is unrecognized, Tauri's build script will complain — double-check paths in `src-tauri/permissions/whats/commands.toml`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: app state + settings IPC commands with capability"
```

---

## Task 7: Notification dispatcher (honours settings)

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod notify;`)
- Modify: `src-tauri/src/ipc.rs` (call dispatcher from `notify_message`)

- [ ] **Step 1: Create `src-tauri/src/notify.rs`**

```rust
use crate::settings::Settings;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn dispatch(app: &AppHandle, settings: Settings, sender: &str, body: Option<&str>) {
    if !settings.notifications_enabled {
        return;
    }
    let mut builder = app.notification().builder().title(sender);
    if settings.include_preview {
        if let Some(b) = body {
            builder = builder.body(b);
        }
    }
    if settings.sound_enabled {
        builder = builder.sound("default");
    }
    if let Err(err) = builder.show() {
        eprintln!("notify: failed to show notification: {err}");
    }
}
```

- [ ] **Step 2: Register module and wire into IPC**

In `src-tauri/src/lib.rs`, add `mod notify;`.

In `src-tauri/src/ipc.rs`, replace `notify_message`:

```rust
#[tauri::command]
pub fn notify_message(
    app: AppHandle,
    state: State<'_, AppState>,
    sender: String,
    body: Option<String>,
) {
    let settings = *state.settings.lock().unwrap();
    crate::notify::dispatch(&app, settings, &sender, body.as_deref());
}
```

- [ ] **Step 3: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs src-tauri/src/ipc.rs
git commit -m "feat: dispatch native notifications honoring settings"
```

---

## Task 8: Tray icon with state management

**Files:**
- Create: `src-tauri/icons/tray-normal.png`, `src-tauri/icons/tray-unread.png`, `src-tauri/icons/tray-disconnected.png` (placeholder images)
- Modify: `src-tauri/src/tray.rs` (add `build_tray` + state holder)
- Modify: `src-tauri/src/lib.rs` (call `build_tray` in `setup`)
- Modify: `src-tauri/src/ipc.rs` (wire `report_unread`/`report_disconnected` to tray update)

- [ ] **Step 1: Generate placeholder tray icons**

Run:

```bash
cp src-tauri/icons/icon.png src-tauri/icons/tray-normal.png
cp src-tauri/icons/icon.png src-tauri/icons/tray-unread.png
cp src-tauri/icons/icon.png src-tauri/icons/tray-disconnected.png
```

(They are visually identical for now; art comes later. The code still swaps them, so we'll know the wiring is correct when we later drop in distinct art.)

- [ ] **Step 2: Extend `src-tauri/src/tray.rs`**

Append below the existing `TrayState` definition and tests (keep those intact):

```rust
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager};

pub struct TrayHandle {
    pub icon: TrayIcon,
    pub state: Mutex<TrayState>,
    pub unread: Mutex<u32>,
    pub disconnected: Mutex<bool>,
}

pub fn build_tray(app: &App) -> tauri::Result<TrayHandle> {
    let show = MenuItemBuilder::with_id("show", "Show WhatsApp").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings, &quit])
        .build()?;

    let icon_bytes = include_bytes!("../icons/tray-normal.png");
    let image = Image::from_bytes(icon_bytes)?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(image)
        .tooltip("WhatsApp")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::windows::show_main(app),
            "settings" => crate::windows::show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows::toggle_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(TrayHandle {
        icon: tray,
        state: Mutex::new(TrayState::Normal),
        unread: Mutex::new(0),
        disconnected: Mutex::new(false),
    })
}

pub fn update(app: &AppHandle, unread_opt: Option<u32>, disc_opt: Option<bool>) {
    let handle = match app.try_state::<TrayHandle>() {
        Some(h) => h,
        None => return,
    };
    if let Some(u) = unread_opt {
        *handle.unread.lock().unwrap() = u;
    }
    if let Some(d) = disc_opt {
        *handle.disconnected.lock().unwrap() = d;
    }
    let unread = *handle.unread.lock().unwrap();
    let disconnected = *handle.disconnected.lock().unwrap();
    let new_state = TrayState::derive(unread, disconnected);

    let tooltip = match new_state {
        TrayState::Normal => "WhatsApp".to_string(),
        TrayState::Unread => format!("WhatsApp — {unread} unread"),
        TrayState::Disconnected => "WhatsApp — disconnected".to_string(),
    };
    let _ = handle.icon.set_tooltip(Some(&tooltip));

    let mut current = handle.state.lock().unwrap();
    if *current != new_state {
        let bytes: &[u8] = match new_state {
            TrayState::Normal => include_bytes!("../icons/tray-normal.png"),
            TrayState::Unread => include_bytes!("../icons/tray-unread.png"),
            TrayState::Disconnected => include_bytes!("../icons/tray-disconnected.png"),
        };
        if let Ok(img) = Image::from_bytes(bytes) {
            let _ = handle.icon.set_icon(Some(img));
        }
        *current = new_state;
    }
}
```

- [ ] **Step 3: Wire into `setup` and IPC**

In `src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` block, after `app.manage(AppState { ... })`, add:

```rust
let tray_handle = crate::tray::build_tray(app)?;
app.manage(tray_handle);
```

In `src-tauri/src/ipc.rs`, replace `report_unread` and `report_disconnected`:

```rust
#[tauri::command]
pub fn report_unread(app: AppHandle, count: u32) {
    crate::tray::update(&app, Some(count), None);
}

#[tauri::command]
pub fn report_disconnected(app: AppHandle, disconnected: bool) {
    crate::tray::update(&app, None, Some(disconnected));
}
```

NB: `crate::windows::{show_main, show_settings, toggle_main}` referenced above are created in Task 9. Compilation will fail until Task 9 is done; accept this temporary breakage and move on.

- [ ] **Step 4: Skip build check (intentional broken state until Task 9)**

Do NOT run `cargo check` here — it will fail because `windows.rs` doesn't exist yet. Proceed to Task 9.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: system tray with state-driven icon + tooltip + menu"
```

---

## Task 9: Window management (show/hide/close-to-tray)

**Files:**
- Create: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/windows.rs`**

```rust
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const SETTINGS_LABEL: &str = "settings";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("WhatsApp — Settings")
    .inner_size(480.0, 360.0)
    .min_inner_size(320.0, 240.0)
    .resizable(true)
    .build();
}

pub fn install_close_to_tray(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let tray_present = app.try_state::<crate::tray::TrayHandle>().is_some();
    if !tray_present {
        return;
    }
    let w_clone = w.clone();
    w.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_clone.hide();
        }
    });
}

pub fn show_main_on_startup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.show();
    }
}
```

- [ ] **Step 2: Register module and call from `setup`**

In `src-tauri/src/lib.rs`, add `mod windows;` at the top.

In the `.setup(|app| { ... })` block, after the tray is managed, add:

```rust
let handle = app.handle().clone();
crate::windows::install_close_to_tray(&handle);
crate::windows::show_main_on_startup(&handle);
```

- [ ] **Step 3: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build (the Task 8 breakage is now resolved).

- [ ] **Step 4: Run the full test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all unit tests from Tasks 2, 3, 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/windows.rs src-tauri/src/lib.rs
git commit -m "feat: window management with close-to-tray behavior"
```

---

## Task 10: Injected JS bridge (`inject.js`) attached to main window

**Files:**
- Create: `src-tauri/resources/inject.js`
- Modify: `src-tauri/Cargo.toml` (include resources)
- Modify: `src-tauri/tauri.conf.json` (bundle resources)
- Modify: `src-tauri/src/lib.rs` (inject via `initialization_script` on main window)

- [ ] **Step 1: Write `src-tauri/resources/inject.js`**

```javascript
(function () {
  'use strict';

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
    console.warn('[whats] Tauri IPC not available; bridge disabled.');
    return;
  }
  const { invoke } = tauri.core;

  function safeInvoke(name, args) {
    try {
      return invoke(name, args).catch((e) =>
        console.warn('[whats] invoke', name, 'rejected', e)
      );
    } catch (e) {
      console.warn('[whats] invoke', name, 'threw', e);
    }
  }

  // --- title watcher ---
  function parseUnread(title) {
    const trimmed = (title || '').trimStart();
    if (!trimmed.startsWith('(')) return 0;
    const rest = trimmed.slice(1);
    const m = rest.match(/^(\d+)/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 0;
  }

  let lastUnread = -1;
  function pushTitle() {
    const n = parseUnread(document.title);
    if (n !== lastUnread) {
      lastUnread = n;
      safeInvoke('report_unread', { count: n });
    }
  }
  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(pushTitle).observe(titleEl, {
        subtree: true,
        characterData: true,
        childList: true,
      });
    }
    pushTitle();
  }

  // --- notification interceptor ---
  function installNotificationShim() {
    function Shim(title, options) {
      const body = options && typeof options.body === 'string' ? options.body : null;
      safeInvoke('notify_message', { sender: String(title || ''), body });
      return { close: function () {} };
    }
    Shim.permission = 'granted';
    Shim.requestPermission = function (cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    };
    try {
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: Shim,
      });
    } catch (e) {
      console.warn('[whats] Notification shim install failed', e);
    }
  }

  // --- disconnected detector ---
  let lastDisconnected = null;
  function detectDisconnected() {
    const text = (document.body && document.body.innerText) || '';
    const isDisc =
      /phone not connected/i.test(text) ||
      /computer not connected/i.test(text) ||
      /trouble connecting/i.test(text);
    if (isDisc !== lastDisconnected) {
      lastDisconnected = isDisc;
      safeInvoke('report_disconnected', { disconnected: isDisc });
    }
  }

  // bootstrap: run as soon as DOM is usable
  function boot() {
    installNotificationShim();
    watchTitle();
    detectDisconnected();
    setInterval(detectDisconnected, 5000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
```

- [ ] **Step 2: Declare the script as a resource**

In `src-tauri/tauri.conf.json`, under `bundle`, add (merge with existing keys):

```json
"resources": ["resources/inject.js"]
```

- [ ] **Step 3: Inject on main-window creation**

The main window is declared in `tauri.conf.json` and gets created during `generate_context!()`. Rather than trying to attach an initialization script to a config-created window (which Tauri v2 doesn't support directly), replace the config-declared window with a Rust-built one.

Remove the `windows` entry from `src-tauri/tauri.conf.json` (set `"windows": []`).

In `src-tauri/src/lib.rs`, inside `setup`, before `install_close_to_tray`, create the main window:

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

let inject_path = app
    .path()
    .resource_dir()?
    .join("resources/inject.js");
let inject_js = std::fs::read_to_string(&inject_path)
    .unwrap_or_else(|e| {
        eprintln!("inject.js not found at {inject_path:?}: {e}");
        String::new()
    });

let _main = WebviewWindowBuilder::new(
    app,
    "main",
    WebviewUrl::External("https://web.whatsapp.com/".parse().unwrap()),
)
.title("WhatsApp")
.inner_size(1200.0, 800.0)
.min_inner_size(600.0, 400.0)
.visible(false)
.initialization_script(&inject_js)
.build()?;
```

The webview profile (cookies, IndexedDB) persists by default at `<app data dir>/<window-label>/EBWebView` (Windows), `<app data dir>/<window-label>` (Linux/macOS). We do not call `data_directory(...)`, so Tauri uses this default — which is exactly what the spec requires. Don't override it.

(Imports at top of file: add `use tauri::Manager;` if not already imported via prior tasks — it already is through other modules.)

- [ ] **Step 4: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all unit tests still pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: inject JS bridge into main window for title + notifications"
```

---

## Task 10b: JS unit tests for inject.js helpers (vitest)

**Files:**
- Create: `src-tauri/resources/inject.lib.js` (extract pure helpers from `inject.js`)
- Modify: `src-tauri/resources/inject.js` (use the extracted helpers)
- Create: `tests/inject.test.js`
- Modify: `package.json` (add vitest dev-dep + `test` script)
- Modify: `vite.config.ts` (add vitest config)

- [ ] **Step 1: Add vitest dep**

Run:

```bash
npm install -D vitest @vitest/ui jsdom
```

In `package.json` `scripts`, add:

```json
"test": "vitest run"
```

In `vite.config.ts`, add `test` to the exported config:

```ts
test: {
  environment: 'jsdom',
  include: ['tests/**/*.test.js'],
}
```

(If `defineConfig` is imported from `vite` instead of `vitest/config`, switch the import to `import { defineConfig } from 'vitest/config';` so the `test` key typechecks.)

- [ ] **Step 2: Extract pure helpers**

Create `src-tauri/resources/inject.lib.js`:

```javascript
export function parseUnread(title) {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const m = trimmed.slice(1).match(/^(\d+)/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

export function makeNotificationShim(invokeFn) {
  function Shim(title, options) {
    const body = options && typeof options.body === 'string' ? options.body : null;
    invokeFn('notify_message', { sender: String(title || ''), body });
    return { close: function () {} };
  }
  Shim.permission = 'granted';
  Shim.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  return Shim;
}
```

In `src-tauri/resources/inject.js`, replace the inline `parseUnread` and the body of `installNotificationShim` to use the library. Because the script is loaded as `initialization_script` (no module support there), inline-include the helpers by prepending the file content. The simplest approach: keep `inject.js` self-contained but copy the helper bodies from `inject.lib.js` verbatim. Tests import from `inject.lib.js`; the runtime injected script duplicates them. Add a comment in `inject.js`:

```javascript
// NOTE: parseUnread and notification shim mirror src-tauri/resources/inject.lib.js,
// which is the unit-tested source of truth. Keep them in sync.
```

- [ ] **Step 3: Write the failing tests**

Create `tests/inject.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { parseUnread, makeNotificationShim } from '../src-tauri/resources/inject.lib.js';

describe('parseUnread', () => {
  it('returns 0 with no parens', () => expect(parseUnread('WhatsApp')).toBe(0));
  it('parses simple count', () => expect(parseUnread('(3) WhatsApp')).toBe(3));
  it('handles 0', () => expect(parseUnread('(0) WhatsApp')).toBe(0));
  it('handles large counts', () => expect(parseUnread('(120) WhatsApp')).toBe(120));
  it('returns 0 for garbage', () => expect(parseUnread('hello')).toBe(0));
  it('returns 0 for non-numeric parens', () => expect(parseUnread('(abc) X')).toBe(0));
  it('returns 0 for null/undefined', () => {
    expect(parseUnread(null)).toBe(0);
    expect(parseUnread(undefined)).toBe(0);
  });
});

describe('notification shim', () => {
  it('invokes notify_message with sender + body', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new Shim('Alice', { body: 'hi' });
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Alice', body: 'hi' });
  });
  it('passes null body when options omitted', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new Shim('Bob');
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Bob', body: null });
  });
  it('exposes permission as granted', () => {
    const Shim = makeNotificationShim(() => {});
    expect(Shim.permission).toBe('granted');
  });
  it('requestPermission resolves to granted', async () => {
    const Shim = makeNotificationShim(() => {});
    await expect(Shim.requestPermission()).resolves.toBe('granted');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: vitest coverage for inject.js helpers"
```

---

## Task 11: Settings window React UI

**Files:**
- Modify: `src/App.tsx` (replace with settings UI)
- Create: `src/settingsApi.ts`
- Modify: `src/main.tsx` (ensure mounts `App`)
- Modify: `src/styles.css` (trim to simple settings styling)

- [ ] **Step 1: Create `src/settingsApi.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  include_preview: boolean;
}

export async function getSettings(): Promise<Settings> {
  return await invoke<Settings>('get_settings');
}

export async function setSettings(s: Settings): Promise<void> {
  await invoke('set_settings', { newSettings: s });
}
```

- [ ] **Step 2: Replace `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { getSettings, setSettings, type Settings } from './settingsApi';
import './styles.css';

export default function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setLocal).catch((e) => setError(String(e)));
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    try {
      await setSettings(next);
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) return <div className="settings"><p className="err">Error: {error}</p></div>;
  if (!settings) return <div className="settings"><p>Loading…</p></div>;

  return (
    <div className="settings">
      <h1>Settings</h1>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.notifications_enabled}
          onChange={(e) => update({ notifications_enabled: e.target.checked })}
        />
        <span>Show notifications</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.sound_enabled}
          onChange={(e) => update({ sound_enabled: e.target.checked })}
          disabled={!settings.notifications_enabled}
        />
        <span>Play sound on notification</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.include_preview}
          onChange={(e) => update({ include_preview: e.target.checked })}
          disabled={!settings.notifications_enabled}
        />
        <span>Include message preview</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Ensure `src/main.tsx` mounts App**

`src/main.tsx` should look like:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

If the scaffold already matches, no change. If not, replace.

- [ ] **Step 4: Replace `src/styles.css`**

```css
body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; }
.settings { max-width: 400px; }
.settings h1 { font-size: 1.25rem; margin-bottom: 1rem; }
.row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; }
.row input[type="checkbox"]:disabled + span { opacity: 0.5; }
.err { color: #b00020; }
```

- [ ] **Step 5: Verify frontend typechecks**

Run: `npm run build` (this runs `tsc -b && vite build` per scaffold default)
Expected: build succeeds, `dist/` produced.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: react settings window with three toggles"
```

---

## Task 12: Manual test checklist + final wiring verification

**Files:**
- Create: `docs/superpowers/specs/manual-test-checklist.md`

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/specs/manual-test-checklist.md`:

```markdown
# WhatsApp Desktop — Manual Test Checklist

Run with `npm run tauri dev` from the repo root.

## First run

- [ ] App launches; WhatsApp window opens and shows the QR code.
- [ ] Scan QR with phone → chats load.
- [ ] Tray icon appears. Tooltip reads "WhatsApp".

## Auth persistence

- [ ] Quit via tray → `Quit`. Process exits.
- [ ] Relaunch `npm run tauri dev`. WhatsApp auto-resumes, no QR.

## Unread + tray

- [ ] Send a message from another phone. Tray tooltip updates to "WhatsApp — N unread".
- [ ] Open the chat. Tooltip returns to "WhatsApp".
- [ ] Tray icon image visibly changes between normal/unread (once distinct art is dropped in).

## Notifications

- [ ] Defaults: incoming message → OS notification titled with sender, NO body, default sound plays.
- [ ] Open Settings (tray → Settings…). Toggle "Show notifications" off → incoming message fires no notification.
- [ ] Toggle back on, toggle "Play sound" off → notification silent.
- [ ] Toggle "Include message preview" on → notification body contains first line of message.

## Window behaviour

- [ ] Click WhatsApp window close (X). Window hides. App still in tray. Notifications still arrive.
- [ ] Left-click tray → WhatsApp window reappears focused.
- [ ] Left-click tray again → window hides.
- [ ] Right-click tray → menu shows Show / Settings… / Quit.

## Disconnected state

- [ ] Put phone in airplane mode. After WhatsApp Web shows its "Phone not connected" banner, tray tooltip becomes "WhatsApp — disconnected".
- [ ] Restore phone connection. Tooltip reverts to normal or unread.

## Single-instance

- [ ] While the app is running, launch `npm run tauri dev` again in a second terminal. The existing WhatsApp window focuses; no second process.

## Settings persistence

- [ ] Change any setting. Quit via tray. Relaunch. Setting is preserved.
```

- [ ] **Step 2: Run a final full build check**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: tests pass, Rust builds clean, Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/manual-test-checklist.md
git commit -m "docs: manual test checklist"
```

---

## Done

At this point:
- Rust core has unit-tested helpers for title parsing, tray-state derivation, and settings persistence.
- Tauri app has two windows (WhatsApp, Settings), a tray with three-state icon + tooltip + menu, and native notifications gated on user settings.
- A JS bridge injected into the WhatsApp webview forwards unread count and new-message events to Rust.
- Auth survives restart via the persistent webview profile in the OS app-data dir.
- The manual checklist covers the remaining human-visible behaviour.

Out of scope for this plan (see spec "Open questions / future work"): final tray icon art, additional settings, multi-account support.
