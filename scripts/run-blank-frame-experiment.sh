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

log "Configuration: ${CONFIG}, ${TRIALS} trials"
echo "Watch the window on each trial. A '>>> trial N' line prints at the moment"
echo "the window appears; note any number that shows a blank or white frame."

SKIPPED=()

# The observer reads these live, so they must not sit in a pipe buffer: piping
# this script through anything that buffers (tail, less) would hold every trial
# banner until the run ended, leaving nothing to watch against. Write to the
# terminal directly when there is one.
# Test by opening, not with -w: /dev/tty can pass a permission test and still
# fail to open when the process has no controlling terminal. The redirection
# failure message comes from the shell, not the command, so silence it here.
if { exec {BANNER}>/dev/tty; } 2>/dev/null; then
  :
else
  exec {BANNER}>&2
fi
banner() { printf "$@" >&${BANNER}; }

for trial in $(seq 1 "${TRIALS}"); do
  WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
  WHATS_BLANK_TRIAL="${trial}" \
  WHATS_BLANK_LOG="${TRIAL_LOG}" \
    "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app-${trial}.log" 2>&1 &
  APP_PID=$!

  # Announce the trial when the window is actually on screen, not at launch: the
  # show happens several seconds into the process (page load, then the settle
  # delay in src/main/index.ts), so a
  # banner printed at launch points the observer at the wrong moment. The app
  # logs the line below as it shows, which is the exact instant to look.
  (
    for _ in $(seq 1 400); do
      if rg -q "trial ${trial} shown" "${OUT_DIR}/app-${trial}.log" 2>/dev/null; then
        banner '\033[1m  >>> trial %s/%s  <-- LOOK NOW\033[0m\n' "${trial}" "${TRIALS}"
        exit 0
      fi
      sleep 0.1
    done
    banner '\033[1;33m  trial %s/%s: never showed\033[0m\n' "${trial}" "${TRIALS}"
  ) &
  BANNER_PID=$!

  # Wait on the pid we launched. Matching by command pattern is unreliable here:
  # the real argv carries --ozone-platform and Electron's helper processes share
  # the executable path, so a pattern either misses the process or matches a
  # helper. A miss is silent and costly -- it lets the next launch start while
  # this instance still holds the single-instance lock, so the new process exits
  # immediately without ever showing a window.
  wait "${APP_PID}" 2>/dev/null || true

  # Reap the watcher only after the app has exited, which means the show has
  # already happened or never will.
  wait "${BANNER_PID}" 2>/dev/null || kill "${BANNER_PID}" 2>/dev/null || true

  # The lock and tray icon outlive the process briefly; the next launch must not
  # attach to the dying instance, which would leave its window already shown.
  sleep 3

  if ! rg -q "\"index\":${trial}," "${TRIAL_LOG}" 2>/dev/null; then
    banner '    \033[1;33mno show recorded; not counted\033[0m\n'
    SKIPPED+=("${trial}")
  fi
done

RECORDED=$(rg -c '"kind":"trial"' "${TRIAL_LOG}" 2>/dev/null || echo 0)
log "${CONFIG}: ${RECORDED} of ${TRIALS} trials recorded"

# Memory gets its own launch, not a trial. A trial lives ~9s (load, 5s settle,
# one 2.5s show, exit), so it dies before the T+10s reading and cannot reach
# T+60s at all. This launch omits WHATS_BLANK_TRIAL, which leaves the trial hook
# inert, so the app sits in the tray exactly as it ships -- the same
# tray-resident scenario the #42 baseline measures, and where these options cost
# their memory.
log "Capturing memory for ${CONFIG} (tray-resident, ~70s)"
WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
  "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app-memory.log" 2>&1 &
MEMORY_APP_PID=$!

if (cd "${REPO_ROOT}" && npm run --silent measure-memory -- \
  --at 10,60 --json --exe "${EXECUTABLE}") >"${OUT_DIR}/memory.json" \
  2>"${OUT_DIR}/memory.err"; then
  echo "    memory written to ${OUT_DIR}/memory.json"
else
  echo "    memory capture failed; see ${OUT_DIR}/memory.err" >&2
fi

kill "${MEMORY_APP_PID}" 2>/dev/null || true
wait "${MEMORY_APP_PID}" 2>/dev/null || true

# A trial that never showed a window is not a blank frame, and must not be
# reported as one. Surface these loudly so they are excluded by number.
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  printf '\033[1;33mTrials that never showed a window (ignore these numbers): %s\033[0m\n' \
    "${SKIPPED[*]}"
fi
echo "Record the blank ones with:"
echo "  npm run record-blank-frames -- --log ${TRIAL_LOG} --out ${OUT_DIR}/summary.json"
