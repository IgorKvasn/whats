#!/usr/bin/env bash
#
# Runs one configuration of the blank-window experiment (issue #43): launches
# the app with the chosen window options, drives scripted hide/show cycles,
# captures memory, and records the observer's blank-frame reports.
#
# Frames are judged by eye. GNOME on Wayland only offers an interactive
# screenshot portal, which needs a click per shot, so 30 automated captures per
# configuration are not possible on this platform.
#
# Usage:
#   scripts/run-blank-frame-experiment.sh <cheap-only|no-paint-when-hidden|control> [cycles]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXECUTABLE="${WHATS_EXE:-/opt/whats/whats}"

CONFIG="${1:-}"
CYCLES="${2:-30}"

case "${CONFIG}" in
  cheap-only|no-paint-when-hidden|control) ;;
  *)
    echo "Usage: $0 <cheap-only|no-paint-when-hidden|control> [cycles]" >&2
    exit 2
    ;;
esac

OUT_DIR="${REPO_ROOT}/docs/memory/blank-frame-$(date +%Y%m%d)/${CONFIG}"
mkdir -p "${OUT_DIR}"
CYCLE_LOG="${OUT_DIR}/cycles.jsonl"
: > "${CYCLE_LOG}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

log "Configuration: ${CONFIG}, ${CYCLES} cycles"

if pgrep -f "^${EXECUTABLE}$" >/dev/null 2>&1; then
  log "Quitting the running instance"
  pkill -f "^${EXECUTABLE}$" || true
  # The tray icon and the single-instance lock outlive the main process
  # briefly; launching too early silently attaches to the dying instance.
  sleep 5
fi

log "Launching"
WHATS_EXPERIMENT_CONFIG="${CONFIG}" \
WHATS_BLANK_CYCLES="${CYCLES}" \
WHATS_BLANK_LOG="${CYCLE_LOG}" \
  "${EXECUTABLE}" --ozone-platform=wayland >"${OUT_DIR}/app.log" 2>&1 &

log "Capturing memory at T+10s and T+60s"
(cd "${REPO_ROOT}" && npm run --silent measure-memory -- --at 10,60 --json --exe "${EXECUTABLE}") \
  > "${OUT_DIR}/memory.json" || echo "memory capture failed; continuing" >&2

log "Cycles begin after the page loads. Watch the window."
echo "Press SPACE for every blank or white frame; press q when the app logs 'cycles complete'."
(cd "${REPO_ROOT}" && npm run --silent observe-blank-frames -- \
  --log "${CYCLE_LOG}" --out "${OUT_DIR}/summary.json")

log "Results in ${OUT_DIR}"
