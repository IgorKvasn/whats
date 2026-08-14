#!/usr/bin/env bash
#
# Runs one configuration of the blank-window experiment (issue #43): launches
# the app once per trial with the chosen window options, each launch staying
# hidden in the tray until a single first show, and captures memory once.
#
# One trial per launch, because paintWhenInitiallyHidden only governs a window
# that has never been shown; cycling an already-shown window cannot detect it.
#
# Frames are judged by eye: GNOME on Wayland only offers an interactive
# screenshot portal, needing a click per shot, so automated capture per trial is
# not possible. Watch the screen and note the trial numbers printed here that
# showed a blank or white frame, then record them with:
#
#   npm run record-blank-frames -- --log <trials.jsonl> --out <summary.json>
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
# one reading per configuration is representative and 30 would add 30 minutes.
MEMORY_TRIAL=3

log "Configuration: ${CONFIG}, ${TRIALS} trials"
echo "Watch the window on each trial. Note any trial number that shows a blank"
echo "or white frame; you will enter them once at the end."

for trial in $(seq 1 "${TRIALS}"); do
  pkill -f "^${EXECUTABLE}$" 2>/dev/null || true
  # The tray icon and single-instance lock outlive the main process briefly;
  # launching too early attaches to the dying instance instead of starting a
  # fresh one, which would leave the window already shown.
  sleep 4

  printf '\033[1m  trial %s/%s\033[0m\n' "${trial}" "${TRIALS}"

  WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
  WHATS_BLANK_TRIAL="${trial}" \
  WHATS_BLANK_LOG="${TRIAL_LOG}" \
    "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app-${trial}.log" 2>&1 &

  if [[ "${trial}" -eq "${MEMORY_TRIAL}" ]]; then
    echo "    (also capturing memory at T+10s and T+60s)"
    (cd "${REPO_ROOT}" && npm run --silent measure-memory -- \
      --at 10,60 --json --exe "${EXECUTABLE}") > "${OUT_DIR}/memory.json" \
      || echo "    memory capture failed; continuing" >&2
  fi

  # The app shows its window 8s after page load and exits itself afterwards.
  # Wait for that exit rather than a fixed sleep, so a slow load cannot let the
  # next launch overlap this one.
  for _ in $(seq 1 60); do
    if ! pgrep -f "^${EXECUTABLE}$" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
done

pkill -f "^${EXECUTABLE}$" 2>/dev/null || true

RECORDED=$(rg -c '"kind":"trial"' "${TRIAL_LOG}" 2>/dev/null || echo 0)
log "${CONFIG}: ${RECORDED} of ${TRIALS} trials recorded"
echo "Record the blank ones with:"
echo "  npm run record-blank-frames -- --log ${TRIAL_LOG} --out ${OUT_DIR}/summary.json"
