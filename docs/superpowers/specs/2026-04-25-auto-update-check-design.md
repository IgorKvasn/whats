# Auto-Update Check — Design

Date: 2026-04-25
Status: Approved (awaiting implementation plan)

## Goal

Add an opt-in startup check that informs the user when a newer version of `whats`
has been published on GitHub. The check runs in the background, is throttled to
avoid hammering GitHub, and surfaces results via an in-app popup window.
A manual "Check for updates now" button in Settings provides an on-demand
override.

## Non-goals

- Auto-downloading or installing updates. The user is directed to the GitHub
  release page; they install manually.
- Code-signing, signed update manifests, or `tauri-plugin-updater` integration.
- Periodic checks while the app is running. Checks happen at startup only
  (plus manual).
- Channel selection (stable vs prerelease). Only stable, non-draft, non-prerelease
  releases are considered.

## User-facing behavior

### Settings dialog (additions)

- New checkbox: **"Automatically check for updates on startup"** (default: on).
- New button: **"Check for updates now"**, always enabled, independent of the
  checkbox above.
  - While the request is in flight, the button shows "Checking…" and is disabled.
  - On success with a newer version: opens the update popup window (see below).
  - On success with no newer version: inline status line "You're up to date
    (v<current>)".
  - On failure: inline status line "Update check failed. Please try again later."
  - The status line clears when the user toggles any setting or closes the dialog.

### Update popup window (label `"update"`)

Opens automatically when a newer version is found (startup or manual check).
Reuses the existing dialog window pattern (`about`, `settings`).

Contents:
- Heading: "Update available"
- Current version → new version (semver tags)
- Release date (localized via `Date#toLocaleDateString`)
- Release notes excerpt (first ~500 chars of the release `body`, plain text,
  scrollable container if long; markdown is **not** rendered, intentionally)
- Checkbox: "Don't notify me about this version"
- Buttons: **Later** and **Open release page**

Behavior:
- **Open release page** → if the checkbox is checked, calls
  `set_skipped_version(latest_tag)` first; then calls existing `open_external`
  IPC with the GitHub release `html_url`; then closes the window via
  `getCurrentWindow().close()`.
- **Later** → if the checkbox is checked, calls `set_skipped_version(latest_tag)`
  first; then closes the window.
- OS close button: closes the window without persisting `skipped_version`,
  even if the checkbox is checked. (Treating the OS close as a "cancel" is
  more conservative than treating it as "Later".)
- Single-instance: if a popup is already open, focus it instead of creating a
  duplicate.

### Failure notification (3-strike rule)

When the **background** (startup) check fails 3 times in a row across launches,
a single native OS notification is fired:

> "Couldn't check for updates — please verify your internet connection."

After firing, the failure counter is reset to 0; the user is not re-notified
until another 3 consecutive failures accumulate. The notification is suppressed
when `notifications_enabled = false` in settings (it goes through the same
notification plugin the user has globally disabled).

Manual checks never increment the failure counter and never fire this
notification — they surface failures inline in the Settings dialog instead.

## Architecture

### New Rust module: `src-tauri/src/updater.rs`

Two seams for testability:

- **Pure decision function** (no I/O):

  ```rust
  pub fn decide_update(
      current: &str,
      latest_tag: &str,
      skipped_version: Option<&str>,
  ) -> Option<UpdateInfo>
  ```

  Strips a leading `v` from both inputs, parses with `semver`, returns
  `Some(UpdateInfo)` only if `latest > current` and `latest_tag != skipped_version`.
  On semver parse failure of either input, returns `None` and logs a warning
  (treated as "unknown", not a failure).

- **HTTP fetcher** (isolated):

  ```rust
  pub async fn fetch_latest_release(repo: &str) -> Result<ReleaseInfo, UpdateError>
  ```

  - URL: `https://api.github.com/repos/{repo}/releases/latest`
  - Headers: `User-Agent: whats-desktop/<CARGO_PKG_VERSION>`,
    `Accept: application/vnd.github+json`
  - Timeout: 10 seconds (any longer is treated as failure).
  - Returns parsed JSON struct with `tag_name`, `name`, `published_at`, `body`,
    `html_url`.

### New module wiring in `lib.rs`

After the main webview window is built, in `setup`:

1. If `settings.auto_update_check_enabled == false`, do nothing.
2. Otherwise spawn a `tauri::async_runtime::spawn` task that:
   1. Sleeps 5 s.
   2. Reads `last_checked_at`. If within the last 24 h, exits silently.
   3. Calls `fetch_latest_release("IgorKvasn/whats")`.
   4. **On error**: increments `consecutive_failures`, persists settings.
      If counter == 3, fires the native notification (when
      `notifications_enabled`) and resets counter to 0.
   5. **On success**: sets `last_checked_at = now`, resets
      `consecutive_failures = 0`, persists. Calls `decide_update(...)`.
      If `Some(info)`, stores `info` in app state and opens the `update`
      window (or focuses it if already open).

### New IPC commands

- `get_update_info() -> UpdateInfo` — read by `UpdateView` on mount.
  Errors if no update info is currently in app state (popup window opened
  in error state — should never happen, but surfaced as an error message
  rather than a panic).
- `check_for_updates_now() -> ManualCheckResult` — bypasses throttle and
  failure counter. Returns one of:
  - `{ status: "update_available" }` (and opens the popup window as a side
    effect; also persists `last_checked_at`)
  - `{ status: "up_to_date", current: "0.1.0" }` (and persists
    `last_checked_at`)
  - `{ status: "failed", error: "<message>" }` (no persistence)
  - `skipped_version` is **ignored** for manual checks — the popup appears
    even for a previously-skipped version, since the user explicitly asked.
- `set_skipped_version(tag: String) -> ()` — persists
  `update_state.skipped_version = tag`. Called by the popup before it closes,
  only when the user has the "Don't notify me about this version" checkbox
  checked. The popup window closes itself via `getCurrentWindow().close()`;
  no IPC needed for the close itself.

### Data model

Rust `Settings` struct gains:

```rust
pub struct Settings {
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub include_preview: bool,
    pub auto_update_check_enabled: bool,    // NEW, default true
    pub update_state: UpdateState,           // NEW
}

#[derive(Default)]
pub struct UpdateState {
    pub last_checked_at: Option<i64>,        // unix seconds
    pub skipped_version: Option<String>,     // tag string, e.g. "v0.2.0"
    pub consecutive_failures: u32,
}
```

Backwards compatibility: both new fields use `#[serde(default)]`. Existing
`settings.json` files load cleanly with the new fields filled from `Default`.

TypeScript `Settings` interface gains only `auto_update_check_enabled`.
`update_state` is internal bookkeeping; the frontend round-trips it as an
opaque field via `getSettings`/`setSettings` (it never reads or modifies the
contents).

### Update popup window

- Created via `WebviewWindowBuilder` with label `"update"`, ~480×360.
- React `App.tsx` renders a new `UpdateView` component when
  `currentWindowLabel === 'update'`.
- Styling reuses the existing `.dialog` class with a `.update` modifier.

### Dependencies

Add to `src-tauri/Cargo.toml`:

- `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }`
  (rustls avoids pulling OpenSSL on Linux)
- `semver = "1"`

No new frontend dependencies.

## Control flow diagrams

### Startup check

```
app start
  └─ setup()
       ├─ build main window
       └─ if auto_update_check_enabled:
            spawn task:
              sleep 5s
              if last_checked_at within 24h: return
              result = fetch_latest_release(...)
              if Err:
                consecutive_failures += 1
                persist
                if consecutive_failures == 3:
                  if notifications_enabled: fire notification
                  consecutive_failures = 0
                  persist
                return
              # Ok
              last_checked_at = now
              consecutive_failures = 0
              persist
              if decide_update(current, latest.tag_name, skipped_version):
                store info in app state
                open or focus "update" window
```

### Manual check

```
user clicks "Check for updates now"
  └─ check_for_updates_now()
       result = fetch_latest_release(...)
       if Err:
         return { status: "failed", error: ... }
       last_checked_at = now; persist
       if latest > current (skip ignored):
         store info in app state
         open or focus "update" window
         return { status: "update_available" }
       else:
         return { status: "up_to_date", current }
```

## Error handling

| Failure | Behavior |
|---|---|
| HTTP error (network, timeout, non-2xx) on **startup check** | log to stderr; increment `consecutive_failures`, persist; if counter == 3 → native notification (only if `notifications_enabled`) and reset counter |
| HTTP error on **manual check** | inline error in Settings dialog; failure counter untouched |
| JSON parse error from GitHub response | treated identically to HTTP error |
| Semver parse error on `current` or `tag_name` | log warning, return `None` from `decide_update`; no popup, no failure counter increment |
| Settings file write error after a check | log to stderr, swallow |
| Update window already open when a second check tries to open it | focus existing window, do not create duplicate |
| GitHub returns 404 (repo has no releases yet) | `fetch_latest_release` maps 404 to a distinct `NoReleases` outcome (not `Err`); treated as "no update available"; success path — reset counter, set `last_checked_at` |
| GitHub returns 403 (rate-limited) | treat as failure |

## Testing

### Rust unit tests (in `updater.rs`)

- `decide_update`:
  - newer available → `Some`
  - equal versions → `None`
  - current is newer → `None`
  - lexical-vs-semver case (`0.10.0 > 0.2.0`) → `Some`
  - skipped_version matches latest → `None`
  - latest is newer than current AND skipped_version refers to an older
    release than latest → `Some` (a previously-skipped version doesn't
    suppress a still-newer one)
  - garbage version strings → `None`, no panic
- `Settings` round-trip with new fields.
- Loading a legacy `settings.json` (without `auto_update_check_enabled` /
  `update_state`) → defaults fill in cleanly.

### Frontend tests (`vitest`)

- `UpdateView`: renders version comparison and release notes given a mock
  `get_update_info`.
- "Don't notify me about this version" + button combinations call the right
  IPC (`open_external` / `dismiss_update` with the right `skip` flag).
- `SettingsView`: new "Auto-update check" checkbox toggles
  `auto_update_check_enabled`. "Check for updates now" button shows the three
  result states (in-flight, up-to-date, failed).

### Manual smoke test (added to PR description)

1. Build with `Cargo.toml` `version = "0.0.1"` to force the popup against the
   real GitHub release; verify popup contents match.
2. Toggle auto-check off, restart, confirm no network call.
3. Click "Check for updates now" with internet disabled → confirm inline
   failure message.
4. Skip a version, restart, confirm no popup.
5. Disable network for 3 consecutive startups → confirm OS notification fires
   on the 3rd.

## Open questions

None.

## Out of scope (for future consideration)

- Scheduled re-checks while the app is running.
- "Last checked at" display in Settings.
- Prerelease channel toggle.
- Markdown rendering for release notes.
- Auto-download / in-app install.
