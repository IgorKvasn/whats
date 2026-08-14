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

SKIPPED=()

for trial in $(seq 1 "${TRIALS}"); do
  printf '\033[1m  trial %s/%s\033[0m\n' "${trial}" "${TRIALS}"

  WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
  WHATS_BLANK_TRIAL="${trial}" \
  WHATS_BLANK_LOG="${TRIAL_LOG}" \
    "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app-${trial}.log" 2>&1 &
  APP_PID=$!

  # Backgrounded so the app's own lifecycle drives the trial; run inline this
  # blocks until the capture finishes, and the app has exited by then.
  #
  # T+10s only: a trial lives ~14s (load, one show, exit), so a T+60s reading is
  # not obtainable here. The tray-resident T+60s figure comes from the #42
  # baseline protocol, which keeps the app running.
  if [[ "${trial}" -eq "${MEMORY_TRIAL}" ]]; then
    echo "    (also capturing memory at T+10s)"
    (cd "${REPO_ROOT}" && npm run --silent measure-memory -- \
      --at 10 --json --exe "${EXECUTABLE}") > "${OUT_DIR}/memory.json" \
      2>"${OUT_DIR}/memory.err" \
      || echo "    memory capture failed; see memory.err" >&2 &
    MEMORY_PID=$!
  fi

  # Wait on the pid we launched. Matching by command pattern is unreliable here:
  # the real argv carries --ozone-platform and Electron's helper processes share
  # the executable path, so a pattern either misses the process or matches a
  # helper. A miss is silent and costly -- it lets the next launch start while
  # this instance still holds the single-instance lock, so the new process exits
  # immediately without ever showing a window.
  wait "${APP_PID}" 2>/dev/null || true

  if [[ "${trial}" -eq "${MEMORY_TRIAL}" ]]; then
    wait "${MEMORY_PID}" 2>/dev/null || true
  fi

  # The lock and tray icon outlive the process briefly; the next launch must not
  # attach to the dying instance, which would leave its window already shown.
  sleep 3

  if ! rg -q "\"index\":${trial}," "${TRIAL_LOG}" 2>/dev/null; then
    printf '    \033[1;33mno show recorded; not counted\033[0m\n'
    SKIPPED+=("${trial}")
  fi
done

RECORDED=$(rg -c '"kind":"trial"' "${TRIAL_LOG}" 2>/dev/null || echo 0)
log "${CONFIG}: ${RECORDED} of ${TRIALS} trials recorded"

# A trial that never showed a window is not a blank frame, and must not be
# reported as one. Surface these loudly so they are excluded by number.
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  printf '\033[1;33mTrials that never showed a window (ignore these numbers): %s\033[0m\n' \
    "${SKIPPED[*]}"
fi
echo "Record the blank ones with:"
echo "  npm run record-blank-frames -- --log ${TRIAL_LOG} --out ${OUT_DIR}/summary.json"
