# whats — WhatsApp Desktop

> **IMPORTANT DISCLAIMER**
>
> This project is an **unofficial, third-party wrapper** around the WhatsApp Web
> site (`https://web.whatsapp.com`). It is **not affiliated with, endorsed by,
> sponsored by, or in any way associated with WhatsApp, Meta Platforms, Inc.,
> or any of their subsidiaries**.
>
> "WhatsApp" is a trademark of its respective owner. This project simply hosts
> the official WhatsApp Web page in a desktop webview — it does not modify,
> reverse-engineer, or reimplement the WhatsApp service or protocol.
>
> Use at your own risk. All interactions with WhatsApp are subject to
> WhatsApp's own Terms of Service and Privacy Policy.

> **Disclaimer:** This project was entirely created by Claude Code and Codex.

A lightweight Electron desktop app that wraps `https://web.whatsapp.com` with a system tray, native notifications, and a settings window. Built with Electron + electron-vite + React + TypeScript.

## Features

- Persistent WhatsApp Web session across restarts
- System tray with unread count and disconnect status
- Native desktop notifications (configurable: sound, message preview)
- Close-to-tray behavior
- Single-instance enforcement
- Auto-update checking via GitHub releases
- Settings and About dialogs

## Prerequisites

- Node.js >= 20.17

## Development

```bash
npm install
npm run dev
```

Run unit tests:

```bash
npm test
```

Type-check:

```bash
npx tsc -p tsconfig.node.json --noEmit
```

## Building

Build a `.deb` package:

```bash
npm run package
```

Or use the build script directly:

```bash
scripts/build-deb.sh
```

The `.deb` is output to `dist/`.

Install with:

```bash
sudo apt install ./dist/whats_*.deb
```

## Releasing

Releases are cut with `scripts/release.sh`. The script bumps the version in `package.json`, regenerates `CHANGELOG.md` from Conventional Commit messages, builds a `.deb` via `scripts/build-deb.sh`, then commits, tags, pushes, and publishes a GitHub release with the `.deb` attached.

### One-time setup

- Install the GitHub CLI and authenticate:
  ```bash
  sudo apt install gh
  gh auth login
  ```
- Make sure `node`, `npm`, and `dpkg-deb` are on `PATH`.

### Cutting a release

1. Land all changes on `main` and ensure the working tree is clean.
2. Preview the release:
   ```bash
   scripts/release.sh --bump patch --dry-run
   ```
3. Run for real:
   ```bash
   scripts/release.sh --bump patch
   ```
   Use `--bump minor`, `--bump major`, or `--bump X.Y.Z` to pick the version. Add `--draft` or `--prerelease` when appropriate, `--skip-tests` to skip the test/build step, and `--yes` to skip the confirmation prompt.

## Project structure

```
src/
  main/         Electron main process (window management, tray, IPC, updater)
  preload/      Preload scripts (WhatsApp bridge, dialog API)
  renderer/     React UI (settings, about, update dialogs)
resources/
  icons/        Tray and app icons
scripts/        Build and release automation
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
