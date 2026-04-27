# Changelog

## v1.4.0 — 2026-04-27

### Bug Fixes

- force main window to foreground on show


## v1.3.0 — 2026-04-27

### Features

- group notification preview options and add saved toast

### Chores

- remove yarn.lock


## v1.2.0 — 2026-04-27

### Features

- replace notify-send with D-Bus for action button support
- pass icon path to showNotification callers
- replace electron Notification with notify-send action buttons

### Documentation

- update specs and docs for D-Bus notification implementation
- add D-Bus notification implementation plan
- add notification action buttons implementation plan
- add notification action buttons design spec

### Tests

- rewrite tests for D-Bus notification support
- update tests for notify-send action buttons

### Build

- externalize electron in preload for Rolldown compatibility
- fix externalizeDepsPlugin for Vite 8/Rolldown
- externalize dbus-next in electron-vite config
- add dbus-next for D-Bus notification support

### Chores

- pin electron version, remove stale package-lock.json, add test files


## v1.1.1 — 2026-04-27

_No notable changes._


## v1.1.0 — 2026-04-27

### Features

- add hardware acceleration (GPU) toggle


## v1.0.1 — 2026-04-27

### Bug Fixes

- only call restore() on minimized windows to fix tray show action

### Documentation

- remove tauri references and update readme for electron


## v1.0.0 — 2026-04-27

### Features

- add renderer with React views and electron IPC API layer
- add electron main process entry with IPC handlers and app lifecycle
- add windows module and preload scripts for dialog and WhatsApp webview
- add core TDD modules ported from Rust to TypeScript

### Bug Fixes

- disable chromium SUID sandbox for dev compatibility

### Refactor

- replace tauri scaffolding with electron-vite project structure

### Documentation

- add electron rewrite implementation plan
- add electron rewrite design spec

### Tests

- add component tests and bundle config validation tests

### Build

- upgrade electron stack and fix whatsapp web compatibility
- update release and build scripts for electron packaging

### Chores

- comitted rest of the files
- add out/ to gitignore for electron-vite build output


## v0.5.0 — 2026-04-25

### Chores

- set proper package name and description for deb


## v0.4.0 — 2026-04-25

### Documentation

- add unofficial third-party wrapper disclaimer


## v0.3.0 — 2026-04-25

### Features

- render release notes as markdown


## v0.2.0 — 2026-04-25

### Features

- show app version in About view

### Build

- enforce conventional commits via husky commit-msg hook


All notable changes to this project are documented here.

## v0.1.1 — 2026-04-25

### Features

- add update popup view
- add auto-update checkbox and Check now button
- add update IPC bindings and extend Settings type
- add check_for_updates_now manual check command
- wire background startup check with throttle and 3-strike notification
- add update_check_failed helper
- add update dialog window helper
- add set_skipped_version command
- add get_update_info command and current_update state slot
- add fetch_latest_release HTTP fetcher
- add pure decide_update with semver comparison
- add auto_update_check_enabled and update_state
- add about tray dialog
- open external links in the system browser
- bound input length and dedupe rapid duplicates
- react settings window with three toggles
- inject JS bridge into main window for title + notifications
- window management with close-to-tray behavior
- system tray with state-driven icon + tooltip + menu
- dispatch native notifications honoring settings
- app state + settings IPC commands with capability
- register notification and single-instance plugins
- settings struct with atomic load/save
- tray state derivation from unread + disconnected
- parse unread count from document title

### Bug Fixes

- enable withGlobalTauri so the IPC bridge runs

### Performance

- targeted disconnect detection via MutationObserver

### Refactor

- hoist time imports and tighten run_manual_check scoping
- split decide_update into pure bool + build_update_info helper
- drop redundant use reqwest
- drop pointless visible(false)+show_main_on_startup dance

### Documentation

- add Claude Code / Codex disclaimer to README
- add auto-update check implementation plan
- add auto-update check design spec
- manual test checklist
- document Linux system package prerequisites

### Tests

- cover UpdateView and SettingsView auto-update controls
- vitest coverage for inject.js helpers

### Chores

- add reqwest and semver deps for update check
- drop unused tauri-plugin-opener and consolidate capabilities
- remove unused greet scaffold, gate parse_unread_from_title to tests, move tray tests to bottom
- rename App.css to styles.css to match plan
- scaffold tauri v2 + react-ts project

### Other

- release instructions
- release script
- licence added
- licence added
- licence added
- Improve notification interception fallback
- Update desktop launcher packaging
- commit
- gitignore
- Add WhatsApp Tauri implementation plan
- Add WhatsApp Tauri desktop app design spec

