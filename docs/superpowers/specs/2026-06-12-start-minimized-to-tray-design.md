# Start minimized to tray — design

Date: 2026-06-12

## Goal

Add a Settings option that lets the application start with its main window
hidden in the tray instead of shown on screen. WhatsApp Web still loads in the
background so notifications and unread counts work immediately; the window
appears only when the user opens it from the tray.

## Setting

- New field `startMinimizedToTray: boolean` on `Settings`.
- Default: `false` (current behaviour — window shows on launch).

## Data layer (`src/main/settings.ts`)

- Add `startMinimizedToTray` to the `Settings` interface and
  `DEFAULT_SETTINGS`.
- Add a boolean-validation branch in `loadSettings`, mirroring
  `hardwareAccelerationEnabled`, so settings files written before this change
  load with the default `false`.
- Mirror the field in the renderer's `Settings` interface
  (`src/renderer/settingsApi.ts`).

## Launch behaviour (`src/main/index.ts`)

- The main `BrowserWindow` is currently shown by Electron's default. Create it
  with `show: false`.
- Call `mainWindow.show()` only when the app should not start minimized,
  decided by a pure helper `shouldShowOnLaunch(settings)` that returns
  `!settings.startMinimizedToTray`.
- `loadURL('https://web.whatsapp.com/')` runs regardless, so the background
  page loads whether or not the window is shown.
- Close-to-tray behaviour is unchanged; this only affects the initial launch.

## UI (`src/renderer/App.tsx`)

- Add an `<hr />` + `<h2>Startup</h2>` section below the Performance section.
- Single checkbox row "Start minimized to tray" bound via the existing
  `update({ ... })` helper.
- A short `.hint` noting the app keeps running in the tray and the window opens
  from the tray icon.

## Testing

- `tests/settings.test.ts`: add the new field to the round-trip `Settings`
  literal; assert a settings file missing `startMinimizedToTray` loads as
  `false`.
- Add a unit test for `shouldShowOnLaunch` covering both setting values.
