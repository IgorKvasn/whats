#!/usr/bin/env bash
#
# Build a .deb package of `whats` (Electron).
#
# Flags:
#   --skip-apt     Skip the apt-get install step.
#   --skip-tests   Skip npm test.
#   --no-sudo      Don't use sudo for apt-get.
#   -h, --help     Show this help.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SKIP_APT=0
SKIP_TESTS=0
SUDO="sudo"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
  log "Step 1/5: Installing system packages"
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y \
    libnotify-bin \
    pulseaudio-utils \
    dpkg \
    fakeroot
else
  log "Step 1/5: Skipping apt-get install (--skip-apt)"
fi

# Step 2 — toolchain check
log "Step 2/5: Verifying toolchain"
if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js >= 20.17 (nvm/fnm/distro)." >&2
  exit 1
fi
echo "node:   $(node --version)"
echo "npm:    $(npm --version)"

# Step 3 — npm install
log "Step 3/5: Installing project dependencies (npm install)"
npm install

# Step 4 — tests
if [[ "${SKIP_TESTS}" -eq 0 ]]; then
  log "Step 4/5: Running tests and build"
  npm test
  npm run build
else
  log "Step 4/5: Skipping tests (--skip-tests)"
  npm run build
fi

# Step 5 — package .deb
log "Step 5/5: Packaging .deb via electron-builder"
npx electron-builder --linux deb

DEB_DIR="${REPO_ROOT}/dist"
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
