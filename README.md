# whats — WhatsApp Desktop (Tauri)

> **Disclaimer:** This project was entirely created by Claude Code and Codex.

A small Tauri v2 desktop application that hosts `https://web.whatsapp.com` in a persistent webview, with a system tray, native notifications, and a settings window.

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

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
