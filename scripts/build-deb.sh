#!/usr/bin/env bash
#
# Build a .deb package of `whats`.
#
# Mirrors docs/build-deb.md step by step. Safe to re-run.
#
# Flags:
#   --skip-apt     Skip the apt-get install step (Step 1).
#   --skip-tests   Skip cargo test + npm test (Step 4).
#   --no-sudo      Don't use sudo for apt-get; assume the caller has root.
#   -h, --help     Show this help.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SKIP_APT=0
SKIP_TESTS=0
SUDO="sudo"

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --skip-apt)   SKIP_APT=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --no-sudo)    SUDO="" ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

cd "${REPO_ROOT}"

# Step 1 — system packages
if [[ "${SKIP_APT}" -eq 0 ]]; then
  log "Step 1/6: Installing system packages"
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y \
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
else
  log "Step 1/6: Skipping apt-get install (--skip-apt)"
fi

# Step 2 — toolchain check
log "Step 2/6: Verifying toolchain"
if [[ -f "${HOME}/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.cargo/env"
fi
export PATH="${HOME}/.cargo/bin:${PATH}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found. Install Rust:" >&2
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y" >&2
  exit 1
 fi
if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js >= 20.17 (nvm/fnm/distro)." >&2
  exit 1
fi
echo "rustc:  $(rustc --version)"
echo "cargo:  $(cargo --version)"
echo "node:   $(node --version)"
echo "npm:    $(npm --version)"

# Step 3 — npm install
log "Step 3/6: Installing project dependencies (npm install)"
npm install

# Step 4 — tests
if [[ "${SKIP_TESTS}" -eq 0 ]]; then
  log "Step 4/6: Running tests and frontend build"
  cargo test --manifest-path src-tauri/Cargo.toml
  npm test
  npm run build
else
  log "Step 4/6: Skipping tests (--skip-tests)"
fi

# Step 5 — bundle .deb
log "Step 5/6: Building .deb via tauri bundler"
npx tauri build --bundles deb

# Step 6 — locate output
log "Step 6/6: Locating output"
DEB_DIR="${REPO_ROOT}/src-tauri/target/release/bundle/deb"
if [[ ! -d "${DEB_DIR}" ]]; then
  echo "Expected output dir not found: ${DEB_DIR}" >&2
  exit 1
fi

shopt -s nullglob
DEBS=("${DEB_DIR}"/*.deb)
shopt -u nullglob

if [[ "${#DEBS[@]}" -eq 0 ]]; then
  echo "No .deb produced in ${DEB_DIR}" >&2
  exit 1
fi

printf '\n\033[1;32mBuild complete.\033[0m\n'
for f in "${DEBS[@]}"; do
  printf '  %s (%s)\n' "$f" "$(du -h "$f" | cut -f1)"
done
printf '\nInstall with:\n  sudo apt install %s\n' "${DEBS[0]}"
