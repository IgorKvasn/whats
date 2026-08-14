#!/usr/bin/env bash
#
# Runs one configuration of the blank-window experiment (issue #43): launches
# the app once per trial with the chosen window options, each launch staying
# hidden in the tray until a single first show, and captures memory once.
#
# One trial per launch, because paintWhenInitiallyHidden only governs a window
# that has never been shown; cycling an already-shown window cannot detect it.
#
# Frames are judged by eye. GNOME on Wayland only offers an interactive
# screenshot portal, which needs a click per shot, so automated capture per
# trial is not possible on this platform. Start the observer (printed below)
# in a second terminal before answering the prompt here.
#
# Usage:
#   scripts/run-blank-frame-experiment.sh <cheap-only|no-paint-when-hidden|control> [trials]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXECUTABLE="${WHATS_EXE:-/opt/whats/whats}"

CONFIG="${1:-}"
TRIALS="${2:-30}"

case "${CONFIG}" in
  cheap-only|no-paint-when-hidden|control) ;;
  *)
    echo "Usage: $0 <cheap-only|no-paint-when-hidden|control> [trials]" >&2
    exit 2
    ;;
esac

OUT_DIR="${REPO_ROOT}/docs/memory/blank-frame-$(date +%Y%m%d)/${CONFIG}"
mkdir -p "${OUT_DIR}"
TRIAL_LOG="${OUT_DIR}/trials.jsonl"
: > "${TRIAL_LOG}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# The trial requires the window to be unshown until the show under test.
SETTINGS="${HOME}/.config/whats/settings.json"
if ! rg -q '"startMinimizedToTray": true' "${SETTINGS}" 2>/dev/null; then
  echo "startMinimizedToTray must be enabled in ${SETTINGS}" >&2
  exit 1
fi

# Memory is captured on this trial only; every trial is an identical launch, so
# one reading per configuration is representative and 30 would cost 30 minutes.
MEMORY_TRIAL=3

log "Configuration: ${CONFIG}, ${TRIALS} trials"
echo "Trial log: ${TRIAL_LOG}"
echo
echo "In a SECOND terminal, start the observer now:"
echo "  cd ${REPO_ROOT} && npm run observe-blank-frames -- --log ${TRIAL_LOG} --out ${OUT_DIR}/summary.json"
echo
read -r -p "Press Enter once the observer is recording..."

for trial in $(seq 1 "${TRIALS}"); do
  pkill -f "^${EXECUTABLE}$" 2>/dev/null || true
  # The tray icon and single-instance lock outlive the main process briefly;
  # launching too early attaches to the dying instance instead of starting a
  # fresh one, which would leave the window already shown.
  sleep 4

  WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
  WHATS_BLANK_TRIAL="${trial}" \
  WHATS_BLANK_LOG="${TRIAL_LOG}" \
    "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app-${trial}.log" 2>&1 &

  if [[ "${trial}" -eq "${MEMORY_TRIAL}" ]]; then
    log "Trial ${trial}/${TRIALS} — also capturing memory at T+10s and T+60s"
    (cd "${REPO_ROOT}" && npm run --silent measure-memory -- \
      --at 10,60 --json --exe "${EXECUTABLE}") > "${OUT_DIR}/memory.json" \
      || echo "memory capture failed; continuing" >&2
  else
    printf '  trial %s/%s\n' "${trial}" "${TRIALS}"
  fi

  # The app shows its window 8s after page load and exits itself afterwards.
  # Wait for that exit rather than a fixed sleep, so a slow load cannot cause
  # the next launch to overlap this one.
  for _ in $(seq 1 60); do
    if ! pgrep -f "^${EXECUTABLE}$" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
done

pkill -f "^${EXECUTABLE}$" 2>/dev/null || true

log "All ${TRIALS} trials done for ${CONFIG}"
echo "Press q in the observer terminal to write ${OUT_DIR}/summary.json"
