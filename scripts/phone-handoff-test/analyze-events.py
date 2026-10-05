#!/usr/bin/env python3
"""Pairs heartbeat sends (PC log) with phone-side events (MacroDroid log).

Inputs:
  sends.csv   written by heartbeat-sender.sh: sent_ms,seq,state,http_code,curl_seconds
  events.csv  written on the phone by the test macros, one event per line:
                <system_time_ms>,<kind>,<detail>
              kinds: attended / away (detail = seq), timeout, replay (detail = app),
              anything else is listed as-is.

Usage:
  analyze-events.py sends.csv events.csv [--interval 60] [--clock-offset-ms N]

clock-offset-ms = phone clock minus PC clock. Measure it with
  echo $(( $(adb shell date +%s%3N) - $(date +%s%3N) ))
"""
import argparse
import csv
import statistics
import sys
from datetime import datetime


def hms(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")


def percentile(values, fraction):
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))
    return ordered[index]


def read_sends(path):
    sends = {}
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                sends[int(row["seq"])] = row
                row["sent_ms"] = int(row["sent_ms"])
            except (KeyError, ValueError):
                continue
    return sends


def read_events(path, clock_offset_ms):
    events = []
    with open(path, newline="") as handle:
        for line in handle:
            parts = [part.strip() for part in line.strip().split(",", 2)]
            if len(parts) < 2 or not parts[0].isdigit():
                continue
            events.append({
                "ms": int(parts[0]) - clock_offset_ms,
                "kind": parts[1],
                "detail": parts[2] if len(parts) > 2 else "",
            })
    events.sort(key=lambda event: event["ms"])
    return events


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sends")
    parser.add_argument("events")
    parser.add_argument("--interval", type=int, default=60, help="heartbeat interval in seconds")
    parser.add_argument("--clock-offset-ms", type=int, default=0)
    args = parser.parse_args()

    sends = read_sends(args.sends)
    events = read_events(args.events, args.clock_offset_ms)
    heartbeats = [event for event in events if event["kind"] in ("attended", "away")]

    arrived_by_seq = {}
    unmatched = []
    for event in heartbeats:
        try:
            seq = int(event["detail"])
        except ValueError:
            unmatched.append(event)
            continue
        if seq in sends:
            arrived_by_seq.setdefault(seq, event)
        else:
            unmatched.append(event)

    attended_sends = {seq: row for seq, row in sends.items() if row["state"] == "attended"}
    print(f"sends: {len(sends)} ({len(attended_sends)} attended), phone events: {len(events)}")
    http_codes = {}
    for row in sends.values():
        http_codes[row["http_code"]] = http_codes.get(row["http_code"], 0) + 1
    print(f"http codes: {http_codes}")

    missing = sorted(seq for seq in sends if seq not in arrived_by_seq)
    print(f"\narrived: {len(arrived_by_seq)}/{len(sends)}, missing seqs: {missing if missing else 'none'}")
    if unmatched:
        print(f"phone heartbeats with no matching send: {len(unmatched)}")

    latencies = {seq: arrived_by_seq[seq]["ms"] - sends[seq]["sent_ms"] for seq in arrived_by_seq}
    if latencies:
        values = list(latencies.values())
        print("\nlatency send -> phone (s): "
              f"min {min(values)/1000:.1f}  median {statistics.median(values)/1000:.1f}  "
              f"p90 {percentile(values, 0.9)/1000:.1f}  max {max(values)/1000:.1f}")
        if min(values) < -2000:
            print("  negative latency: clock offset is wrong, pass --clock-offset-ms")
        slow = sorted(latencies.items(), key=lambda item: -item[1])[:10]
        print("  slowest arrivals:")
        for seq, latency in slow:
            if latency > 2 * 1000:
                print(f"    seq {seq}: sent {hms(sends[seq]['sent_ms'])}, arrived {hms(arrived_by_seq[seq]['ms'])}, +{latency/1000:.0f}s")

    arrivals = sorted(event["ms"] for event in arrived_by_seq.values())
    gaps = [(arrivals[index] - arrivals[index - 1], arrivals[index - 1], arrivals[index]) for index in range(1, len(arrivals))]
    long_gaps = [gap for gap in gaps if gap[0] > 2 * args.interval * 1000]
    print(f"\narrival gaps longer than {2 * args.interval}s: {len(long_gaps)}")
    for gap_ms, start_ms, end_ms in long_gaps:
        print(f"  {hms(start_ms)} -> {hms(end_ms)}  ({gap_ms/1000/60:.1f} min)")

    # Collapsible FCM throttling shows as a steady ~3 min arrival cadence
    # after about 20 messages, with sends still every `interval` seconds.
    bursts = sum(1 for gap_ms, _, _ in gaps if gap_ms < 5000)
    print(f"arrivals within 5s of the previous one (bunching after a hold-back): {bursts}")

    timeouts = [event for event in events if event["kind"] == "timeout"]
    if timeouts:
        print("\ntimeout events (time since the last heartbeat arrival before it):")
        for event in timeouts:
            previous = [ms for ms in arrivals if ms < event["ms"]]
            since = (event["ms"] - previous[-1]) / 1000 if previous else float("nan")
            print(f"  {hms(event['ms'])}  +{since:.0f}s after last heartbeat")

    replays = [event for event in events if event["kind"] == "replay"]
    if replays:
        print(f"\nreplay beeps: {len(replays)}")
        by_app = {}
        for event in replays:
            by_app[event["detail"]] = by_app.get(event["detail"], 0) + 1
        for app, count in sorted(by_app.items(), key=lambda item: -item[1]):
            print(f"  {count:3d}  {app}")

    others = [event for event in events if event["kind"] not in ("attended", "away", "timeout", "replay")]
    if others:
        print("\nother events:")
        for event in others:
            print(f"  {hms(event['ms'])}  {event['kind']} {event['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
