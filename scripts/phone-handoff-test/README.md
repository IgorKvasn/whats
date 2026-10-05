# Phone handoff: on-device heartbeat test

Test harness for [Test heartbeat delivery and the timeout timer on the actual phone](https://github.com/IgorKvasn/whats/issues/91).
It measures the points the webhook research ([#86](https://github.com/IgorKvasn/whats/issues/86)) left unconfirmed before the heartbeat timings in [#89](https://github.com/IgorKvasn/whats/issues/89) are fixed.

Glossary terms are from `CONTEXT.md`. Never put the webhook URL or device id in an issue, commit, or log.

## 0. Setup

PC:

```sh
mkdir -p ~/.config/whats-handoff-test
printf '%s' 'https://trigger.macrodroid.com/<device-id>/handoff' > ~/.config/whats-handoff-test/webhook-url
chmod 600 ~/.config/whats-handoff-test/webhook-url
```

Phone (Pixel 9a, Android 16), all in MacroDroid:

1. Install MacroDroid (free tier is enough). Grant notification access, "Alarms & reminders" (exact alarm), and "All files access" (for Write to File).
2. MacroDroid settings → **Ignore Battery Optimisations** → follow the prompt.
3. Create folder `Download/handoff-test` on the phone.
4. Build the three test macros below. Every phone-side observation is one line appended to `Download/handoff-test/events.csv` as `<system_time_ms>,<kind>,<detail>`.

**Macro A: heartbeat receiver**

- Global variables (MacroDroid home → Variables): `state` (String), `seq` (Integer). The webhook sets them by name; it does not create them, and names are case-sensitive.
- Trigger: Webhook (URL), identifier `handoff`. Leave the Variable Whitelist off for the test, or whitelist `state` and `seq`.
- Actions:
  1. Write to File → `Download/handoff-test/events.csv`, append: `{system_time_ms},{v=state},{v=seq}` followed by a newline.
  2. If `{v=state}` = `attended`: Stopwatch `heartbeat` → **Reset and Restart**.
  3. If `{v=state}` = `away`: Stopwatch `heartbeat` → **Pause**, then Stopwatch `heartbeat` → **Reset**, and append `{system_time_ms},away-stop,{v=seq}`.

**Macro B: timeout**

- Trigger: Stopwatch `heartbeat` at **180 s**, **Use alarm** on.
- Action: Write to File append `{system_time_ms},timeout,`. Then Stopwatch `heartbeat` → **Pause**, then **Reset**.

**Macro C: replay draft** (for the [#88](https://github.com/IgorKvasn/whats/issues/88) checks; enable only during step 5)

- Trigger: Notification Received, **Exclude** WhatsApp and MacroDroid, **Ignore ongoing/persistent notifications** on.
- Actions: Play Sound on the **media** stream (second variant on the **alarm** stream when asked below), then Write to File append `{system_time_ms},replay,{not_app_name}`.

adb over Wi-Fi is needed for the Doze steps, because a USB cable counts as "charging" and blocks Doze:

```sh
adb tcpip 5555 && adb connect <phone-lan-ip>:5555   # or Developer options → Wireless debugging
echo $(( $(adb shell date +%s%3N) - $(date +%s%3N) ))   # clock offset phone - PC, note it
```

## 1. Permissions and battery state

```sh
adb shell dumpsys deviceidle whitelist | grep -i macrodroid        # expect com.arlosoft.macrodroid listed (exempt)
adb shell dumpsys package com.arlosoft.macrodroid | grep -iE 'EXACT_ALARM'   # SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM: granted=true?
adb shell appops get com.arlosoft.macrodroid SCHEDULE_EXACT_ALARM
adb shell am get-standby-bucket com.arlosoft.macrodroid            # 10 = active, 5 = exempted
```

Record: exempt yes/no, which exact-alarm permission is granted, standby bucket.

## 2. Which alarm does "Use alarm" schedule?

Fire one heartbeat so Macro A starts the stopwatch, then within 180 s dump the alarms:

```sh
./heartbeat-sender.sh --once attended
adb shell dumpsys alarm > alarm.txt
grep -n -i -B3 -A15 macrodroid alarm.txt
```

Record the alarm block verbatim (type `RTC_WAKEUP` or `ELAPSED_REALTIME_WAKEUP`, and the flags). Flag meanings:

- `FLAG_ALLOW_WHILE_IDLE` plus `FLAG_STANDALONE` = `setExactAndAllowWhileIdle`, subject to the up-to-15-minute idle deferral.
- `FLAG_WAKE_FROM_IDLE` plus `FLAG_ALLOW_WHILE_IDLE_UNRESTRICTED` = `setAlarmClock`, fires on time and lifts Doze.
- Neither = plain `setExact`, deferred in Doze.

## 3. Heartbeat delivery for 30+ minutes, screen off, phone still

Phone on the desk, unplugged, screen off, do not touch it. Run on the PC:

```sh
./heartbeat-sender.sh --interval 60 --duration 2400
```

In parallel, check Doze depth a few times (needs Wi-Fi adb; adb itself keeps a connection alive, so also run one stretch without adb connected):

```sh
adb shell dumpsys deviceidle get deep     # ACTIVE / INACTIVE / IDLE_PENDING / SENSING / LOCATING / IDLE / IDLE_MAINTENANCE
adb shell dumpsys deviceidle get light
```

Note down the times when the phone was in `IDLE`. A 30-minute run with 60 s sends is 40 messages, which is enough to see collapsible throttling (burst of 20, then roughly one every 3 minutes).

## 4. Timeout under deep Doze

Still with sends running, force Doze, then stop the sender **without** sending `away` (Ctrl-C; the default does not send away):

```sh
adb shell dumpsys battery unplug
adb shell dumpsys deviceidle force-idle        # expect "Now forced in to deep idle mode"
adb shell dumpsys deviceidle get deep           # IDLE
# Ctrl-C the sender now and note the time
```

Leave the phone alone for 20 minutes. Do not wake the screen. Then:

```sh
adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset
```

Repeat once without `force-idle`, waiting for natural Doze (step 3 shows when `IDLE` is reached), to see the realistic case.

## 5. Replay macro checks (from #88)

Set notification volume to 0 by hand (Sound settings), enable Macro C, then:

- Trigger a notification from a non-excluded app (e.g. send yourself an email). Audible with Play Sound on the **media** stream? Switch Macro C to the **alarm** stream and repeat.
- Does MacroDroid's own persistent notification trigger Macro C despite "Ignore ongoing/persistent notifications"? (Toggle MacroDroid's notification off and on in its settings to repost it.)
- Leave Macro C enabled for a normal day with notification volume 0. Every beep is a `replay` line; the analyzer counts them per app.

## 6. Calls with notification volume at 0

With notification volume 0 (and Macro C off): call the phone from another phone, then make a WhatsApp voice call to it. Record whether each rang audibly.

## 7. Collect and analyze

```sh
adb pull /sdcard/Download/handoff-test/events.csv .
./analyze-events.py ~/.local/share/whats-handoff-test/sends.csv events.csv --interval 60 --clock-offset-ms <offset from step 0>
```

Paste the analyzer output plus the step 1, 2, 5 and 6 observations into the resolution comment on #91. Do not include `alarm.txt` lines that contain the webhook identifier if you chose a non-generic one.

## Cleanup

Delete the three test macros, delete `Download/handoff-test`, restore notification volume, and `adb shell dumpsys deviceidle unforce && adb shell dumpsys battery reset` if you skipped that step.
