# Companion APK: mute only WhatsApp's channels via a CDM association

Date: 2026-10-06
Ticket: #106 (parent map #95; builds on #96 `docs/research/phone-mute-options.md`
on branch `research/phone-mute-options`, and #98 on `research/push-transports`)
Device under consideration: Pixel 9a, Android 16, no root, no Shizuku, free
only, sideloaded self-built APK acceptable.

Question: can a sideloaded companion APK silence **only** WhatsApp's message
and group notification sounds, and restore them, through
`NotificationListenerService.updateNotificationChannel(pkg, user, channel)` /
`getNotificationChannels(pkg, user)`, which require a CompanionDeviceManager
(CDM) association?

Sources are AOSP `frameworks/base` at `refs/heads/android16-release` and
developer.android.com. "From source" means read in AOSP code, not tested on a
device. Anything without a primary source is marked **unconfirmed**. Pixel
builds may differ from AOSP (**unconfirmed** for every from-source claim).

AOSP files cited (all under
`https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/`):

- [NMS] `services/core/java/com/android/server/notification/NotificationManagerService.java`
- [PH] `services/core/java/com/android/server/notification/PreferencesHelper.java`
- [NAH] `services/core/java/com/android/server/notification/NotificationAttentionHelper.java`
- [MS] `services/core/java/com/android/server/notification/ManagedServices.java`
- [NLS] `core/java/android/service/notification/NotificationListenerService.java`
- [CDM] `core/java/android/companion/CompanionDeviceManager.java`
- [CDMS] `services/companion/java/com/android/server/companion/CompanionDeviceManagerService.java`
- [ARP] `services/companion/java/com/android/server/companion/association/AssociationRequestsProcessor.java`
- [PU] `services/companion/java/com/android/server/companion/utils/PermissionsUtils.java`
- [DP] `services/companion/java/com/android/server/companion/association/DisassociationProcessor.java`
- [IARS] `services/companion/java/com/android/server/companion/association/InactiveAssociationsRemovalService.java`
- [CEP] `services/companion/java/com/android/server/companion/CompanionExemptionProcessor.java`
- [SHELL] `services/companion/java/com/android/server/companion/CompanionDeviceShellCommand.java`
- [PM] `core/java/com/android/internal/content/PackageMonitor.java`
- [UGM] `services/core/java/com/android/server/uri/UriGrantsManagerService.java`
- [MANIFEST] `core/res/AndroidManifest.xml`

## Verdict

**Feasible with caveats.** From source, any active, non-self-managed CDM
association of any profile (including no profile) lets an enabled
notification listener read and rewrite WhatsApp's channels. A sideloaded app
can create such an association with one user consent dialog at setup; it
survives reboots and app updates and does not need the PC in range. Setting a
channel's sound to `null` while keeping its importance silences that channel
and keeps vibration. The caveats are real but testable: restoring a sound URI
can fail a URI-permission check, WhatsApp may create new channels that start
unmuted, the change is marked user-locked, and a companion that is uninstalled
or data-cleared while muted leaves WhatsApp silent until fixed by hand. None of
this has been tried on a Pixel 9a; the spike in section 8 decides it.

## Ranked association types

| Rank | Association | Extra permission | Setup | Notes |
|---|---|---|---|---|
| 1 | Bluetooth Classic filter, no profile, PC as the device | none | PC Bluetooth discoverable once; one consent dialog | Semantically honest; PC need never be in range again |
| 2 | Wi-Fi filter (`WifiDeviceFilter`), no profile, home AP | none | AP is always visible; one consent dialog | No PC involvement; CDM Wi-Fi scan behaviour on Pixel **unconfirmed** |
| 3 | BLE filter, no profile | none | Something must advertise BLE during setup (PC via BlueZ, or any BLE gadget) | More setup than 1 for no gain |
| 4 | `adb shell cmd companiondevice associate 0 <pkg> <mac>` | adb once | No discovery, no dialog | From source the shell command creates the association directly [SHELL]; one-time, so it does not violate the no-step-after-reboot rule; test-only feel |
| 5 | `DEVICE_PROFILE_WATCH` | `REQUEST_COMPANION_PROFILE_WATCH` (normal) | Dialog plus a role grant | Grants a role the task does not need; role eligibility for a sideloaded app **unconfirmed** |
| - | Self-managed | `REQUEST_COMPANION_SELF_MANAGED` is `signature\|privileged` | - | Not available |
| - | APP_STREAMING, COMPUTER, NEARBY_DEVICE_STREAMING, VIRTUAL_DEVICE | `signature\|privileged` | - | Not available |
| - | AUTOMOTIVE_PROJECTION | `internal\|role` | - | Not available |
| - | WEARABLE_SENSING | system uid only | - | Not available |

Permission levels: [MANIFEST] (`REQUEST_COMPANION_*` declarations);
profile-to-permission mapping and the system-only set: [PU]
`enforcePermissionForRequestingProfile`, `SYSTEM_ONLY_DEVICE_PROFILES`.
A no-profile request skips the profile check entirely ("Device profile can be
null"), and only self-managed requests or requests with a device icon need
`REQUEST_COMPANION_SELF_MANAGED` ([PU] `enforcePermissionForCreatingAssociation`).

## 1. The gate: what "has an associated device" means

- `updateNotificationChannelFromPrivilegedListener`,
  `getNotificationChannelsFromPrivilegedListener` and the group variants call
  `verifyPrivilegedListener`, which throws unless `hasCompanionDevice(info)`
  (or the caller is the notification assistant) and the listener is enabled for
  that user [NMS].
- `hasCompanionDevice(info)` passes `withDeviceProfile = null`, so **any**
  association returned by `getAssociations(pkg, userId)` qualifies, regardless
  of profile [NMS `hasCompanionDevice`]. Only the global-DND path checks for
  WATCH/AUTOMOTIVE_PROJECTION specifically (`canManageGlobalZenPolicy`) [NMS].
- CDMS `getAssociations` returns `getActiveAssociationsByPackage`, i.e. not
  revoked [CDMS]. Device presence is not consulted. **The PC does not need to be
  in range** for the gate to pass (from source).
- The public javadoc agrees: "The caller must have an associated device or be
  the notification assistant in order to use this method" [NLS], and adds
  "This should only be used to reflect changes a user has made to the channel
  via the listener's user interface". That sentence is guidance, not enforced
  in code; it matters for Play review, not for a sideloaded APK.
- Companion listeners also receive `onNotificationChannelModified` (ADDED /
  UPDATED / DELETED) for other packages' channels [NMS
  `notifyNotificationChannelChanged`, NLS javadoc]. This is how the companion
  notices a new WhatsApp channel.

## 2. Creating the association without privileges

- Required manifest: `<uses-feature android:name="android.software.companion_device_setup"/>`
  ([ARP] `enforceUsesCompanionDeviceFeature`;
  [companion pairing guide](https://developer.android.com/develop/connectivity/bluetooth/companion-device-pairing)).
- Non-self-managed requests always go through the system consent UI: CDMS
  returns a `PendingIntent` via `onAssociationPending`; the association is only
  created after the user approves [ARP `processNewAssociationRequest`]. The
  prompt can be skipped only for packages on the OEM allowlist
  (`mayAssociateWithoutPrompt`) [ARP], which a sideloaded app is not on.
- So the setup is: one dialog, one tap, once. Nothing after reboot.
- Filters available: `BluetoothDeviceFilter`, `BluetoothLeDeviceFilter`,
  `WifiDeviceFilter`; `setSingleDevice(true)` narrows to one match (pairing
  guide). The CDM app does the scanning; the companion needs no location
  permission (**unconfirmed** on the Pixel build; pairing guide implies it).
- Android 16 change: discovery timeouts are now shown to the user as a dialog
  and reported to the app as `RESULT_USER_REJECTED`; the search runs longer
  than 20 s ([Android 16 behaviour changes, all apps](https://developer.android.com/about/versions/16/behavior-changes-all)).
  Irrelevant once the association exists.
- The adb shell route (`cmd companiondevice associate USER_ID PACKAGE
  MAC_ADDRESS [DEVICE_PROFILE] [SELF_MANAGED]`) calls `createAssociation`
  directly with no UI and no discovery [SHELL]. That it is callable from the
  adb shell uid on a user build is **unconfirmed** (no explicit caller check in
  [SHELL] or CDMS `handleShellCommand`; the Binder shell-command transport may
  restrict it).
- `requestNotificationAccess(ComponentName)` is a CDM-only shortcut to the
  listener-access dialog; for sideloaded apps CDMS first requires "restricted
  settings" to be allowed [CDM javadoc, CDMS `requestNotificationAccess`].
  `adb shell cmd notification allow_listener` (from #96) avoids both.

## 3. Persistence

- **Reboot**: associations are stored on disk by CDMS (`AssociationDiskStore`)
  and nothing in the boot path removes them (from source). Notification
  listener access is a secure setting and enabled listeners are re-bound by the
  system at boot [MS].
- **App update**: [PM] turns `ACTION_PACKAGE_REMOVED` with `EXTRA_REPLACING`
  into `onPackageUpdateStarted`, not `onPackageRemoved`, so CDMS does not
  disassociate on update [CDMS `mPackageMonitor`, PM]. Associations survive
  updates (from source). The pairing guide confirms revocation on uninstall or
  `disassociate()`.
- **Uninstall or Clear data**: CDMS disassociates on `onPackageRemoved` and
  `onPackageDataCleared` [CDMS `onPackageRemoveOrDataClearedInternal`].
- **Idle expiry**: only **self-managed** associations are removed after 90 days
  without connection [DP `removeIdleSelfManagedAssociations`, IARS]. A
  Bluetooth/Wi-Fi association does not expire.
- **User revocation**: the user can remove the association from Settings
  (location of that UI on Pixel **unconfirmed**); the companion should check
  `getMyAssociations()` on start and alert if empty.
- **Foot-gun, battery exemption**: on every package-modified event for an
  associated package (which includes completing an app update, [PM]
  `onPackageModified` after replace), CDMS calls
  `exemptPackage(userId, pkg, hasPresentDevices = false)`, and
  `exemptPackageAsSystem` then calls
  `PowerExemptionManager.removeFromPermanentAllowList(pkg)` [CDMS
  `onPackageModifiedInternal`, CEP]. From source this can drop a
  user-granted "unrestricted battery" exemption after each companion update.
  The companion must re-check `isIgnoringBatteryOptimizations()` on start and
  re-request it (**unconfirmed** whether the user allowlist entry is the one
  removed; spike item).
- CDM associations also put the companion's uid on AM/ATM companion lists
  [CEP `updateAtm`], and with `REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND`
  the app may start an FGS from the background
  ([FGS background-start exemptions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)).
  Useful for the heartbeat transport.

## 4. What the listener may change on WhatsApp's channels

- `updateNotificationChannelInt(..., fromListener = true)` calls
  `PreferencesHelper.updateNotificationChannel(pkg, uid, channel, fromUser =
  true, ...)` [NMS], which **replaces the whole stored channel** with the
  caller's object (`r.channels.put(updatedChannel.getId(), updatedChannel)`)
  [PH]. Every field the caller sets is accepted: importance, sound + audio
  attributes, vibration, lights, badge, lockscreen visibility, bypass DND,
  bubbles. Exception: importance of a channel locked by a critical device
  function is preserved [PH].
- So always start from the channel returned by `getNotificationChannels` and
  change only the sound. A stale copy overwrites concurrent changes.
- Fields that differ are marked user-locked (`lockFieldsForUpdateLocked`:
  `USER_LOCKED_SOUND` etc.) [PH]. Consequence: after mute and restore the
  channel stays flagged as user-modified. Apps cannot change sound on an
  existing channel anyway (the `fromTargetApp` path only touches name,
  description, blockable, group, importance downgrade when nothing is locked,
  DND bypass) [PH `createNotificationChannel`], so the practical cost is that
  WhatsApp can no longer downgrade that channel's importance.
- Setting `IMPORTANCE_NONE` cancels the channel's notifications and notifies
  the owner [NMS `updateNotificationChannelInt`]. Do not use it.
- **Sound vs. vibration** [NAH `buzzBeepBlinkLocked`]: sound and vibration
  are only considered when importance is at least `IMPORTANCE_DEFAULT`
  (`aboveThreshold`). `hasValidSound` is `soundUri != null && !EMPTY`;
  vibration is evaluated separately. Hence:
  - `setSound(null, attrs)` at unchanged importance: **no sound, vibration
    unchanged** (from source).
  - Lowering importance to `LOW`: no sound **and** no vibration, and no
    heads-up. Not acceptable.
- **Calls stay untouched** as long as the call channel(s) are skipped. Which
  WhatsApp channel ids carry messages, groups and calls, and whether WhatsApp's
  ringtone is a channel sound or played by WhatsApp itself, is **unconfirmed**
  (no primary source; the spike dumps the channel list).
- **Restoring the sound can fail** [NMS `verifyPrivilegedListenerUriPermission`,
  UGM `checkGrantUriPermissionUnlocked`]: if the new sound differs from the
  stored one, NMS checks that the *listener* could grant read access to that
  URI. Muting (`null`) is never checked. Restoring:
  - non-`content://` URIs (e.g. `android.resource://com.whatsapp/...`) pass
    (`isContentUriWithAccessModeFlags` returns early) (from source);
  - `content://` URIs from an exported provider without a read permission pass;
  - `content://media/...` and other protected URIs may throw
    `SecurityException`. Holding `READ_MEDIA_AUDIO` may satisfy it
    (**unconfirmed**).
  What URI WhatsApp's default and custom tones use is **unconfirmed**. The spike
  must restore every channel it muted and confirm the sound returns.

## 5. WhatsApp recreating or versioning channels

- No primary source documents WhatsApp's channel ids or versioning
  (**unconfirmed**). The WhatsApp help centre says per-chat custom
  notifications create their own Android notification category (cited in #96).
- AOSP facts that bound the behaviour [PH]:
  - An app cannot change an existing channel's sound, so an in-app tone change
    must create a **new channel id** (or the change has no effect). A new
    channel starts with the app's settings, i.e. **unmuted**.
  - Deleting and recreating the **same** id undeletes the old record and keeps
    its stored settings, including a listener-set `null` sound.
  - Conversation channels (`parentId` + `conversationId`) inherit parent
    changes only when the update is `fromUser` and the
    `PROPAGATE_CHANNEL_UPDATES_TO_CONVERSATIONS` flag is on, and only for
    fields not locked on the child [PH `updateChildrenConversationChannels`].
    Status of that flag on Pixel 16 **unconfirmed**. The companion must mute
    conversation channels explicitly.
- Mitigation: while muted, handle `onNotificationChannelModified(ADDED |
  UPDATED)` for `com.whatsapp` and mute any new message channel immediately.
  A race remains: if WhatsApp creates the channel and posts on it in the same
  breath, the first notification can still sound (**unconfirmed**, spike item).
- Keep an on-disk record of every channel the companion muted and its original
  sound URI + audio attributes, so restore does not depend on process memory.

## 6. Failure behaviour and the `setAlarmClock` timeout

- **Process death while muted**: the change lives in NMS, not in the
  companion, so WhatsApp stays muted until something restores it.
- Enabled listeners are bound with `BIND_AUTO_CREATE | BIND_FOREGROUND_SERVICE
  | BIND_NOT_PERCEPTIBLE` [NMS `NotificationListeners.getBindFlags`], so the
  system recreates a killed listener process, and rebinds on binding death
  after 10 s (`ON_BINDING_DIED_REBIND_DELAY_MS`) [MS] (from source).
  `BIND_NOT_PERCEPTIBLE` was added because listeners caused memory pressure, so
  the listener process is killable under pressure (comment in [NMS]).
- **Timeout**: `setAlarmClock` fires in Doze and needs no exact-alarm grant
  (#96 section 1.5). The alarm `PendingIntent` targets a receiver in the
  companion. `updateNotificationChannel` is an instance method on the connected
  listener, so the receiver must reach the live listener; if it is not
  connected, call `NotificationListenerService.requestRebind(component)` and
  restore in `onListenerConnected`. Re-arm the alarm on every heartbeat.
- **Reboot**: alarms do not survive reboot (AlarmManager behaviour), and
  whether a listener-made channel change is written to the policy file before
  shutdown is **unconfirmed** (`PreferencesHelper.updateConfig` only requests a
  ranking sort [PH]). Rule: on every `onListenerConnected`, restore all muted
  channels unless a fresh heartbeat says *Phone muted*. That covers reboot,
  process restart and rebind.
- **Force stop**: removes the app's alarms and puts it in stopped state;
  whether the listener is rebound before the user opens the app is
  **unconfirmed**. Treat force stop as "may stay silent".
- **Uninstall or Clear data while muted**: the association disappears and the
  channels keep their `null` sound, so WhatsApp stays silent until the user
  fixes it in Settings or WhatsApp creates new channels. Fails toward silence;
  this is the residual risk of this option. The companion UI should unmute
  before any "disable" action, and the release notes must say "unmute before
  uninstalling".

## 7. Android 16 specifics

- Behaviour-change pages list only the CDM discovery-timeout UI change (all
  apps) and `removeBond()` (target 36); nothing about channels, listeners or
  alarms ([all apps](https://developer.android.com/about/versions/16/behavior-changes-all),
  [target 36](https://developer.android.com/about/versions/16/behavior-changes-16)).
- The NMS / PH / CDMS code paths above are from `android16-release`; the gate
  is unchanged in shape from earlier releases (from source).
- Sideloaded listener access is subject to "restricted settings" (CDD 16,
  #96 section 4); use `adb shell cmd notification allow_listener`.

## 8. On-device spike: what must be verified

1. Create a no-profile Bluetooth (or Wi-Fi) association from a sideloaded debug
   APK; confirm `getMyAssociations()` is non-empty after a reboot and after an
   `adb install -r` update, with the PC out of range.
2. With listener access granted via adb, call `getNotificationChannels("com.whatsapp", user)`
   and dump id, name, importance, sound URI, audio usage, vibration, parent and
   conversation ids. Identify message, group, per-chat and call channels.
3. Mute message and group channels with `setSound(null, attrs)`; confirm a
   WhatsApp message vibrates but is silent, a WhatsApp call still rings, and
   another app's notification still sounds.
4. Restore the original sound URI for every muted channel; confirm no
   `SecurityException` and that the tone is audible again. Repeat with a
   per-chat custom tone from the media store.
5. Change the tone inside WhatsApp while muted and while unmuted; observe
   whether a new channel id appears, whether `onNotificationChannelModified`
   arrives, and whether the first message on the new channel sounds.
6. Kill the companion (`am kill`, low-memory) while muted; confirm the listener
   is rebound and the `setAlarmClock` timeout restores sound under Doze
   (`dumpsys deviceidle force-idle`).
7. Reboot while muted; confirm sound is restored on `onListenerConnected`.
8. Update the APK; check whether the battery-optimisation exemption was
   dropped (`dumpsys deviceidle whitelist`).
9. Run for at least a week (shared with the #98 FCM deprioritisation test).

## Open questions (unconfirmed)

- WhatsApp channel ids, versioning, call-ringtone mechanism, tone URIs.
- Whether `adb shell cmd companiondevice associate` works from the shell uid on
  a user build.
- Whether the policy file persists a listener change across reboot.
- Whether CDMS removing the power-save allowlist entry affects a user-granted
  exemption.
- Where Pixel's Settings lets the user remove an association.
