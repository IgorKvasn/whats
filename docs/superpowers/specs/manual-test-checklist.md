# WhatsApp Desktop — Manual Test Checklist

Run with `npm run dev` from the repo root.

## First run

- [ ] App launches; WhatsApp window opens and shows the QR code.
- [ ] Scan QR with phone → chats load.
- [ ] Tray icon appears. Tooltip reads "WhatsApp".

## Auth persistence

- [ ] Quit via tray → `Quit`. Process exits.
- [ ] Relaunch `npm run dev`. WhatsApp auto-resumes, no QR.

## Unread + tray

- [ ] Send a message from another phone. Tray tooltip updates to "WhatsApp — N unread".
- [ ] Open the chat. Tooltip returns to "WhatsApp".
- [ ] Tray icon image visibly changes between normal/unread (once distinct art is dropped in).

## Notifications

- [ ] Defaults: incoming message → OS notification titled with sender, NO body, default sound plays.
- [ ] Open Settings (tray → Settings…). Toggle "Show notifications" off → incoming message fires no notification.
- [ ] Toggle back on, toggle "Play sound" off → notification silent.
- [ ] Toggle "Include message preview" on → notification body contains first line of message.

## Window behaviour

- [ ] Click WhatsApp window close (X). Window hides. App still in tray. Notifications still arrive.
- [ ] Left-click tray → WhatsApp window reappears focused.
- [ ] Left-click tray again → window hides.
- [ ] Right-click tray → menu shows Show / Settings… / Quit.

## Disconnected state

- [ ] Put phone in airplane mode. After WhatsApp Web shows its "Phone not connected" banner, tray tooltip becomes "WhatsApp — disconnected".
- [ ] Restore phone connection. Tooltip reverts to normal or unread.

## Single-instance

- [ ] While the app is running, launch `npm run dev` again in a second terminal. The existing WhatsApp window focuses; no second process.

## Settings persistence

- [ ] Change any setting. Quit via tray. Relaunch. Setting is preserved.
