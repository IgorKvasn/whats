# whats — WhatsApp Desktop

> **⚠️ IMPORTANT DISCLAIMER**
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

A small desktop application that hosts `https://web.whatsapp.com` in a persistent webview, with a system tray, native notifications, and a settings window.

See `docs/superpowers/specs/2026-04-24-whatsapp-tauri-design.md` for the design and `docs/superpowers/plans/2026-04-24-whatsapp-tauri.md` for the implementation plan.

## Prerequisites

- Rust (stable, install via [rustup](https://rustup.rs/))
- Node.js ≥ 20.17 (for Vite 7 / npm 11)

### Linux system packages

Tauri v2 on Linux requires the following development packages (Debian/Ubuntu names):

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  pkg-config
```

Without these, `cargo check` / `cargo build` will fail with `pkg-config` errors about missing `webkit2gtk-4.1`, `glib-2.0`, `cairo`, `gio-2.0`, etc.

For other distributions see the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Development

```bash
npm install
npm run tauri dev
```

Run Rust unit tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Run frontend unit tests (added in Task 10b):

```bash
npm test
```

## Releasing

Releases are cut with `scripts/release.sh`. The script bumps the version across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, regenerates `CHANGELOG.md` from Conventional Commit messages since the last `v*` tag, builds a `.deb` via `scripts/build-deb.sh`, then commits, tags, pushes, and publishes a GitHub release with the `.deb` attached.

### One-time setup

- Install the GitHub CLI and authenticate:
  ```bash
  sudo apt install gh
  gh auth login
  ```
- Make sure `python3`, `cargo`, `node`, `npm`, and `dpkg-deb` are on `PATH` (the Linux build prerequisites above already cover most of these).

### Cutting a release

1. Land all changes on `main` and ensure the working tree is clean.
2. Preview the release:
   ```bash
   scripts/release.sh --bump patch --dry-run
   ```
   Inspect the generated changelog section and the list of mutating commands.
3. Run for real:
   ```bash
   scripts/release.sh --bump patch
   ```
   Use `--bump minor`, `--bump major`, or `--bump X.Y.Z` to pick the version. Add `--draft` or `--prerelease` when appropriate, `--skip-tests` to skip the test/build step inside `build-deb.sh`, and `--yes` to skip the confirmation prompt.

The script refuses to run if the working tree is dirty, you're not on `main`, `gh` is not authenticated, or the target tag already exists.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
