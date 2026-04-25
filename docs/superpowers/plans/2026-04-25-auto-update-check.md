# Auto-Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in startup check that informs the user when a newer version of `whats` has been published on GitHub, with a manual "Check now" button and a 3-strike failure notification.

**Architecture:** A new Rust module `updater.rs` exposes a pure `decide_update` function and an isolated `fetch_latest_release` HTTP fetcher. `lib.rs` setup spawns a 5-second-delayed background task on startup (when enabled) that calls these and opens a new `update` webview window when a newer version is found. A new IPC `check_for_updates_now` powers a manual check button in Settings. Settings gain `auto_update_check_enabled` and an internal `update_state` (`last_checked_at`, `skipped_version`, `consecutive_failures`).

**Tech Stack:** Rust (`reqwest` rustls, `semver`), Tauri v2 (existing IPC + window patterns), React + TypeScript (existing dialog window pattern), `vitest`.

**Design spec:** `docs/superpowers/specs/2026-04-25-auto-update-check-design.md` — read before starting.

**Conventions for every task:**
- After every step that changes Rust code or `Cargo.toml`, run `cargo check --manifest-path src-tauri/Cargo.toml` to catch breakage early.
- Run Rust unit tests with `cargo test --manifest-path src-tauri/Cargo.toml`.
- Run frontend tests with `npm test`.
- Commit at the end of each task. Use conventional-commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).
- All paths are relative to repo root `/data/projects/whats/`.
- Use `rg` instead of `grep`, `fdfind` instead of `find`.

---

## File Structure

**New files:**
- `src-tauri/src/updater.rs` — pure `decide_update`, isolated `fetch_latest_release`, `UpdateInfo`/`ReleaseInfo`/`UpdateError` types
- `src/updateApi.ts` — TypeScript IPC bindings for the new commands

**Modified files:**
- `src-tauri/Cargo.toml` — add `reqwest`, `semver` deps
- `src-tauri/src/settings.rs` — add `auto_update_check_enabled` and `UpdateState`
- `src-tauri/src/lib.rs` — register module, register IPC commands, spawn startup check task, add `show_update_window` call site
- `src-tauri/src/ipc.rs` — add `get_update_info`, `check_for_updates_now`, `set_skipped_version`, extend `AppState` with current update info slot
- `src-tauri/src/windows.rs` — add `show_update_window` (reuses `show_dialog_window`)
- `src-tauri/src/notify.rs` — add `notify_update_check_failed` helper
- `src-tauri/permissions/whats/commands.toml` — register new commands
- `src-tauri/capabilities/whats.json` — add `"update"` window
- `src/settingsApi.ts` — add `auto_update_check_enabled` to `Settings` interface
- `src/App.tsx` — render `UpdateView` when window label is `update`; add checkbox + "Check now" button to `SettingsView`
- `src/styles.css` — add `.update` modifier styles

---

## Task 1: Add `reqwest` and `semver` dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add deps to `[dependencies]` block**

Open `src-tauri/Cargo.toml` and add these lines under `[dependencies]`, after the existing `serde_json = "1"` line:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
semver = "1"
```

Rationale: `default-features = false` + `rustls-tls` avoids pulling OpenSSL on Linux. `json` enables `Response::json::<T>()`.

- [ ] **Step 2: Verify it builds**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build (warnings about unused crates are OK; we'll use them next).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add reqwest and semver deps for update check"
```

---

## Task 2: Extend `Settings` with new fields (TDD)

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Test: `src-tauri/src/settings.rs` (existing `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write failing tests**

Open `src-tauri/src/settings.rs` and **add** these tests at the end of the existing `mod tests {}` block (just before its closing `}`):

```rust
    #[test]
    fn defaults_have_auto_update_enabled() {
        let s = Settings::default();
        assert!(s.auto_update_check_enabled);
        assert!(s.update_state.last_checked_at.is_none());
        assert!(s.update_state.skipped_version.is_none());
        assert_eq!(s.update_state.consecutive_failures, 0);
    }

    #[test]
    fn legacy_settings_file_loads_with_defaults_filled_in() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Old shape: only the original three fields, no auto-update fields
        fs::write(
            &path,
            br#"{"notifications_enabled":true,"sound_enabled":false,"include_preview":true}"#,
        )
        .unwrap();
        let s = Settings::load_or_default(&path);
        assert_eq!(s.notifications_enabled, true);
        assert_eq!(s.sound_enabled, false);
        assert_eq!(s.include_preview, true);
        assert!(s.auto_update_check_enabled, "missing field should default to true");
        assert_eq!(s.update_state.consecutive_failures, 0);
        assert!(s.update_state.last_checked_at.is_none());
        assert!(s.update_state.skipped_version.is_none());
    }

    #[test]
    fn round_trip_with_update_state() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
            auto_update_check_enabled: false,
            update_state: UpdateState {
                last_checked_at: Some(1_700_000_000),
                skipped_version: Some("v0.2.0".to_string()),
                consecutive_failures: 2,
            },
        };
        s.save(&path).unwrap();
        let loaded = Settings::load_or_default(&path);
        assert_eq!(loaded, s);
    }
```

- [ ] **Step 2: Run tests — they should fail to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::tests`
Expected: compile errors about missing fields `auto_update_check_enabled`, `update_state`, and missing type `UpdateState`. Also note: existing test `round_trip` will need updating in step 3.

- [ ] **Step 3: Add `UpdateState` and extend `Settings`**

In `src-tauri/src/settings.rs`, replace the `Settings` struct, its `Default` impl, and add a new `UpdateState` struct.

Replace:

```rust
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
```

With:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub include_preview: bool,
    #[serde(default = "default_auto_update_check_enabled")]
    pub auto_update_check_enabled: bool,
    #[serde(default)]
    pub update_state: UpdateState,
}

fn default_auto_update_check_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateState {
    #[serde(default)]
    pub last_checked_at: Option<i64>,
    #[serde(default)]
    pub skipped_version: Option<String>,
    #[serde(default)]
    pub consecutive_failures: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
            auto_update_check_enabled: true,
            update_state: UpdateState::default(),
        }
    }
}
```

Note the change from `Copy` to non-`Copy` (since `UpdateState` contains `String`).

- [ ] **Step 4: Update existing `round_trip` test to include the new fields**

In `src-tauri/src/settings.rs`, the existing test:

```rust
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
```

Becomes:

```rust
#[test]
fn round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let s = Settings {
        notifications_enabled: false,
        sound_enabled: false,
        include_preview: true,
        auto_update_check_enabled: true,
        update_state: UpdateState::default(),
    };
    s.save(&path).unwrap();
    let loaded = Settings::load_or_default(&path);
    assert_eq!(loaded, s);
}
```

- [ ] **Step 5: Audit `Copy`-removal call sites**

`Settings` is no longer `Copy`. Search for places that rely on `Copy`:

Run: `rg -n 'state\.settings\.lock\(\)\.unwrap\(\)' src-tauri/src/`
Expected hits in `ipc.rs`:
- `pub fn get_settings(state: State<'_, AppState>) -> Settings { *state.settings.lock().unwrap() }`
- `let settings = *state.settings.lock().unwrap();` (in `notify_message`)

Both rely on dereferencing the `MutexGuard` to get an owned `Settings` via `Copy`. Update them by cloning instead.

In `src-tauri/src/ipc.rs`:

Replace:

```rust
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    *state.settings.lock().unwrap()
}
```

With:

```rust
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}
```

And in `notify_message`, replace:

```rust
    let settings = *state.settings.lock().unwrap();
```

With:

```rust
    let settings = state.settings.lock().unwrap().clone();
```

Also, in `notify.rs`, the `dispatch` signature takes `Settings` by value:

```rust
pub fn dispatch(app: &AppHandle, settings: Settings, sender: &str, body: Option<&str>) {
```

This still works (we pass by value, just no longer free via `Copy`). No change needed there.

- [ ] **Step 6: Run tests — should now pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::tests`
Expected: all settings tests pass, including the three new ones.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/ipc.rs
git commit -m "feat(settings): add auto_update_check_enabled and update_state"
```

---

## Task 3: Pure `decide_update` function (TDD)

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod updater;`)

- [ ] **Step 1: Create `updater.rs` skeleton with types and module declaration**

Create `src-tauri/src/updater.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub released_at: String,
    pub body_excerpt: String,
    pub html_url: String,
}

pub fn decide_update(
    _current: &str,
    _latest_tag: &str,
    _skipped_version: Option<&str>,
) -> Option<()> {
    // placeholder; replaced in next step
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // tests added in next step
    #[test]
    fn placeholder() {
        let _ = decide_update("0.1.0", "v0.2.0", None);
    }
}
```

In `src-tauri/src/lib.rs`, add `mod updater;` to the existing module list at the top:

```rust
mod title_parse;
mod build_info;
mod tray;
mod settings;
mod ipc;
mod notify;
mod windows;
mod updater;
```

- [ ] **Step 2: Run check to make sure it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 3: Write failing tests for `decide_update`**

Replace the test module in `src-tauri/src/updater.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_release_returns_some() {
        let info = decide_update("0.1.0", "v0.2.0", None);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.current_version, "0.1.0");
        assert_eq!(info.latest_version, "v0.2.0");
    }

    #[test]
    fn equal_versions_returns_none() {
        assert!(decide_update("0.2.0", "v0.2.0", None).is_none());
        assert!(decide_update("0.2.0", "0.2.0", None).is_none());
    }

    #[test]
    fn older_release_returns_none() {
        assert!(decide_update("0.3.0", "v0.2.0", None).is_none());
    }

    #[test]
    fn semver_compare_not_lexical() {
        // 0.10.0 > 0.2.0 in semver, but < lexically
        assert!(decide_update("0.2.0", "v0.10.0", None).is_some());
    }

    #[test]
    fn skipped_exact_match_returns_none() {
        assert!(decide_update("0.1.0", "v0.2.0", Some("v0.2.0")).is_none());
        // also matches without v-prefix variation: skip is "v0.2.0", tag is "v0.2.0"
    }

    #[test]
    fn skipped_older_than_latest_does_not_suppress() {
        // user skipped v0.1.5; v0.2.0 has since been released — they should still see it
        assert!(decide_update("0.1.0", "v0.2.0", Some("v0.1.5")).is_some());
    }

    #[test]
    fn garbage_versions_return_none_no_panic() {
        assert!(decide_update("not-a-version", "v0.2.0", None).is_none());
        assert!(decide_update("0.1.0", "not-a-version", None).is_none());
        assert!(decide_update("", "", None).is_none());
    }
}
```

Now update the `decide_update` signature to return `Option<UpdateInfo>` (not `Option<()>`). Replace the function body:

```rust
pub fn decide_update(
    current: &str,
    latest_tag: &str,
    skipped_version: Option<&str>,
) -> Option<UpdateInfo> {
    None
}
```

- [ ] **Step 4: Run tests — they should fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml updater::tests`
Expected: most tests fail (assertions about `is_some()` return false). No compile errors.

- [ ] **Step 5: Implement `decide_update`**

Replace the body of `decide_update` in `src-tauri/src/updater.rs`:

```rust
pub fn decide_update(
    current: &str,
    latest_tag: &str,
    skipped_version: Option<&str>,
) -> Option<UpdateInfo> {
    if let Some(skipped) = skipped_version {
        if skipped == latest_tag {
            return None;
        }
    }

    let current_v = match semver::Version::parse(strip_v(current)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("updater: failed to parse current version {current:?}: {e}");
            return None;
        }
    };
    let latest_v = match semver::Version::parse(strip_v(latest_tag)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("updater: failed to parse latest tag {latest_tag:?}: {e}");
            return None;
        }
    };

    if latest_v <= current_v {
        return None;
    }

    Some(UpdateInfo {
        current_version: current.to_string(),
        latest_version: latest_tag.to_string(),
        release_name: String::new(),
        released_at: String::new(),
        body_excerpt: String::new(),
        html_url: String::new(),
    })
}

fn strip_v(s: &str) -> &str {
    s.strip_prefix('v').unwrap_or(s)
}
```

The non-version metadata fields (`release_name`, `released_at`, `body_excerpt`, `html_url`) are populated by the caller from the `ReleaseInfo`; `decide_update` only handles the version comparison. The unit tests above only check `current_version` and `latest_version`.

- [ ] **Step 6: Run tests — should pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml updater::tests`
Expected: all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat(updater): add pure decide_update with semver comparison"
```

---

## Task 4: HTTP fetcher `fetch_latest_release`

**Files:**
- Modify: `src-tauri/src/updater.rs`

This task is **not TDD** — testing real HTTP requires a mock server (extra dep) and the function is mostly thin glue around `reqwest`. We'll cover it via the manual smoke tests in the spec. The pure parsing and decision logic *is* unit-tested.

- [ ] **Step 1: Add the HTTP types and function**

Append to `src-tauri/src/updater.rs`, before the `#[cfg(test)]` block:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseInfo {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    pub html_url: String,
}

#[derive(Debug)]
pub enum FetchOutcome {
    Found(ReleaseInfo),
    NoReleases,
    Failed(String),
}

pub async fn fetch_latest_release(repo: &str, app_version: &str) -> FetchOutcome {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let user_agent = format!("whats-desktop/{app_version}");

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(user_agent)
        .build()
    {
        Ok(c) => c,
        Err(e) => return FetchOutcome::Failed(format!("client build: {e}")),
    };

    let response = match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return FetchOutcome::Failed(format!("request: {e}")),
    };

    let status = response.status();
    if status.as_u16() == 404 {
        return FetchOutcome::NoReleases;
    }
    if !status.is_success() {
        return FetchOutcome::Failed(format!("http {status}"));
    }

    match response.json::<ReleaseInfo>().await {
        Ok(info) => FetchOutcome::Found(info),
        Err(e) => FetchOutcome::Failed(format!("parse: {e}")),
    }
}

pub fn body_excerpt(body: Option<&str>, max_chars: usize) -> String {
    let raw = body.unwrap_or("").trim();
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    let truncated: String = raw.chars().take(max_chars).collect();
    format!("{truncated}…")
}
```

- [ ] **Step 2: Add unit tests for `body_excerpt`**

In the `mod tests` block in `src-tauri/src/updater.rs`, append:

```rust
    #[test]
    fn body_excerpt_short_returns_input() {
        assert_eq!(body_excerpt(Some("hello"), 500), "hello");
    }

    #[test]
    fn body_excerpt_trims_whitespace() {
        assert_eq!(body_excerpt(Some("  hi  "), 500), "hi");
    }

    #[test]
    fn body_excerpt_none_returns_empty() {
        assert_eq!(body_excerpt(None, 500), "");
    }

    #[test]
    fn body_excerpt_truncates_with_ellipsis() {
        let long = "a".repeat(600);
        let out = body_excerpt(Some(&long), 500);
        assert_eq!(out.chars().count(), 501); // 500 + ellipsis char
        assert!(out.ends_with('…'));
    }
```

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml updater::tests`
Expected: all 11 tests pass (7 from Task 3 + 4 new).

- [ ] **Step 4: Run check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/updater.rs
git commit -m "feat(updater): add fetch_latest_release HTTP fetcher"
```

---

## Task 5: Wire `UpdateInfo` into `AppState` and add `get_update_info` IPC

**Files:**
- Modify: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/permissions/whats/commands.toml`

- [ ] **Step 1: Extend `AppState` with current update slot**

Open `src-tauri/src/ipc.rs`. Add an import and extend the struct.

At the top, the existing imports include `use crate::settings::Settings;`. Add:

```rust
use crate::updater::UpdateInfo;
```

Replace the `AppState` struct definition:

```rust
pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub last_notification: Mutex<Option<(Instant, String, String)>>,
}
```

With:

```rust
pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub last_notification: Mutex<Option<(Instant, String, String)>>,
    pub current_update: Mutex<Option<UpdateInfo>>,
}
```

- [ ] **Step 2: Update `AppState` initialization in `lib.rs`**

In `src-tauri/src/lib.rs`, find:

```rust
            app.manage(crate::ipc::AppState {
                settings: std::sync::Mutex::new(settings),
                settings_path,
                last_notification: std::sync::Mutex::new(None),
            });
```

Replace with:

```rust
            app.manage(crate::ipc::AppState {
                settings: std::sync::Mutex::new(settings),
                settings_path,
                last_notification: std::sync::Mutex::new(None),
                current_update: std::sync::Mutex::new(None),
            });
```

- [ ] **Step 3: Add `get_update_info` IPC**

Append to `src-tauri/src/ipc.rs` (after `open_external`, before the `#[cfg(test)]` block):

```rust
#[tauri::command]
pub fn get_update_info(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    state
        .current_update
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no update info available".to_string())
}
```

- [ ] **Step 4: Register `get_update_info` in `lib.rs` invoke handler**

In `src-tauri/src/lib.rs`, find the `invoke_handler(tauri::generate_handler![...])` call. Add `crate::ipc::get_update_info,` to the list (a placement next to `crate::ipc::get_build_info,` is fine):

```rust
        .invoke_handler(tauri::generate_handler![
            crate::ipc::get_build_info,
            crate::ipc::get_update_info,
            crate::ipc::get_settings,
            crate::ipc::set_settings,
            crate::ipc::report_unread,
            crate::ipc::report_disconnected,
            crate::ipc::notify_message,
            crate::ipc::preview_notification,
            crate::ipc::preview_sound,
            crate::ipc::open_external,
        ])
```

- [ ] **Step 5: Add the matching permission**

Open `src-tauri/permissions/whats/commands.toml`. In the `[default]` permissions list, add `"allow-get-update-info",` (after `"allow-get-build-info",` is fine). Then append a new permission block at the end of the file:

```toml
[[permission]]
identifier = "allow-get-update-info"
description = "Read the currently-detected update info (if any)"
commands.allow = ["get_update_info"]
```

- [ ] **Step 6: Build check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/src/lib.rs src-tauri/permissions/whats/commands.toml
git commit -m "feat(ipc): add get_update_info command and current_update state slot"
```

---

## Task 6: Add `set_skipped_version` IPC

**Files:**
- Modify: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/permissions/whats/commands.toml`

- [ ] **Step 1: Add the IPC command**

In `src-tauri/src/ipc.rs`, append (after `get_update_info`):

```rust
#[tauri::command]
pub fn set_skipped_version(
    state: State<'_, AppState>,
    tag: String,
) -> Result<(), String> {
    let mut guard = state.settings.lock().unwrap();
    guard.update_state.skipped_version = Some(tag);
    let snapshot = guard.clone();
    drop(guard);
    snapshot.save(&state.settings_path).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Register in `lib.rs` invoke handler**

In `src-tauri/src/lib.rs`, add `crate::ipc::set_skipped_version,` to the `invoke_handler` list (after `set_settings`).

- [ ] **Step 3: Add the permission**

In `src-tauri/permissions/whats/commands.toml`, add `"allow-set-skipped-version",` to the `[default]` list, and append:

```toml
[[permission]]
identifier = "allow-set-skipped-version"
description = "Persist a version tag the user wants to skip"
commands.allow = ["set_skipped_version"]
```

- [ ] **Step 4: Build check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/src/lib.rs src-tauri/permissions/whats/commands.toml
git commit -m "feat(ipc): add set_skipped_version command"
```

---

## Task 7: Add `show_update_window`

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/capabilities/whats.json`

- [ ] **Step 1: Add window label constant and helper**

In `src-tauri/src/windows.rs`, add a new constant near the existing ones:

```rust
const UPDATE_LABEL: &str = "update";
```

After `show_about`, add:

```rust
pub fn show_update_window(app: &AppHandle) {
    show_dialog_window(
        app,
        UPDATE_LABEL,
        "WhatsApp — Update available",
        480.0,
        420.0,
        360.0,
        320.0,
    );
}
```

- [ ] **Step 2: Allow the new window in capabilities**

Open `src-tauri/capabilities/whats.json`. Update the `windows` array from:

```json
"windows": ["main", "settings", "about"],
```

To:

```json
"windows": ["main", "settings", "about", "update"],
```

- [ ] **Step 3: Build check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build (warning about unused `show_update_window` is OK; we wire it up next task).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/windows.rs src-tauri/capabilities/whats.json
git commit -m "feat(windows): add update dialog window helper"
```

---

## Task 8: Add `notify_update_check_failed` helper

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Add the helper function**

Append to `src-tauri/src/notify.rs` (after `preview`, before `const SOUND_FILE`):

```rust
pub fn update_check_failed(app: &AppHandle, settings: &Settings) {
    if !settings.notifications_enabled {
        eprintln!("notify::update_check_failed: skipped (notifications_enabled=false)");
        return;
    }
    show(
        app,
        "WhatsApp",
        "Couldn't check for updates — please verify your internet connection.",
        false,
    );
}
```

`Settings` is borrowed (no `Copy` anymore). The function suppresses notifications when the user has disabled them globally, per the spec.

- [ ] **Step 2: Build check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build (warning about unused fn is OK).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "feat(notify): add update_check_failed helper"
```

---

## Task 9: Background startup check

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/updater.rs` (adds the orchestration entry point)

- [ ] **Step 1: Add helpers to `updater.rs` for the orchestration**

Append to `src-tauri/src/updater.rs` (before `#[cfg(test)]`):

```rust
pub const REPO: &str = "IgorKvasn/whats";
pub const THROTTLE_SECONDS: i64 = 24 * 60 * 60;
pub const FAILURE_THRESHOLD: u32 = 3;
pub const BODY_EXCERPT_MAX_CHARS: usize = 500;

pub fn should_run_check(now_unix: i64, last_checked_at: Option<i64>) -> bool {
    match last_checked_at {
        None => true,
        Some(t) => now_unix - t >= THROTTLE_SECONDS,
    }
}
```

In the `#[cfg(test)] mod tests`, append:

```rust
    #[test]
    fn should_run_when_never_checked() {
        assert!(should_run_check(1_700_000_000, None));
    }

    #[test]
    fn should_skip_when_recently_checked() {
        let now = 1_700_000_000;
        let last = now - 1000;
        assert!(!should_run_check(now, Some(last)));
    }

    #[test]
    fn should_run_after_24h() {
        let now = 1_700_000_000;
        let last = now - THROTTLE_SECONDS;
        assert!(should_run_check(now, Some(last)));
    }

    #[test]
    fn should_run_just_past_24h() {
        let now = 1_700_000_000;
        let last = now - THROTTLE_SECONDS - 1;
        assert!(should_run_check(now, Some(last)));
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml updater::tests`
Expected: all tests pass (15 total now).

- [ ] **Step 2: Add the spawn site in `lib.rs`**

In `src-tauri/src/lib.rs`, the `setup` closure currently ends with:

```rust
            let handle = app.handle().clone();
            crate::windows::install_close_to_tray(&handle);
            Ok(())
```

Replace those three lines with:

```rust
            let handle = app.handle().clone();
            crate::windows::install_close_to_tray(&handle);

            let auto_check = {
                let state = handle.state::<crate::ipc::AppState>();
                state.settings.lock().unwrap().auto_update_check_enabled
            };
            if auto_check {
                let handle_for_task = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    crate::updater::run_startup_check(&handle_for_task).await;
                });
            }

            Ok(())
```

- [ ] **Step 3: Add `run_startup_check` and persistence helpers in `updater.rs`**

Append to `src-tauri/src/updater.rs` (before `#[cfg(test)]`):

```rust
pub async fn run_startup_check(app: &tauri::AppHandle) {
    use tauri::Manager;
    let state = app.state::<crate::ipc::AppState>();

    let (last_checked_at, skipped_version) = {
        let s = state.settings.lock().unwrap();
        (s.update_state.last_checked_at, s.update_state.skipped_version.clone())
    };

    let now = current_unix_seconds();
    if !should_run_check(now, last_checked_at) {
        eprintln!("updater: throttled (last_checked_at={last_checked_at:?})");
        return;
    }

    let app_version = env!("CARGO_PKG_VERSION");
    match fetch_latest_release(REPO, app_version).await {
        FetchOutcome::Failed(err) => {
            eprintln!("updater: fetch failed: {err}");
            handle_failure(app);
        }
        FetchOutcome::NoReleases => {
            eprintln!("updater: repo has no releases yet");
            record_success(app, now);
        }
        FetchOutcome::Found(release) => {
            record_success(app, now);
            if let Some(mut info) =
                decide_update(app_version, &release.tag_name, skipped_version.as_deref())
            {
                info.release_name = release
                    .name
                    .clone()
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| release.tag_name.clone());
                info.released_at = release.published_at.clone().unwrap_or_default();
                info.body_excerpt = body_excerpt(release.body.as_deref(), BODY_EXCERPT_MAX_CHARS);
                info.html_url = release.html_url.clone();

                {
                    let mut slot = state.current_update.lock().unwrap();
                    *slot = Some(info);
                }
                let app_clone = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::windows::show_update_window(&app_clone);
                });
            }
        }
    }
}

fn current_unix_seconds() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn record_success(app: &tauri::AppHandle, now: i64) {
    use tauri::Manager;
    let state = app.state::<crate::ipc::AppState>();
    let snapshot = {
        let mut s = state.settings.lock().unwrap();
        s.update_state.last_checked_at = Some(now);
        s.update_state.consecutive_failures = 0;
        s.clone()
    };
    if let Err(e) = snapshot.save(&state.settings_path) {
        eprintln!("updater: persist failed: {e}");
    }
}

fn handle_failure(app: &tauri::AppHandle) {
    use tauri::Manager;
    let state = app.state::<crate::ipc::AppState>();
    let (snapshot, fire_notification) = {
        let mut s = state.settings.lock().unwrap();
        s.update_state.consecutive_failures = s.update_state.consecutive_failures.saturating_add(1);
        let fire = s.update_state.consecutive_failures >= FAILURE_THRESHOLD;
        if fire {
            s.update_state.consecutive_failures = 0;
        }
        (s.clone(), fire)
    };
    if let Err(e) = snapshot.save(&state.settings_path) {
        eprintln!("updater: persist failed: {e}");
    }
    if fire_notification {
        crate::notify::update_check_failed(app, &snapshot);
    }
}
```

- [ ] **Step 4: Build and test**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat(updater): wire background startup check with throttle and 3-strike notification"
```

---

## Task 10: `check_for_updates_now` IPC (manual check)

**Files:**
- Modify: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/permissions/whats/commands.toml`

- [ ] **Step 1: Add `ManualCheckResult` and `run_manual_check` in `updater.rs`**

Append to `src-tauri/src/updater.rs` (before `#[cfg(test)]`):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ManualCheckResult {
    UpdateAvailable,
    UpToDate { current: String },
    Failed { error: String },
}

pub async fn run_manual_check(app: &tauri::AppHandle) -> ManualCheckResult {
    use tauri::Manager;
    let state = app.state::<crate::ipc::AppState>();
    let app_version = env!("CARGO_PKG_VERSION");

    match fetch_latest_release(REPO, app_version).await {
        FetchOutcome::Failed(err) => ManualCheckResult::Failed { error: err },
        FetchOutcome::NoReleases => {
            record_success(app, current_unix_seconds());
            ManualCheckResult::UpToDate {
                current: app_version.to_string(),
            }
        }
        FetchOutcome::Found(release) => {
            record_success(app, current_unix_seconds());
            // Manual check: ignore skipped_version
            if let Some(mut info) = decide_update(app_version, &release.tag_name, None) {
                info.release_name = release
                    .name
                    .clone()
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| release.tag_name.clone());
                info.released_at = release.published_at.clone().unwrap_or_default();
                info.body_excerpt = body_excerpt(release.body.as_deref(), BODY_EXCERPT_MAX_CHARS);
                info.html_url = release.html_url.clone();
                {
                    let mut slot = state.current_update.lock().unwrap();
                    *slot = Some(info);
                }
                let app_clone = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::windows::show_update_window(&app_clone);
                });
                ManualCheckResult::UpdateAvailable
            } else {
                ManualCheckResult::UpToDate {
                    current: app_version.to_string(),
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add the IPC command in `ipc.rs`**

Append to `src-tauri/src/ipc.rs`:

```rust
#[tauri::command]
pub async fn check_for_updates_now(app: AppHandle) -> crate::updater::ManualCheckResult {
    crate::updater::run_manual_check(&app).await
}
```

- [ ] **Step 3: Register in `lib.rs` and add permission**

In `src-tauri/src/lib.rs`, add `crate::ipc::check_for_updates_now,` to the `invoke_handler` list (next to `set_skipped_version` is fine).

In `src-tauri/permissions/whats/commands.toml`, add `"allow-check-for-updates-now",` to `[default]`, and append:

```toml
[[permission]]
identifier = "allow-check-for-updates-now"
description = "Manually trigger an update check"
commands.allow = ["check_for_updates_now"]
```

- [ ] **Step 4: Build and test**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/src/ipc.rs src-tauri/src/lib.rs src-tauri/permissions/whats/commands.toml
git commit -m "feat(ipc): add check_for_updates_now manual check command"
```

---

## Task 11: TypeScript IPC bindings

**Files:**
- Create: `src/updateApi.ts`
- Modify: `src/settingsApi.ts`

- [ ] **Step 1: Update `Settings` interface**

In `src/settingsApi.ts`, change:

```ts
export interface Settings {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  include_preview: boolean;
}
```

To:

```ts
export interface Settings {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  include_preview: boolean;
  auto_update_check_enabled: boolean;
  // update_state is internal Rust bookkeeping; round-tripped opaquely
  update_state: unknown;
}
```

- [ ] **Step 2: Create `src/updateApi.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  release_name: string;
  released_at: string;
  body_excerpt: string;
  html_url: string;
}

export type ManualCheckResult =
  | { status: 'update_available' }
  | { status: 'up_to_date'; current: string }
  | { status: 'failed'; error: string };

export async function getUpdateInfo(): Promise<UpdateInfo> {
  return await invoke<UpdateInfo>('get_update_info');
}

export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  return await invoke<ManualCheckResult>('check_for_updates_now');
}

export async function setSkippedVersion(tag: string): Promise<void> {
  await invoke('set_skipped_version', { tag });
}
```

- [ ] **Step 3: Build check**

Run: `npm run build` (this runs `tsc && vite build`)
Expected: typecheck and build succeed. If `vite build` complains about a missing entry beyond TS, that's pre-existing — only the `tsc` half needs to pass for this step.

If `vite build` is too noisy, you can isolate the TS check:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/updateApi.ts src/settingsApi.ts
git commit -m "feat(frontend): add update IPC bindings and extend Settings type"
```

---

## Task 12: Settings UI — auto-update checkbox + "Check now" button

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the new API and add UI**

In `src/App.tsx`, add to the imports at the top:

```tsx
import {
  checkForUpdatesNow,
  type ManualCheckResult,
} from './updateApi';
```

Then, inside `SettingsView`, immediately after the existing `useState` lines:

```tsx
  const [settings, setLocal] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
```

Add:

```tsx
  const [updateCheckStatus, setUpdateCheckStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'up_to_date'; current: string }
    | { kind: 'failed' }
  >({ kind: 'idle' });
```

In `SettingsView`'s `update` function, clear the status whenever a setting changes (so stale messages don't linger):

Replace:

```tsx
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
```

With:

```tsx
  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    setUpdateCheckStatus({ kind: 'idle' });
    try {
      await setSettings(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCheckNow() {
    setUpdateCheckStatus({ kind: 'checking' });
    try {
      const result: ManualCheckResult = await checkForUpdatesNow();
      if (result.status === 'update_available') {
        // Update window opened by Rust; clear inline status.
        setUpdateCheckStatus({ kind: 'idle' });
      } else if (result.status === 'up_to_date') {
        setUpdateCheckStatus({ kind: 'up_to_date', current: result.current });
      } else {
        setUpdateCheckStatus({ kind: 'failed' });
      }
    } catch {
      setUpdateCheckStatus({ kind: 'failed' });
    }
  }
```

Then, at the end of the `SettingsView` JSX (right before the closing `</div>` of `<div className="dialog settings">`), add:

```tsx
      <hr />
      <label className="row">
        <input
          type="checkbox"
          checked={settings.auto_update_check_enabled}
          onChange={(e) =>
            update({ auto_update_check_enabled: e.target.checked })
          }
        />
        <span>Automatically check for updates on startup</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={updateCheckStatus.kind === 'checking'}
        >
          {updateCheckStatus.kind === 'checking'
            ? 'Checking…'
            : 'Check for updates now'}
        </button>
      </div>
      {updateCheckStatus.kind === 'up_to_date' && (
        <div className="row">
          <span>You're up to date (v{updateCheckStatus.current}).</span>
        </div>
      )}
      {updateCheckStatus.kind === 'failed' && (
        <div className="row">
          <span className="err">
            Update check failed. Please try again later.
          </span>
        </div>
      )}
```

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(settings-ui): add auto-update checkbox and Check now button"
```

---

## Task 13: `UpdateView` component

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add the `UpdateView` component**

In `src/App.tsx`, extend the imports:

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
```

(already imported — leave alone if present)

Add to `updateApi` import block:

```tsx
import {
  checkForUpdatesNow,
  getUpdateInfo,
  setSkippedVersion,
  type ManualCheckResult,
  type UpdateInfo,
} from './updateApi';
```

Add `open_external` to a new import (it isn't yet used in App.tsx; the existing settings page doesn't use it). Add this near the top:

```tsx
import { invoke } from '@tauri-apps/api/core';
```

Update the top-level `App` to include the new branch:

```tsx
export default function App() {
  if (currentWindowLabel === 'about') {
    return <AboutView />;
  }
  if (currentWindowLabel === 'update') {
    return <UpdateView />;
  }
  return <SettingsView />;
}
```

Add the component at the bottom of `src/App.tsx`:

```tsx
function UpdateView() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipThis, setSkipThis] = useState(false);

  useEffect(() => {
    getUpdateInfo().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  async function persistSkipIfChecked(tag: string) {
    if (skipThis) {
      try {
        await setSkippedVersion(tag);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function handleOpenReleasePage() {
    if (!info) return;
    await persistSkipIfChecked(info.latest_version);
    try {
      await invoke('open_external', { url: info.html_url });
    } catch (e) {
      setError(String(e));
      return;
    }
    await getCurrentWindow().close();
  }

  async function handleLater() {
    if (!info) return;
    await persistSkipIfChecked(info.latest_version);
    await getCurrentWindow().close();
  }

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!info) return <div className="dialog"><p>Loading…</p></div>;

  const releasedDisplay = info.released_at
    ? new Date(info.released_at).toLocaleDateString()
    : '—';

  return (
    <div className="dialog update">
      <h1>Update available</h1>
      <p>A new version of whats is available.</p>
      <dl className="details">
        <div className="detail">
          <dt>Current version</dt>
          <dd>{info.current_version}</dd>
        </div>
        <div className="detail">
          <dt>New version</dt>
          <dd>{info.latest_version}</dd>
        </div>
        <div className="detail">
          <dt>Released</dt>
          <dd>{releasedDisplay}</dd>
        </div>
      </dl>
      {info.body_excerpt && (
        <>
          <h2 className="release-notes-heading">Release notes</h2>
          <pre className="release-notes">{info.body_excerpt}</pre>
        </>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={skipThis}
          onChange={(e) => setSkipThis(e.target.checked)}
        />
        <span>Don't notify me about this version</span>
      </label>
      <div className="row buttons">
        <button type="button" onClick={handleLater}>Later</button>
        <button type="button" onClick={handleOpenReleasePage}>
          Open release page
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `src/styles.css`:

```css
.update {
  max-width: 460px;
}

.update h2.release-notes-heading {
  font-size: 0.95rem;
  margin: 1rem 0 0.4rem;
  color: #555;
}

.release-notes {
  background: #f6f6f6;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0.6rem 0.7rem;
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-family: inherit;
  font-size: 0.9rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.row.buttons {
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
```

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat(frontend): add UpdateView component for the update popup"
```

---

## Task 14: Frontend tests for the new components (vitest)

**Files:**
- Create: `tests/updateView.test.js`
- Create: `tests/settingsView.test.js`
- Modify: `vite.config.ts` (allow `.test.tsx` if needed)

Note: existing tests are pure JS (`tests/inject.test.js`, `tests/bundle-config.test.js`). Component tests need `jsdom` and JSX. The repo has `jsdom` and `@vitejs/plugin-react` installed. We can add component tests as `.test.tsx` and update the vitest `include` glob.

- [ ] **Step 1: Update vitest config to include .test.tsx and provide jsdom**

In `vite.config.ts`, change:

```ts
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
```

To:

```ts
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,tsx}'],
  },
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: existing tests still pass under `jsdom` (they don't use DOM APIs except via `makeDocumentFixture`, which is plain objects).

- [ ] **Step 3: Add a test for `SettingsView` "Check now" states**

Create `tests/settingsView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'settings', close: vi.fn() }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import App from '../src/App';

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_settings') {
      return {
        notifications_enabled: true,
        sound_enabled: true,
        include_preview: false,
        auto_update_check_enabled: true,
        update_state: {},
      };
    }
    if (cmd === 'check_for_updates_now') {
      return { status: 'up_to_date', current: '0.1.0' };
    }
    if (cmd === 'set_settings') return undefined;
    throw new Error(`unexpected ipc: ${cmd}`);
  });
});

describe('SettingsView auto-update controls', () => {
  it('renders the auto-update checkbox', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Automatically check for updates on startup/i),
      ).toBeTruthy(),
    );
  });

  it('shows "up to date" message after Check now', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(screen.getByText(/You're up to date \(v0\.1\.0\)/)).toBeTruthy(),
    );
  });

  it('shows failed message when manual check fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_settings') {
        return {
          notifications_enabled: true,
          sound_enabled: true,
          include_preview: false,
          auto_update_check_enabled: true,
          update_state: {},
        };
      }
      if (cmd === 'check_for_updates_now') {
        return { status: 'failed', error: 'boom' };
      }
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(
        screen.getByText(/Update check failed\. Please try again later\./),
      ).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 4: Add a test for `UpdateView`**

Create `tests/updateView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const closeMock = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'update', close: closeMock }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import App from '../src/App';

const invokeMock = vi.mocked(invoke);

const fakeInfo = {
  current_version: '0.1.0',
  latest_version: 'v0.2.0',
  release_name: 'v0.2.0',
  released_at: '2026-04-25T12:00:00Z',
  body_excerpt: 'fixed stuff',
  html_url: 'https://github.com/IgorKvasn/whats/releases/tag/v0.2.0',
};

beforeEach(() => {
  invokeMock.mockReset();
  closeMock.mockReset();
});

describe('UpdateView', () => {
  it('renders version comparison and release notes', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Update available'));
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('fixed stuff')).toBeTruthy();
  });

  it('Open release page calls open_external and closes the window', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      if (cmd === 'open_external') return undefined;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Open release page'));
    fireEvent.click(screen.getByText('Open release page'));
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith('open_external', {
      url: fakeInfo.html_url,
    });
    // skip checkbox not checked → no set_skipped_version call
    expect(
      invokeMock.mock.calls.find((c) => c[0] === 'set_skipped_version'),
    ).toBeUndefined();
  });

  it('Later with skip-checkbox persists skipped_version then closes', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      if (cmd === 'set_skipped_version') return undefined;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Later'));
    fireEvent.click(
      screen.getByLabelText("Don't notify me about this version"),
    );
    fireEvent.click(screen.getByText('Later'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('set_skipped_version', {
        tag: 'v0.2.0',
      }),
    );
    expect(closeMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Install missing dev deps**

The tests use `@testing-library/react`. Check if it's installed:

Run: `rg -n '"@testing-library/react"' package.json || echo MISSING`

If MISSING:

```bash
npm install --save-dev @testing-library/react @testing-library/dom
```

`@testing-library/dom` is a peer dep of `@testing-library/react`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: existing inject/bundle tests pass; new component tests pass. If you see "ReferenceError: window is not defined" in old tests, that's because they were authored against `environment: 'node'`; they only use plain objects so jsdom shouldn't break them, but if any test does break, fix it directly rather than reverting the env change.

- [ ] **Step 7: Commit**

```bash
git add tests/settingsView.test.tsx tests/updateView.test.tsx vite.config.ts package.json package-lock.json
git commit -m "test(frontend): cover UpdateView and SettingsView auto-update controls"
```

---

## Task 15: Manual smoke test pass and final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Build check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Run: `npx tsc --noEmit`
Both expected: clean.

- [ ] **Step 4: Manual smoke test** (only if a graphical environment is available)

If you can run the app locally:

1. Temporarily edit `src-tauri/Cargo.toml` `version = "0.0.1"` and `src-tauri/tauri.conf.json` `"version": "0.0.1"`. Run `npm run tauri dev`. Wait ~5s after the app starts. Verify the update popup appears with current=0.0.1, latest=<actual latest tag>, and release notes from GitHub. **Revert the version changes after testing.**
2. With auto-check disabled in Settings, restart the app. Verify no popup appears (and no GitHub request — `tcpdump`/`Wireshark` filtered to api.github.com or just `cargo run` with stderr logs visible should show no `updater:` fetch lines beyond the throttle line).
3. Disconnect network. Click "Check for updates now". Verify the inline "Update check failed" message appears.
4. Click "Open release page" with no skip checkbox; verify the browser opens the GitHub release page and the popup closes.
5. Trigger 3 consecutive failed startup checks (e.g., set network offline, restart 3 times in a row, ensuring the throttle has elapsed each time — easiest is to wipe `last_checked_at` from settings.json between starts). Verify the OS notification appears on the 3rd start.

If no graphical environment is available, document this as "manual smoke tests deferred to deployment review" in the PR description.

- [ ] **Step 5: Final commit (only if there are stray changes)**

If steps 1–4 produced no changes, no commit needed. Otherwise:

```bash
git add -A
git commit -m "chore: post-verification cleanup"
```

---

## Out of Scope (do not implement here)

These are explicitly listed in the spec as future work — do **not** add them in this plan:

- Periodic in-session re-checks (only startup + manual)
- "Last checked at" UI display in Settings
- Prerelease channel toggle
- Markdown rendering for release notes (intentionally plain text)
- Auto-download / in-app install (no `tauri-plugin-updater`)
