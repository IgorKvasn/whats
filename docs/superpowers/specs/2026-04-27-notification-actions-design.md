# Notification Action Buttons

## Summary

Replace Electron's `Notification` API with `notify-send` for desktop notifications.
Add "Open" and "Dismiss" action buttons. Clicking the notification body dismisses it
(no window activation). Only the "Open" button opens/focuses the main window.

## Motivation

Electron's `Notification` class does not support action buttons on Linux. The current
behavior (clicking the notification body opens the main window) offers no way to
dismiss without interacting with the app. Using `notify-send --action` provides native
action button support on freedesktop-compliant desktops (GNOME, KDE, etc.).

## Design

### `showNotification` in `src/main/notifications.ts`

Replace the Electron `Notification` constructor with a `notify-send` child process:

```
notify-send --app-name WhatsApp \
  --icon <iconPath> \
  --wait \
  -A "open=Open" \
  -A "dismiss=Dismiss" \
  "<sender>" "<body>"
```

- `--wait` keeps the process alive until user interaction or timeout.
- Stdout is collected. If it matches `"open"` (trimmed), call `onOpen`. Otherwise
  do nothing (covers: body click, "Dismiss" click, timeout/expiry).
- The existing `isOpenActionOutput` helper already handles this stdout parsing.
- Sound playback via `paplay` remains unchanged and independent.

Signature change:

```ts
// Before
showNotification(sender, body, withSound, onClickShowWindow)

// After
showNotification(sender, body, withSound, iconPath, onOpen)
```

New parameter: `iconPath` (string) — absolute path to the app icon for the
notification. Passed as `--icon` to `notify-send`.

The `Notification` import from Electron is removed.

### Callers in `src/main/index.ts`

All call sites already pass `showMainWindow` as the callback. Add `iconPath`:

```ts
const notificationIconPath = path.join(iconDir, 'icon.png');
```

Pass `notificationIconPath` to every `showNotification` call:

- `whatsapp:notify` handler (message notifications)
- `settings:preview-notification` handler
- `settings:preview-sound` handler
- `handleFailure` (update check failure notification)

All four use the same `showNotification` function, so behavior is consistent.

### Notification behavior matrix

| User action          | Result                  |
|----------------------|-------------------------|
| Click notification body | Dismiss (do nothing) |
| Click "Open" button  | Show/focus main window  |
| Click "Dismiss" button | Dismiss (do nothing)  |
| Notification times out | Nothing               |

### Test changes

- Remove the Electron `Notification` mock from `tests/notifications.test.ts`.
- Add tests for `showNotification` that mock `execFile`:
  - Verify `notify-send` is called with correct arguments (app-name, icon, wait,
    actions, title, body).
  - Verify `onOpen` is called when stdout contains `"open"`.
  - Verify `onOpen` is NOT called for other stdout values (empty, "dismiss").
  - Verify `paplay` is called when `withSound` is true and not called when false.
- Existing `isOpenActionOutput` tests remain unchanged.

## Out of scope

- Cross-platform support (macOS/Windows action buttons).
- Notification grouping or stacking.
- Custom notification sounds per contact.
