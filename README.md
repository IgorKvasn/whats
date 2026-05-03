<p align="center">
  <img src="whats-mono-bright-512.png" alt="whats app icon" width="96" height="96">
</p>

<h1 align="center">whats</h1>

<p align="center">
  Unofficial Electron desktop client for WhatsApp Web with tray integration,
  native notifications, settings, and release updates.
</p>

<p align="center">
  <a href="https://www.electronjs.org/"><img alt="Electron" src="https://img.shields.io/badge/Electron-41.5.0-47848f?logo=electron&logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-19.2.5-149eca?logo=react&logoColor=white"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0.3-3178c6?logo=typescript&logoColor=white"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-1.8.1-2ea44f">
  <a href="LICENSE.md"><img alt="License" src="https://img.shields.io/badge/license-see%20LICENSE.md-6e7781"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20.deb-fcc624?logo=linux&logoColor=111111">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#development">Development</a> ·
  <a href="#building">Building</a> ·
  <a href="#releasing">Releasing</a>
</p>

> [!IMPORTANT]
> This project is an **unofficial, third-party wrapper** around the WhatsApp Web
> site (`https://web.whatsapp.com`). It is **not affiliated with, endorsed by,
> sponsored by, or in any way associated with WhatsApp, Meta Platforms, Inc.,
> or any of their subsidiaries**.
>
> "WhatsApp" is a trademark of its respective owner. This project hosts the
> official WhatsApp Web page in a desktop webview. It does not modify,
> reverse-engineer, or reimplement the WhatsApp service or protocol.
>
> Use at your own risk. All interactions with WhatsApp are subject to
> WhatsApp's own Terms of Service and Privacy Policy.

> [!NOTE]
> This project was entirely created by Claude Code and Codex.

## Features

| Area | Details |
| --- | --- |
| Desktop session | Persistent WhatsApp Web session across restarts |
| Tray integration | System tray with unread count, disconnect status, and close-to-tray behavior |
| Notifications | Native desktop notifications with Open / Dismiss actions, configurable sound, sender images, and message preview controls |
| App lifecycle | Single-instance enforcement and hardened navigation |
| Updates | GitHub release checks from the About dialog |
| Settings | Dedicated settings and About dialogs built with React |

## Install

Download a `.deb` package from a GitHub release, then install it with:

```bash
sudo apt install ./whats_*.deb
```

If you build locally, the package is written to `dist/`.

## Prerequisites

- Node.js 22.12.0
- `npm`
- `dpkg-deb` for Linux package builds

## Development

Install dependencies and start the Electron development app:

```bash
npm install
npm run dev
```

Run tests:

```bash
npm test
```

Type-check the Electron main and preload TypeScript configuration:

```bash
npx tsc -p tsconfig.node.json --noEmit
```

## Building

Build a Linux `.deb` package:

```bash
npm run package
```

Or run the packaging helper directly:

```bash
scripts/build-deb.sh
```

The generated package is written to `dist/` and can be installed with:

```bash
sudo apt install ./dist/whats_*.deb
```

## Releasing

Releases are cut with `scripts/release.sh`. The script bumps
`package.json`, regenerates `CHANGELOG.md` from Conventional Commit messages,
builds a `.deb`, commits, tags, pushes, and publishes a GitHub release with the
package attached.

One-time setup:

```bash
sudo apt install gh
gh auth login
```

Release checklist:

1. Land all changes on `main`.
2. Confirm the working tree is clean.
3. Preview the release:

   ```bash
   scripts/release.sh --bump patch --dry-run
   ```

4. Cut the release:

   ```bash
   scripts/release.sh --bump patch
   ```

Use `--bump minor`, `--bump major`, or `--bump X.Y.Z` to pick the version. Add
`--draft` or `--prerelease` when appropriate, `--skip-tests` to skip the
test/build step, and `--yes` to skip the confirmation prompt.

## Project Structure

```text
src/
  main/       Electron main process: windows, tray, IPC, notifications, updater
  preload/    Preload scripts for the WhatsApp bridge and app APIs
  renderer/   React UI for settings, About, and update dialogs
resources/
  icons/      App and tray icons
scripts/      Build and release automation
tests/        Vitest unit and component tests
```
