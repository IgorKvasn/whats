# How can MacroDroid suppress WhatsApp notification sounds on Android?

Research for issue #85 (parent map #84). Terms follow `CONTEXT.md`: *Phone muted*, *Desktop attended*, *Desktop away*, *Heartbeat*.

Markers used below:

- **[V]** verified against a primary source (linked).
- **[U]** unconfirmed: inference or secondary claim. Needs an on-device test.

## Short answer

- A non-root app cannot change another app's notification channel. Only the user, or a caller running as system, SystemUI or shell, can do that. So "mute only WhatsApp's channel" needs Shizuku, ADB or root, plus a tool that makes the binder call. MacroDroid does not expose that call **[U]**.
- With no extra privileges, the only mechanism that lets the system silence some apps and not others is **Do Not Disturb with exceptions**. On Android 15+ MacroDroid runs its own Mode, so switching it off restores the previous state cleanly.
- **Muting the notification stream** works on every phone and is easy to restore through `{vol_notif}`. The cost is that it silences every app, not only WhatsApp.
- **Lowering the volume when a notification arrives** cannot stop the first sound. Android starts the sound before it tells notification listeners such as MacroDroid. Rejected.
- **Shizuku** adds "Configure App Notifications: disable WhatsApp". That hides WhatsApp notifications completely, not just the sound, and probably blocks WhatsApp call alerts too **[U]**. It is too blunt.

**Recommendation:** use a DND Mode with exceptions as the primary mechanism, if a one-time on-device test passes. Fall back to muting the notification stream. Details are under [Recommendation](#recommendation).

## Facts that constrain every option

1. **Channel ownership.** "After you create a notification channel, you can't change the notification channel's visual and auditory behaviors programmatically. Only the user can change the channel behaviors from the system settings." **[V]** ([channels guide][channels]). `NotificationManager.getNotificationChannel(s)` returns only the caller's own channels, or channels of a package that has made the caller its notification delegate **[V]** ([NotificationManager][nm]).
2. **Shell can edit other apps' channels.** In AOSP `NotificationManagerService`, `updateNotificationChannelForPackage(pkg, uid, channel)` is guarded by `checkCallerIsSystemOrSystemUiOrShell`, which accepts `SHELL_UID` and `ROOT_UID` **[V]** ([NMS source][nms]). A Shizuku process started via ADB runs as shell, so it can call this in principle. However:
   - `cmd notification` has no verb for editing channels. Its verbs are `set_dnd`, `allow_dnd`, `allow_listener`, `post`, `snooze` and similar **[V]** ([NotificationShellCmd][shellcmd]).
   - A `NotificationChannel` parcel cannot be built with `service call`. You would need a Shizuku-aware helper app, and the MacroDroid wiki documents no such action **[U]**.
3. **App-wide notification toggle.** `setNotificationsEnabledForPackage` requires `STATUS_BAR_SERVICE` or system/phone **[V]** ([NMS source][nms]). The Shell package holds `STATUS_BAR_SERVICE` **[V]** ([Shell manifest][shellmanifest]). MacroDroid's *Configure App Notifications* action "requires root access or Shizuku - it works by issuing … `service call notification`" and "will have no effect" otherwise **[V]** ([wiki][md-cfgnotif]).
4. **Sound plays before listeners are told.** In `PostNotificationRunnable`, `mAttentionHelper.buzzBeepBlinkLocked(...)` runs first and starts the sound and vibration. `notifyListenersPostedAndLogLocked(...)` runs after it **[V]** ([NMS source][nms]). MacroDroid's *Notification* trigger runs on Notification Access, i.e. a listener **[V]** ([wiki][md-trigger]). By the time the macro fires, the sound is already playing.
5. **DND changes on Android 15.** For apps targeting API 35, `setNotificationPolicy` "cannot modify the global notification policy". It creates or updates the app's own implicit `AutomaticZenRule`, and `setInterruptionFilter` turns that rule on and off **[V]** ([NotificationManager][nm]). MacroDroid confirms this: "On Android 15 and above it is no longer possible to set the overall system Priority Mode/Do Not Disturb state directly. … MacroDroid creates its own specific Do Not Disturb Zen Mode which it will enable/disable" **[V]** ([wiki][md-dnd]).
6. **What DND can filter on.** `ZenPolicy` filters by category and sender:
   - calls and messages by `PEOPLE_TYPE_*`
   - conversations by `CONVERSATION_SENDERS_*`
   - alarms, events and reminders
   - since API 35, `allowPriorityChannels(boolean)`, meaning channels allowed to bypass DND

   **[V]** ([ZenPolicy.Builder][zenpolicy]). An app cannot set "bypass DND" on another app's channel. It is "only modifiable by the system and the notification ranker" once the user has touched the channel **[V]** ([NotificationChannel][nc]). Per-app exceptions are therefore a **user** setting. Google Help says Modes let you "choose which apps can send you notifications", per Mode **[V, summary of help page]** ([Google Help][help-dnd]).

## Candidates

### A. Edit WhatsApp's notification channels

| Aspect | Finding |
|---|---|
| Non-root | **Not possible** (fact 1). |
| Shizuku/ADB | Possible in principle (fact 2), but needs a custom helper app. MacroDroid has no documented action for it **[U]**. WhatsApp has many channels (per-chat, groups, calls), and they would all need handling **[U]**. |
| Reliability | High once implemented: the system enforces it and there is no race. |
| Side effects | Only WhatsApp is affected. Calls stay separate if the WhatsApp call channel is left alone. |
| Save/restore | You would have to read and store each channel's importance and sound first, then write them back. If the phone crashes in between, the channels stay modified. |
| Verdict | The most precise option, but it is not achievable with stock MacroDroid. |

### B. DND / Mode with exceptions (all apps allowed except WhatsApp)

| Aspect | Finding |
|---|---|
| Non-root | **Yes.** Needs Do Not Disturb access **[V]** ([wiki permissions][md-perm], [wiki DND][md-dnd]). |
| How | The user sets up the exceptions **once** in system Settings: allowed apps, calls (anyone), alarms, and visual effects. MacroDroid then only switches the Mode on and off. On Android 15+ that is MacroDroid's own Mode. Whether that Mode appears in Settings → Modes and accepts per-app exceptions is **[U]**; test it on the phone. |
| Reliability | High. The system enforces the filter, so there is no race. |
| Side effects | Message-category filters cannot single out WhatsApp. "Allow messages / conversations" would also let WhatsApp through (fact 6), so the per-app list must be used. Apps that are not on the list are also silenced, including newly installed ones. DND can also hide peeking, status-bar icons and similar, depending on the Mode's visual settings. Phone calls stay audible if "calls from anyone" is allowed. Whether WhatsApp *calls* still ring while WhatsApp is not an allowed app is **[U]**. |
| Save/restore | **Android 15+:** turning MacroDroid's Mode off leaves the user's own DND and Modes untouched, so the restore is clean (fact 5). **Below 15:** the macro changes global DND. It must read the prior state first, using the *Priority Mode / DND* constraint, and store it in a variable **[V]** ([wiki constraint][md-dndc]). |
| Verdict | **Primary candidate**, pending the on-device check. |

### C. Lower the volume when a WhatsApp notification arrives

| Aspect | Finding |
|---|---|
| Non-root | Yes. Uses the Notification trigger and Volume Change. |
| Reliability | **Fundamentally racy.** The sound starts before MacroDroid is notified (fact 4). At best it cuts off a sound that is already playing. Whether lowering the volume mid-playback truncates the sound is **[U]**. |
| Side effects | Any other app's sound during the dip is lost too. Restoring too early or too late interacts badly with a burst of messages. |
| Save/restore | Read `{vol_notif}`, then set it back **[V]** ([wiki magic text][md-magic]). |
| Verdict | **Reject.** It cannot meet "suppress". |

### D. Mute the notification stream globally

| Aspect | Finding |
|---|---|
| Non-root | **Yes.** *Volume Change* → Notification = 0%. Some streams may need DND access **[V]** ([wiki][md-vol]). |
| Reliability | High, and it works on any device. The *Set volume in foreground* option exists for devices that block background volume changes **[V]** ([wiki][md-vol]). |
| Side effects | Every app's notification sound is muted, not only WhatsApp's. Phone calls use the Ringer stream. On devices that link ring and notification volume, muting one may mute the other, or switch to vibrate or silent **[U]**. The wiki notes that ringer changes can affect ringer mode **[V]** ([wiki][md-vol]). Vibration is not affected. |
| Save/restore | Store `{vol_notif}` in a variable before muting and write it back on unmute **[V]** ([wiki magic text][md-magic]). If the user changes the volume while the phone is muted, that change is overwritten on restore **[U]**. |
| Verdict | **Fallback.** Simple and robust, but not scoped to WhatsApp. |

### E. Shizuku: disable WhatsApp notifications entirely

| Aspect | Finding |
|---|---|
| Feasibility | *Configure App Notifications* with Shizuku or root **[V]** ([wiki][md-cfgnotif]). Shizuku must be restarted after each reboot unless wireless-debugging auto-start is set up **[V]** ([wiki ADB hack][md-adb]). |
| Side effects | WhatsApp notifications disappear completely, visuals included. Incoming WhatsApp call alerts are most likely blocked as well **[U]**. |
| Save/restore | Set back to enabled. The prior state is assumed to be "enabled". |
| Verdict | Too blunt for *Phone muted*. Not recommended. |

### Not pursued

- *Set Notification Sound: None* changes only the system default sound. "Apps or notification channels configured with their own specific sound are not affected" **[V]** ([wiki][md-setsound]).
- Driving WhatsApp's or the system's channel settings through accessibility UI automation is possible in principle, but brittle across app and OS updates **[U]**.

## Recommendation

1. **Primary: B (DND/Mode with exceptions).** It is non-root, enforced by the system, and on Android 15+ restoring is just switching off MacroDroid's own Mode. Before relying on it, confirm on the user's phone:
   - (a) MacroDroid's Mode can be given per-app exceptions in Settings → Modes;
   - (b) phone calls still ring;
   - (c) how WhatsApp calls behave;
   - (d) the visual-effect settings keep heads-up notifications from other apps.
2. **Fallback: D (notification stream at 0%)** with `{vol_notif}` saved and restored. Use it if B fails test (a) or (b), or if the user accepts silencing all notification sounds while at the PC. Check whether ring and notification volume are linked on the device.
3. **Reject C** (the race is structural, fact 4) and **E** (it hides notifications and probably calls).
4. **A** is the only option that truly targets WhatsApp alone. It needs Shizuku plus a custom helper app. Revisit it only if B and D both prove unacceptable.

For the macro design in #84: whichever mechanism is chosen, the restore path must run on the missed-heartbeat timeout as well as on `state=away`. The saved state (prior volume, or prior DND state below Android 15) belongs in MacroDroid global variables so that it survives between macro runs.

## Sources

- [channels]: https://developer.android.com/develop/ui/views/notifications/channels
- [nm]: https://developer.android.com/reference/android/app/NotificationManager
- [nc]: https://developer.android.com/reference/android/app/NotificationChannel
- [zenpolicy]: https://developer.android.com/reference/android/service/notification/ZenPolicy.Builder
- [nms]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/notification/NotificationManagerService.java
- [shellcmd]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/notification/NotificationShellCmd.java
- [shellmanifest]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/packages/Shell/AndroidManifest.xml
- [help-dnd]: https://support.google.com/android/answer/9069335
- [md-trigger]: https://wiki.macrodroid.com/wiki/index.php/Trigger:_Notification
- [md-dnd]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Priority_Mode_/_Do_Not_Disturb
- [md-dndc]: https://wiki.macrodroid.com/wiki/index.php?title=Constraint:_Priority_Mode_/_Do_Not_Disturb
- [md-vol]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Volume_Change
- [md-cfgnotif]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Configure_App_Notifications
- [md-setsound]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Set_Notification_Sound
- [md-perm]: https://wiki.macrodroid.com/wiki/index.php?title=Permissions_and_Special_Access
- [md-adb]: https://wiki.macrodroid.com/wiki/index.php?title=ADB_Hack
- [md-magic]: https://wiki.macrodroid.com/wiki/index.php?title=Magic_text

[channels]: https://developer.android.com/develop/ui/views/notifications/channels
[nm]: https://developer.android.com/reference/android/app/NotificationManager
[nc]: https://developer.android.com/reference/android/app/NotificationChannel
[zenpolicy]: https://developer.android.com/reference/android/service/notification/ZenPolicy.Builder
[nms]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/notification/NotificationManagerService.java
[shellcmd]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/notification/NotificationShellCmd.java
[shellmanifest]: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/packages/Shell/AndroidManifest.xml
[help-dnd]: https://support.google.com/android/answer/9069335
[md-trigger]: https://wiki.macrodroid.com/wiki/index.php/Trigger:_Notification
[md-dnd]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Priority_Mode_/_Do_Not_Disturb
[md-dndc]: https://wiki.macrodroid.com/wiki/index.php?title=Constraint:_Priority_Mode_/_Do_Not_Disturb
[md-vol]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Volume_Change
[md-cfgnotif]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Configure_App_Notifications
[md-setsound]: https://wiki.macrodroid.com/wiki/index.php?title=Action:_Set_Notification_Sound
[md-perm]: https://wiki.macrodroid.com/wiki/index.php?title=Permissions_and_Special_Access
[md-adb]: https://wiki.macrodroid.com/wiki/index.php?title=ADB_Hack
[md-magic]: https://wiki.macrodroid.com/wiki/index.php?title=Magic_text

AOSP sources were read at `refs/heads/main` on 2026-10-05. MacroDroid wiki pages were read in raw form on the same date.
