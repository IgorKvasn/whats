# MacroDroid webhook trigger: format, delivery, limits, timers under Doze

Research for #86 (parent map #84). Researched 2026-10-05. Glossary terms (Desktop attended, Desktop away, Phone muted, Heartbeat) are as defined in `CONTEXT.md`.

Each claim is marked **[verified]** (read in a primary source, linked) or **[unconfirmed]** (forum hearsay, search-engine snippets of pages I could not open, or my own inference). The MacroDroid wiki pages were read as raw wikitext (`?action=raw`). The old Tapatalk forum and the developer's Medium post returned HTTP 403, so anything that comes only from them is unconfirmed.

No real webhook URL or device id appears here. `<device-id>` is a placeholder.

## TL;DR

- URL: `https://trigger.macrodroid.com/<device-id>/<identifier>?state=attended`. A query parameter is written into an **existing** MacroDroid variable with the same name (case-sensitive). The trigger is in the **free** version. **[verified]**
- Delivery path: caller → MacroDroid's server → Firebase Cloud Messaging (FCM) → phone. This needs Google Play services and internet on the phone. A call usually arrives "within a few seconds". **[verified]** There is no delivery guarantee or SLA, and the HTTP 200 the caller gets is not a device acknowledgement. **[inference]**
- Limits: `trigger.macrodroid.com` has **no published numeric limit**, only "do not spam … may result in the device being blocked". The Pro `ask.macrodroid.com` endpoint has a documented limit of ≤1/min sustained (HTTP 429). FCM allows 240/min and 5,000/h per device. A 60 s heartbeat is about 1,440/day, which is within every published number. **[verified]** It is sustained, always-on traffic, though. Two open risks: whether the server will tolerate it, and whether the FCM messages are *collapsible* (collapsible messages are throttled to 1 every 3 min after a burst of 20). **[unconfirmed]**
- Pro: not required for the Webhook (URL) trigger. The free tier is limited to **5 macros**. The design below needs 3. **[verified]**
- Doze: the timeout timer can fire during Doze if you use **Stopwatch trigger + "Use alarm"** (needs the exact-alarm permission and a battery-optimisation exemption). Android may still delay allow-while-idle alarms "significantly … such as 15 minutes" in deep idle. **[verified]** Heartbeat delivery during Doze depends on the FCM priority MacroDroid uses. It is reportedly high priority **[unconfirmed]**, but FCM downgrades high-priority messages that don't produce a visible notification **[verified]**, and heartbeats don't produce one. Expect late heartbeats in Doze. A late heartbeat leads to a spurious unmute, which is the fail-safe direction.

## 1. URL format and parameter → variable mapping

- Format: `https://trigger.macrodroid.com/[device-id]/[identifier]`. The identifier is free text you choose and supports magic text. One phone can host many identifiers, and several macros can share one identifier, so one call can fire several macros. **[verified]** [W1], [W2]
- Query parameters set variables: `?VARNAME=value`, `?A=42&B=text`, dictionary entries `?mydict(KEY)=VALUE`, nested `?mydict(K1)(K2)=VALUE`. Supported types are String, Integer, Decimal and Boolean. **[verified]** [W1], [W2]
- "a variable set this way must already exist on the device (as a local variable of the macro or a global variable) - the webhook does not create new variables." Names are case-sensitive. Values are converted to the variable's type. **[verified]** [W1], [W3]
- You can instead turn on **Save query parameters to dictionary**. The dictionary is cleared on every request, and values are auto-typed. **[verified]** [W1]
- **Save body to string variable** stores a POST body of at most 3,800 characters, a limit that comes from FCM. **[verified]** [W2]
- Magic text available in the fired macro: `{webhook_caller_ip}` and `{webhook_query_params}`. **[verified]** [W1]
- Security: the URL acts as a bearer secret ("Treat the webhook URL like a password … Anyone who has the address can fire the macro (and set its variables)"). Optional **IP Address Whitelist** (wildcards) and **Variable Whitelist**, which blocks and logs updates to variables not on the list. **[verified]** [W1], [W3]
  - Recommendation: turn on the Variable Whitelist and allow only `state`. An IP whitelist is of little use when the PC is on a dynamic home IP or moves between networks.
- The URL changes if MacroDroid is reinstalled or its data is cleared. Export/Import Device ID keeps it, and "Generate New Device ID" invalidates every URL. That last option is the rotation path if the URL leaks. **[verified]** [W1]
- For `whats` this means: send `GET https://trigger.macrodroid.com/<device-id>/<identifier>?state=attended|away`, and the macro holds a local or global String variable `state`. `whats` must never log the full URL, because it contains the secret.

## 2. Delivery path, latency, reliability

- "When the URL is requested, MacroDroid's server delivers a push message to the device via Firebase Cloud Messaging and the matching macro fires." The phone needs Google Play services and internet. There is no same-network requirement. **[verified]** [W2], [W3]
- Latency: the official guide says the notification appears "within a few seconds" and that "push delivery is normally near-instant, but aggressive battery optimisation can hold it up". **[verified]** [W3] A forum user reports occasional delays of up to 2 minutes. **[forum, unconfirmed]** [F1]
- What the caller's HTTP 200 means: the guide calls it "the webhook service confirming delivery" [W3]. A developer forum reply says requests are not stored on the server and are forwarded straight to FCM **[unconfirmed, search snippet of 403 page]** [F2]. So 200 most likely means "accepted by MacroDroid and handed to FCM", not "the macro ran". **[inference]** For `whats`, "last successful send" should mean that the server accepted the request.
- Failure modes:
  - Stale FCM registration. Fix it with **Refresh Cloud Token** in the trigger dialog, and look for "Push token upload failed" in the System Log. **[verified]** [W1], [W3]
  - A device-specific case where webhooks stopped after some hours until a reboot. The developer suspected the device's FCM service. **[forum]** [F1]
  - Past MacroDroid server outages, including a "server meltdown" restored from backup. This is a single-developer service with no SLA. **[forum]** [F1]
- FCM priority:
  - Normal-priority messages "may be delayed … until the device exits doze". **[verified]** [A3]
  - High-priority messages "wake a sleeping device". **[verified]** [A3]
  - Search snippets of the developer's forum posts say MacroDroid uses high priority. **[unconfirmed]** [F3]
  - **Deprioritization risk:** "If FCM detects a pattern in which messages don't result in user-facing notifications, your messages may be deprioritized to normal priority … FCM uses 7 days of message behavior … independently for every instance of your application." **[verified]** [A3] A heartbeat that shows nothing, 1,440 times a day, matches that pattern exactly. **[inference]** If it happens, it affects every MacroDroid webhook on that phone, not just this one.

## 3. Limits and quotas for a ~60 s heartbeat (~1,440/day)

| Layer | Published limit | Source | Status |
|---|---|---|---|
| `trigger.macrodroid.com` (Webhook URL) | None numeric. "Do not spam the webhook endpoints with excessive requests; consistently sending too many may result in the device being blocked from the service." | [W2] | verified |
| `ask.macrodroid.com` (Webhook with response, Pro) | "Do not call it more than once per minute on a sustained basis; exceeding the limit returns HTTP 429 … may result in the device being blocked." | [W2] | verified (different endpoint) |
| Developer forum | Limit "undefined", but don't send multiple requests per second, or rate limiting may be added. One spamming IP was blocked. | [F2] | unconfirmed |
| FCM per device (Android) | 240 msg/min, 5,000 msg/h. "Don't routinely send messages near this maximum rate." | [A4] | verified |
| FCM collapsible messages | "burst of 20 messages per app per device, with a refill of 1 message every 3 minutes" | [A4] | verified (whether MacroDroid's messages are collapsible is **unknown**) |

Assessment: 1/min is well under every published number. The only number that refers to a webhook endpoint at all is the Pro endpoint's "≤1/min sustained", and a 60 s heartbeat sits exactly at that ceiling. That number doesn't apply to `trigger.macrodroid.com`, but it shows the developer's view of polling. **[inference]** To lower the risk:

- Send a heartbeat **only while attended**, and send `away` once on transition. Don't heartbeat around the clock.
- Consider **90–120 s** heartbeats with a correspondingly longer phone timeout. That gives fewer calls and leaves room for FCM delays.
- Back off on HTTP 429 or 5xx, and log those responses.
- If MacroDroid's messages turn out to be collapsible, anything faster than 1 per 3 min gets throttled after 20 messages. That would force a heartbeat of ≥3 min or a different transport (see §6).

## 4. Pro requirement

- Webhook (URL) "is available in the free version of MacroDroid … No Pro version required on either phone." **[verified]** [W3]
- Webhook (with response) and `ask.macrodroid.com` are Pro-only. They aren't needed here. **[verified]** [W2], [W4]
- Free version: "limited to five macros and shows adverts". **[verified]** [W5] The design in §5 uses 3 macros.

## 5. Reliable "no heartbeat for N minutes → unmute" under Doze

### Android facts

- Doze starts when the device is unplugged, stationary and has its screen off. That is the typical state of a phone lying on the desk while the user works at the PC. **[verified]** [A1]
- In Doze, network is suspended, wake locks are ignored, and `setExact()` alarms are deferred. `setExactAndAllowWhileIdle()` alarms do fire. `setAlarmClock()` alarms fire normally because the system leaves Doze first. **[verified]** [A1]
- `setExactAndAllowWhileIdle()` is rate-limited per app: "not … more than about every minute … when in low-power idle modes this duration may be significantly longer, such as 15 minutes". The older Doze guide says "once per 9 minutes per app". **[verified]** [A1], [A2] This quota is shared across *all* MacroDroid alarms. **[inference]**
- A battery-optimisation-exempt app "can use the network and hold partial wake locks during Doze", but regular alarms still don't fire. Doze-exempt apps are also exempt from App Standby bucket limits. **[verified]** [A1], [A5]
- Restricted bucket: one alarm per day. Apps get there after 8 days without interaction on Android 13+, unless exempt. **[verified]** [A5]

### MacroDroid facts

- The **Stopwatch** trigger fires when a named stopwatch reaches a time value. **Use Alarm** (on by default) "uses Android's alarm functionality to ensure precise timing even when the device is asleep". It needs the exact-alarm permission on Android 12+. Stopwatches persist across restarts and reboots. **[verified]** [W6]
- **Wait Before Next Action** and **Regular Interval** have the same "Use alarm" option. Without it, the OS may push the wake-up into a batching window. **[verified]** [W7], [W8]
- Cancel Macro Actions can cancel "Other instances only", which is enough for a single-macro debounce pattern. **[verified]** [W9]
- MacroDroid's troubleshooting guidance:
  - Exempt MacroDroid from battery optimisation (settings → *Ignore Battery Optimisations*).
  - On Xiaomi, Huawei, Oppo, Vivo and Samsung, also follow dontkillmyapp.com.
  - "Time-based triggers can fire late when the device is in a deep sleep (doze) state", and "Use alarm" schedules "an exact alarm rather than an inexact one".

  **[verified]** [W10]
- **Unknown:** which AlarmManager API "Use alarm" calls (`setExactAndAllowWhileIdle` or `setAlarmClock`). That decides whether the up-to-15-minute idle deferral applies. **[unconfirmed]** You can check on the device with `adb shell dumpsys alarm | grep -A3 macrodroid`, which shows the alarm type and flags.

### Recommended macro shape (3 macros, fits the free tier)

1. **Heartbeat receiver.** Trigger: Webhook (URL) `<identifier>`, with the Variable Whitelist set to `state`.
   - `state=attended`:
     - If not already muted, save the current sound state, mute, show the persistent "muted by PC" notification, and set `phone_muted=true`.
     - Then always run **Stopwatch "heartbeat": Reset and Restart**.
   - `state=away`: run the shared **unmute** action block (restore saved state, clear the notification, stop the stopwatch, set `phone_muted=false`).
2. **Timeout.** Trigger: **Stopwatch "heartbeat" at N s** with Use Alarm on. Action: unmute.
   - With 60 s heartbeats, N ≈ 180–240 s. That is about 3 missed heartbeats, as agreed in #84.
3. **Safety nets.** Triggers:
   - the notification's tap-to-unmute button;
   - optionally **Screen On**, with the constraint `phone_muted=true` and Stopwatch "heartbeat" > N.

   Action: unmute. The Screen On check covers the case where Doze deferred the timeout alarm: the moment the user looks at the phone, it catches up.

Why Stopwatch rather than Wait + Cancel Macro Actions: one persistent, alarm-backed deadline that each heartbeat pushes forward. It avoids 1,440 macro instances a day sitting in waits, and it survives an app restart. **[inference, based on [W6]]**

Device setup checklist:

- Exempt MacroDroid from battery optimisation, plus any vendor auto-start or "unrestricted" setting.
- Grant the exact-alarm permission ("Alarms & reminders").
- Keep Google Play services working.

### Remaining risk under Doze

- **Missed message (the important direction).** The desktop goes away abruptly (crash or suspend, so no `away` is sent) while the phone is in deep Doze. The timeout alarm can then be deferred, up to about 15 min if MacroDroid uses `setExactAndAllowWhileIdle`. During that window a WhatsApp message would arrive silently. The explicit `away` fast path and the Screen On safety net reduce this but don't remove it. **[inference]**
- **Spurious unmute (the harmless direction).** Heartbeats are held back by Doze or FCM deprioritization while the desktop is still attended. The phone unmutes, then re-mutes when the next heartbeat arrives (flapping). **[inference]** Mitigations: a longer N, or a short phone-side grace period. If the persistent notification is *posted or updated in response to each heartbeat*, that might count as "user-facing" for FCM's deprioritization heuristic. **[unconfirmed]**

## 6. Recommendation

- Use the **free Webhook (URL) trigger** with one identifier and `?state=attended|away`, the **Variable Whitelist** set to `state`, and a **Stopwatch + Use Alarm** timeout. That is 3 macros.
- In `whats`:
  - Send `attended` on entering Desktop attended, then a heartbeat every 60–120 s while attended (lean towards 90–120 s).
  - Send `away` once on leaving.
  - Back off on 429 or 5xx.
  - Treat HTTP 2xx as "accepted by server" only.
  - Never log the URL.
- **Before the spec is final, run an on-device test.** Pair it with #89 or the macro-design ticket.
  1. Heartbeat 60 s for 1–2 h with the phone stationary and screen off. Log arrival times with a MacroDroid Log Event to measure FCM lateness in Doze.
  2. Force Doze with `adb shell dumpsys deviceidle force-idle`, stop heartbeats, and measure when the Stopwatch timeout actually fires.
  3. Run `adb shell dumpsys alarm` to see whether "Use alarm" is an alarm-clock or an allow-while-idle alarm.
  4. Watch whether arrivals bunch up after about 20 messages. That would mean collapsible throttling.
- **Fallback transport if FCM proves too lossy in Doze:** the **HTTP Server Request** trigger. It is a local HTTP server on the phone, with no Google services or internet needed, but it only works on the same LAN. **[verified]** [W11] It has its own Doze and network-suspension problems, and the PC would need the phone's LAN IP, so treat it as a fallback only.

## Sources

MacroDroid (primary, official wiki, fetched as raw wikitext 2026-10-05):

- [W1] Trigger: Webhook (URL) — https://wiki.macrodroid.com/wiki/index.php/Trigger:_Webhook_(URL)
- [W2] Webhooks (concept guide) — https://wiki.macrodroid.com/wiki/index.php/Webhooks
- [W3] Trigger Your Phone from Anywhere with Webhooks — https://wiki.macrodroid.com/wiki/index.php/Trigger_Your_Phone_from_Anywhere_with_Webhooks
- [W4] Trigger: Webhook (with response) — https://wiki.macrodroid.com/wiki/index.php/Trigger:_Webhook_(with_response)
- [W5] Overview (Free version and Pro) — https://wiki.macrodroid.com/wiki/index.php/Overview
- [W6] Trigger: Stopwatch — https://wiki.macrodroid.com/wiki/index.php/Trigger:_Stopwatch
- [W7] Action: Wait Before Next Action — https://wiki.macrodroid.com/wiki/index.php/Action:_Wait_Before_Next_Action
- [W8] Trigger: Regular Interval — https://wiki.macrodroid.com/wiki/index.php/Trigger:_Regular_Interval
- [W9] Action: Cancel Macro Actions — https://wiki.macrodroid.com/wiki/index.php/Action:_Cancel_Macro_Actions
- [W10] Troubleshooting — https://wiki.macrodroid.com/wiki/index.php/Troubleshooting
- [W11] Trigger: HTTP Server Request — https://wiki.macrodroid.com/wiki/index.php/Trigger:_HTTP_Server_Request

Android / Firebase (primary):

- [A1] Optimize for Doze and App Standby — https://developer.android.com/training/monitoring-device-state/doze-standby
- [A2] AlarmManager reference (`setExactAndAllowWhileIdle`) — https://developer.android.com/reference/android/app/AlarmManager
- [A3] FCM: Set Android message priority (incl. deprioritization) — https://firebase.google.com/docs/cloud-messaging/android/message-priority
- [A4] FCM: Throttling and quotas — https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas
- [A5] App Standby Buckets — https://developer.android.com/topic/performance/appstandby

Forum (secondary; treat as unconfirmed):

- [F1] "Webhooks stop working after some hours" (macrodroidforum.com, read directly) — https://www.macrodroidforum.com/index.php?threads/webhooks-stop-working-after-some-hours.4107/
- [F2] "Webhook requests per second" (old Tapatalk forum, HTTP 403; content known only from search snippets) — https://www.tapatalk.com/groups/macrodroid/webhook-requests-per-second-t8457.html
- [F3] "Webhook trigger delay" (old Tapatalk forum, HTTP 403; content known only from search snippets) — https://www.tapatalk.com/groups/macrodroid/webhook-trigger-delay-t5866.html
