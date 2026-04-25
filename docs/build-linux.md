# Building a Linux executable

How to produce a distributable Linux build of `whats` (the WhatsApp desktop wrapper). The build produces three installer formats: `.deb`, `.rpm`, and `.AppImage`, via `npx tauri build`.

Tested on Debian/Ubuntu derivatives. Other distros work but package names differ.

> **Don't use `cargo build --release`.** It produces a binary baked with the dev URL (http://localhost:1420) and skips bundling `inject.js` into the resource dir. Symptoms: the settings window shows "Could not connect to localhost: Connection refused", and the WhatsApp webview silently loses its tray/notification bridge. Only `npx tauri build` (Step 5) produces a correct release build.

## 1. System packages (one-time)

Tauri v2 on Linux links against WebKitGTK and friends. Install the dev headers:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  pkg-config \
  build-essential \
  curl \
  wget \
  file
```

For the `.AppImage` target you also need:

```bash
sudo apt-get install -y libfuse2
```

The AppImage runtime is downloaded automatically by Tauri's bundler the first time, so no extra package is needed for that step itself — `libfuse2` is what lets the resulting `.AppImage` actually run.

## 2. Toolchain (one-time)

```bash
# Rust (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"

# Node.js >= 20.17 (use whatever you prefer — nvm, fnm, distro package, etc.)
node --version  # should print v20.17.0 or later
```

Verify:

```bash
rustc --version   # rustc 1.7x.x or newer
cargo --version
node --version
npm --version
```

## 3. Fetch project deps (one-time per checkout)

From the repo root:

```bash
cd /data/projects/whats
npm install
```

This installs `@tauri-apps/cli` (which provides `cargo tauri ...`) and the React build chain.

## 4. Sanity check before bundling

Run the full test suite first — a broken build wastes 1-2 minutes per attempt:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run build  # tsc + vite, produces dist/
```

Expected: 20 Rust tests pass, 11 vitest tests pass, `dist/` populated.

## 5. Bundled installers (.deb, .rpm, .AppImage)

> **Do not use `cargo build --release` for this app.** That path produces a binary baked with the dev `devUrl` (http://localhost:1420) and does NOT copy `resources/inject.js` into the resource dir. The settings window will fail with "Could not connect to localhost: Connection refused" and the WhatsApp webview will silently lose its JS bridge. Always use `npx tauri build` below — it's the only correct release path.

The full distribution path. Runs `npm run build` automatically as `beforeBuildCommand`, then compiles Rust in release mode, then invokes the bundler.

```bash
PATH="$HOME/.cargo/bin:$PATH" npx tauri build
```

(Equivalent: `npm run tauri build`.)

First build: 5-10 minutes including bundler downloads. Subsequent builds with no source changes: 30-60 seconds for the bundler portion alone.

Output lands at `src-tauri/target/release/bundle/`:

```
bundle/
├── deb/whats_0.1.0_amd64.deb
├── rpm/whats-0.1.0-1.x86_64.rpm
└── appimage/whats_0.1.0_amd64.AppImage
```

Bundle targets are controlled by `src-tauri/tauri.conf.json` → `bundle.targets`. Currently set to `"all"`. To build only one target:

```bash
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles deb
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles appimage
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles rpm
```

Multiple at once:

```bash
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles deb,appimage
```

## 6. Installing the bundled output

### `.deb` (Debian, Ubuntu, Mint, Pop!_OS, etc.)

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/whats_0.1.0_amd64.deb
```

Installs to `/usr/bin/whats` plus a `.desktop` entry under `/usr/share/applications/`. Removes cleanly with `sudo apt remove whats`.

### `.AppImage` (any glibc-based distro)

```bash
chmod +x src-tauri/target/release/bundle/appimage/whats_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/whats_0.1.0_amd64.AppImage
```

No install needed. Move it wherever you want it to live (`~/Applications/` is conventional).

### `.rpm` (Fedora, RHEL, openSUSE)

```bash
sudo dnf install ./src-tauri/target/release/bundle/rpm/whats-0.1.0-1.x86_64.rpm
```

## 7. Verify the build runs

Whichever artifact you chose:

```bash
whats   # if installed via .deb/.rpm
# or
./whats_0.1.0_amd64.AppImage
```

You should see the WhatsApp QR code in a desktop window and a tray icon appear. From there, follow `docs/superpowers/specs/manual-test-checklist.md` for the full functional walkthrough.

## 8. Where data lives at runtime

The webview profile (login session, IndexedDB, cookies) and settings file persist at:

```
~/.local/share/app.whats.desktop/
```

The directory is keyed off the `identifier` in `tauri.conf.json`. Wipe it to force a re-pair with phone:

```bash
rm -rf ~/.local/share/app.whats.desktop
```

## Troubleshooting

**`pkg-config` errors about `webkit2gtk-4.1`, `glib-2.0`, `cairo`, `gio-2.0`** — Step 1 packages aren't installed.

**`failed to bundle project: AppImage tool ... cannot execute binary file`** — `libfuse2` is missing on the build machine, OR you're trying to build an AppImage for a different architecture than the host.

**`error: linker 'cc' not found`** — `build-essential` is missing.

**Build succeeds, but the AppImage exits immediately on a target machine** — that machine likely doesn't have `libfuse2` installed. AppImages bundle the app but not FUSE itself.

**Build succeeds, but the `.deb` reports unresolved deps on install** — `libwebkit2gtk-4.1-0` (runtime, no `-dev`) is missing on the target machine. The `.deb` declares this as a runtime dep, so `apt install ./whats_*.deb` should pull it in automatically. If not, force: `sudo apt install -f`.

**Tray icon doesn't appear under GNOME** — GNOME removed system tray support; you need the AppIndicator extension installed and enabled. Verify with another tray-using app (e.g., Slack, Discord). KDE, XFCE, Cinnamon, MATE work out of the box.

**`cargo tauri build` complains about a missing icon** — `src-tauri/icons/` must contain at least the files referenced in `tauri.conf.json` → `bundle.icon`. Currently expects `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` — all present in this repo.

## Cross-compilation

Not covered here. Tauri can in principle cross-compile but in practice every guide tells you to build on the target architecture. For ARM64 Linux, build on an ARM64 machine.

## CI

For automated builds, GitHub Actions has an official `tauri-apps/tauri-action` that handles the platform matrix. Out of scope for this doc — see https://v2.tauri.app/distribute/pipelines/github/ when you're ready.
