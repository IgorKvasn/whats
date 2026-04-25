# Building a `.deb` package

Step-by-step instructions for producing `whats_<version>_amd64.deb` on a Debian/Ubuntu host. For other formats (`.rpm`, `.AppImage`) and deeper troubleshooting, see [`build-linux.md`](./build-linux.md).

> Always use `npx tauri build`. `cargo build --release` produces a binary baked with the dev URL and skips bundling `inject.js` — the resulting app is broken.

There is also a script that performs every step below in one shot: [`scripts/build-deb.sh`](../scripts/build-deb.sh).

## 1. Install system packages (one-time)

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

## 2. Install the toolchain (one-time)

```bash
# Rust (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"

# Node.js >= 20.17 — install via your preferred method (nvm/fnm/distro)
node --version  # v20.17.0 or later
```

## 3. Install project dependencies

From the repo root:

```bash
cd /data/projects/whats
npm install
```

## 4. Sanity-check tests and frontend build

A broken build wastes 1–2 minutes per attempt. Run tests first:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run build
```

## 5. Build the `.deb`

```bash
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles deb
```

First run: 5–10 minutes. Subsequent runs without source changes: ~30–60 seconds for the bundler.

Output:

```
src-tauri/target/release/bundle/deb/whats_<version>_amd64.deb
```

## 6. Install and run

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/whats_*_amd64.deb
whats
```

Removes cleanly with `sudo apt remove whats`.
