# Changelog

## v1.17.2 — 2026-08-24

### Bug Fixes

- hide menu bar and enlarge download complete dialog


## v1.17.1 — 2026-08-24

### Bug Fixes

- pin electron to 43.2.0 to restore the linux tray icon
- resize tray icons from 512x512 to 32x32


## v1.17.0 — 2026-08-24

### Features

- prompt to open or reveal completed downloads
- add memory measurement harness and record startup baseline

### Bug Fixes

- stop a surviving instance from voiding the next run's trial 1
- capture memory in its own launch rather than inside a trial
- print each trial number live, at the moment the window appears
- wait on the launched pid so every blank-frame trial actually runs
- measure the blank window on first show, one trial per launch

### Refactor

- remove the #43 experiment hook from the shipped app
- stop passing paintWhenInitiallyHidden on a normal launch
- drop dead scaffolding left by the keypress design
- shorten the trial settle delay to 5s
- record blank trials by number instead of live keypresses

### Documentation

- state the repeat-show gap and attribute the memory to renderers
- report the blank-frame isolation as an undetermined result

### Tests

- add harness to isolate the required parts of the blank-window fix

### Build

- bump @homebridge/dbus-native in the production-minor-patch group (#51)

### CI

- bump github/codeql-action in the github-actions group (#52)
- bump github/codeql-action in the github-actions group (#49)

### Chores

- bump the dev-dependencies group with 3 updates (#50)
- bump the dev-dependencies group with 3 updates (#47)
- bump jsdom from 29.1.1 to 30.0.1 (#48)
- v1.17.0

### Other

- roll back to v1.16.2


## v1.16.2 — 2026-08-11

### Bug Fixes

- bump js-yaml, postcss, and brace-expansion to patch transitive CVEs (#41)

### Build

- bump the production-minor-patch group with 3 updates (#32)

### CI

- bump github/codeql-action in the github-actions group (#34)

### Chores

- bump @types/semver in the dev-dependencies group (#37)
- bump fast-uri from 3.1.4 to 3.1.5 (#36)
- bump undici from 6.27.0 to 6.28.0 (#35)


## v1.16.1 — 2026-07-27

### Bug Fixes

- sync Settings type and enable renderer type-checking (#31)


## v1.16.0 — 2026-07-27

### Bug Fixes

- bump transitive fast-uri to 3.1.4 to resolve host confusion advisories

### CI

- bump the github-actions group with 2 updates (#29)

### Chores

- bump electron from 42.3.0 to 43.2.0 (#27)
- bump typescript from 6.0.3 to 7.0.2 (#28)


## v1.15.0 — 2026-07-21

### Bug Fixes

- bump transitive js-yaml to 4.3.0 to resolve CVE-2026-59869 (#25)


## v1.14.0 — 2026-07-21

### Bug Fixes

- cast dbus-native import through unknown to fix type-check (#24)

### Build

- bump the production-minor-patch group across 1 directory with 4 updates (#20)

### CI

- bump the github-actions group across 1 directory with 3 updates (#21)

### Chores

- bump the dev-dependencies group across 1 directory with 5 updates (#19)
- bump form-data from 4.0.5 to 4.0.6 (#14)
- bump undici from 6.26.0 to 6.27.0 (#15)
- bump tar from 7.5.16 to 7.5.20 (#23)


## v1.13.0 — 2026-07-21

### Bug Fixes

- auto-reconnect and reconnect overlay when initial page load fails
- remove stale .deb artifacts before building

### Build

- bump tmp from 0.2.5 to 0.2.7

### CI

- group updates, add cooldown and commit prefixes


## v1.12.0 — 2026-06-14

### Bug Fixes

- resolve dependency security alerts


## v1.11.0 — 2026-06-14

### Performance

- lazy load notification dbus


## v1.10.1 — 2026-06-13

### Bug Fixes

- force repaint to avoid blank main window on show


## v1.10.0 — 2026-06-12

### Features

- add start-minimized-to-tray option


## v1.9.1 — 2026-06-06

### Build

- reduce deb package size


## v1.9.0 — 2026-06-06

### Bug Fixes

- repair npm lockfile metadata

### Documentation

- add license TLDR summary

### CI

- pin npm version for installs
- add github automation workflows

### Chores

- update package manifest dependencies
- update npm dependencies
- use default npm registry
- use default npm registry

### Other

- Update LICENSE.md


## v1.8.3 — 2026-06-05

### Bug Fixes

- correct unread fallback notification payload


## v1.8.2 — 2026-05-03

### Documentation

- update dependency versions in README


## v1.8.1 — 2026-05-03

### Documentation

- refresh readme presentation

### Chores

- align dependency ranges
- update npm dependencies
- refresh package lock
- release script


## v1.8.0 — 2026-05-03

### Bug Fixes

- send sender images as D-Bus file URIs

### Documentation

- update notification specs


## v1.7.0 — 2026-05-03

### Features

- show sender icons in notifications


## v1.6.0 — 2026-05-03

### Bug Fixes

- harden electron navigation


## v1.5.1 — 2026-04-28

### Bug Fixes

- filter out UI labels from fallback sender extraction


## v1.5.0 — 2026-04-28

### Features

- dismiss desktop notifications on window focus


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

