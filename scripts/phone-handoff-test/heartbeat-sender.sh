#!/usr/bin/env bash
# Sends phone-handoff heartbeats to a MacroDroid webhook and logs every send.
#
# The webhook URL is a secret (anyone holding it can mute the phone). It is read
# from the MACRODROID_WEBHOOK_URL environment variable or from
# ~/.config/whats-handoff-test/webhook-url and is never written to the log.
#
# Usage:
#   heartbeat-sender.sh                      # attended every 60 s until Ctrl-C
#   heartbeat-sender.sh --interval 60 --duration 1800
#   heartbeat-sender.sh --once away          # single request, then exit
#   heartbeat-sender.sh --away-on-exit       # send "away" when stopped with Ctrl-C
#
# Log format (CSV, appended): sent_ms,seq,state,http_code,curl_seconds
set -euo pipefail

interval_seconds=60
duration_seconds=0
away_on_exit=0
once_state=""
log_file="${HOME}/.local/share/whats-handoff-test/sends.csv"
url_file="${HOME}/.config/whats-handoff-test/webhook-url"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) interval_seconds="$2"; shift 2 ;;
    --duration) duration_seconds="$2"; shift 2 ;;
    --log) log_file="$2"; shift 2 ;;
    --once) once_state="$2"; shift 2 ;;
    --away-on-exit) away_on_exit=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

webhook_url="${MACRODROID_WEBHOOK_URL:-}"
if [[ -z "$webhook_url" && -r "$url_file" ]]; then
  webhook_url="$(tr -d '[:space:]' < "$url_file")"
fi
if [[ -z "$webhook_url" ]]; then
  echo "No webhook URL. Set MACRODROID_WEBHOOK_URL or write it to $url_file (chmod 600)." >&2
  exit 1
fi
case "$webhook_url" in
  *\?*) query_separator="&" ;;
  *) query_separator="?" ;;
esac

mkdir -p "$(dirname "$log_file")"
[[ -s "$log_file" ]] || echo "sent_ms,seq,state,http_code,curl_seconds" > "$log_file"

last_seq=$(awk -F, 'NR > 1 && $2 ~ /^[0-9]+$/ { seq = $2 } END { print seq + 0 }' "$log_file")
seq=$last_seq

send() {
  local state="$1"
  seq=$((seq + 1))
  local sent_ms
  sent_ms=$(date +%s%3N)
  local result
  result=$(curl --silent --show-error --output /dev/null --max-time 20 \
    --write-out '%{http_code},%{time_total}' \
    "${webhook_url}${query_separator}state=${state}&seq=${seq}" 2>/dev/null || echo "000,0")
  echo "${sent_ms},${seq},${state},${result}" >> "$log_file"
  printf '%s  seq=%-5s %-8s http=%s\n' "$(date '+%H:%M:%S')" "$seq" "$state" "${result%%,*}"
}

if [[ -n "$once_state" ]]; then
  send "$once_state"
  exit 0
fi

on_exit() {
  if [[ $away_on_exit -eq 1 ]]; then
    echo "sending away"
    send away
  fi
  echo "log: $log_file"
}
trap on_exit EXIT

echo "heartbeat every ${interval_seconds}s (duration: ${duration_seconds:-0}s, 0 = until Ctrl-C), log: $log_file"
start_seconds=$(date +%s)
while :; do
  send attended
  if [[ $duration_seconds -gt 0 && $(( $(date +%s) - start_seconds + interval_seconds )) -ge $duration_seconds ]]; then
    break
  fi
  sleep "$interval_seconds"
done
