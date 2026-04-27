# Electron Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Tauri WhatsApp Web desktop wrapper to Electron with full feature parity, keeping the React frontend and porting all Rust backend logic to TypeScript.

**Architecture:** Electron main process (TypeScript) handles settings persistence, system tray, notifications, update checking, and window management. Two preload scripts bridge IPC: one for dialog windows (settings/about/update) and one for the WhatsApp Web webview (notification interception, title watching, disconnection detection, link interception). The React renderer is largely preserved with only the IPC layer changed.

**Tech Stack:** Electron, electron-vite, electron-builder, React 19, TypeScript, Vitest, semver

---

## File Structure

### Created

| Path | Responsibility |
|------|---------------|
| `electron.vite.config.ts` | Build config for main + preload + renderer targets |
| `electron-builder.yml` | Packaging config for .deb |
| `src/main/index.ts` | App entry: single instance, window creation, IPC registration, tray/updater init |
| `src/main/settings.ts` | Settings load/save with atomic writes |
| `src/main/updater.ts` | GitHub release polling, semver comparison, throttle, failure tracking |
| `src/main/tray.ts` | System tray icon state machine + menu |
| `src/main/notifications.ts` | Electron Notification + paplay sound + dedup logic |
| `src/main/windows.ts` | Window management (main toggle, dialog creation) |
| `src/main/buildInfo.ts` | Version + build timestamp |
| `src/main/titleParse.ts` | Pure function: unread count from title string |
| `src/preload/index.ts` | contextBridge for dialog windows |
| `src/preload/whatsapp.ts` | WhatsApp Web injection preload |
| `src/preload/inject.ts` | Shared pure functions (notification shim, unread delta, fallback payload) |
| `src/renderer/main.tsx` | React entry point |
| `src/renderer/App.tsx` | Root component with view routing |
| `src/renderer/styles.css` | Styles |
| `src/renderer/settingsApi.ts` | Settings IPC via window.electronAPI |
| `src/renderer/buildInfoApi.ts` | Build info IPC via window.electronAPI |
| `src/renderer/updateApi.ts` | Update IPC via window.electronAPI |
| `src/renderer/electron.d.ts` | TypeScript declarations for window.electronAPI |
| `src/renderer/index.html` | HTML entry for renderer |
| `resources/icons/` | Copied from src-tauri/icons/ |
| `tests/titleParse.test.ts` | Title parsing unit tests |
| `tests/settings.test.ts` | Settings persistence unit tests |
| `tests/updater.test.ts` | Updater logic unit tests |
| `tests/tray.test.ts` | Tray state derivation unit tests |
| `tests/notifications.test.ts` | Notification dedup + URL safety tests |
| `tests/buildInfo.test.ts` | Build info formatting tests |
| `tests/inject.test.ts` | Injection utility function tests |
| `tests/settingsView.test.tsx` | Settings React component tests |
| `tests/updateView.test.tsx` | Update React component tests |
| `tests/bundleConfig.test.ts` | electron-builder config validation tests |

### Deleted

| Path | Reason |
|------|--------|
| `src-tauri/` (entire directory) | Replaced by Electron main process |
| `vite.config.ts` | Replaced by `electron.vite.config.ts` |
| `dist/` | electron-vite uses `out/` |
| `run.sh` | Replaced by `electron-vite dev` |
| `src/main.tsx` | Moved to `src/renderer/main.tsx` |
| `src/App.tsx` | Moved to `src/renderer/App.tsx` |
| `src/styles.css` | Moved to `src/renderer/styles.css` |
| `src/settingsApi.ts` | Rewritten at `src/renderer/settingsApi.ts` |
| `src/buildInfoApi.ts` | Rewritten at `src/renderer/buildInfoApi.ts` |
| `src/updateApi.ts` | Rewritten at `src/renderer/updateApi.ts` |
| `src/vite-env.d.ts` | No longer needed |
| `src/assets/` | Not used |
| `tests/inject.test.js` | Replaced by `tests/inject.test.ts` |
| `tests/settingsView.test.tsx` | Rewritten |
| `tests/updateView.test.tsx` | Rewritten |
| `tests/bundle-config.test.js` | Replaced by `tests/bundleConfig.test.ts` |

### Modified

| Path | Changes |
|------|---------|
| `package.json` | New deps, new scripts, remove Tauri deps |
| `tsconfig.json` | Updated include paths, remove Tauri references |
| `tsconfig.node.json` | Updated for main + preload targets |
| `scripts/release.sh` | Remove Cargo/Tauri version bumping, update build commands and deb path |
| `scripts/build-deb.sh` | Remove Rust toolchain, update build commands |

---

## Task 1: Project Scaffolding — Delete Tauri, Set Up Electron

**Files:**
- Delete: `src-tauri/` (entire directory), `vite.config.ts`, `run.sh`, `dist/`
- Delete: `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/settingsApi.ts`, `src/buildInfoApi.ts`, `src/updateApi.ts`, `src/vite-env.d.ts`, `src/assets/`
- Delete: `tests/inject.test.js`, `tests/settingsView.test.tsx`, `tests/updateView.test.tsx`, `tests/bundle-config.test.js`
- Create: `electron.vite.config.ts`, `electron-builder.yml`, `src/renderer/index.html`
- Modify: `package.json`, `tsconfig.json`, `tsconfig.node.json`
- Create: `resources/icons/` (copy from src-tauri/icons/)

- [ ] **Step 1: Copy icon assets out before deletion**

```bash
mkdir -p resources/icons
cp src-tauri/icons/32x32.png resources/icons/
cp src-tauri/icons/64x64.png resources/icons/
cp src-tauri/icons/128x128.png resources/icons/
cp src-tauri/icons/128x128@2x.png resources/icons/
cp src-tauri/icons/icon.ico resources/icons/
cp src-tauri/icons/icon.icns resources/icons/
cp src-tauri/icons/tray-normal.png resources/icons/
cp src-tauri/icons/tray-unread.png resources/icons/
cp src-tauri/icons/tray-disconnected.png resources/icons/
```

- [ ] **Step 2: Delete Tauri directory and old source files**

```bash
rm -rf src-tauri/ dist/
rm -f vite.config.ts run.sh
rm -f src/main.tsx src/App.tsx src/styles.css src/settingsApi.ts src/buildInfoApi.ts src/updateApi.ts src/vite-env.d.ts
rm -rf src/assets/
rm -f tests/inject.test.js tests/settingsView.test.tsx tests/updateView.test.tsx tests/bundle-config.test.js
```

- [ ] **Step 3: Rewrite package.json**

```json
{
  "name": "whats",
  "private": true,
  "version": "0.5.0",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "postinstall": "electron-builder install-app-deps",
    "package": "electron-vite build && electron-builder --linux deb",
    "test": "vitest run",
    "prepare": "husky"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-markdown": "^10.1.0",
    "semver": "^7.7.2"
  },
  "devDependencies": {
    "@commitlint/cli": "^20.5.2",
    "@commitlint/config-conventional": "^20.5.0",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@types/semver": "^7.7.0",
    "@vitejs/plugin-react": "^4.6.0",
    "@vitest/ui": "^4.1.5",
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^3.1.0",
    "husky": "^9.1.7",
    "jsdom": "^26.1.0",
    "typescript": "~5.8.3",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 4: Create electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: 'src/main/index.ts',
      },
    },
    define: {
      __BUILD_TIMESTAMP__: JSON.stringify(
        process.env.SOURCE_DATE_EPOCH
          ? new Date(parseInt(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
          : new Date().toISOString()
      ),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts',
          whatsapp: 'src/preload/whatsapp.ts',
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
    test: {
      environment: 'jsdom',
      include: ['../../tests/**/*.test.{ts,tsx}'],
    },
  },
});
```

- [ ] **Step 5: Create electron-builder.yml**

```yaml
appId: app.whats.desktop
productName: whats
directories:
  output: dist
linux:
  target: deb
  category: Network;InstantMessaging
  icon: resources/icons
  desktop:
    StartupWMClass: whats
deb:
  depends:
    - libnotify-bin
    - pulseaudio-utils
extraResources:
  - from: resources/icons
    to: icons
```

- [ ] **Step 6: Create src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WhatsApp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Update tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/renderer"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 8: Update tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/main", "src/preload", "electron.vite.config.ts"]
}
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: No errors, node_modules created.

- [ ] **Step 10: Commit scaffolding**

```bash
git add -A
git commit -m "refactor: replace tauri scaffolding with electron-vite project structure"
```

---

## Task 2: Title Parse Module (TDD)

**Files:**
- Create: `src/main/titleParse.ts`
- Test: `tests/titleParse.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/titleParse.test.ts
import { describe, it, expect } from 'vitest';
import { parseUnread } from '../src/main/titleParse';

describe('parseUnread', () => {
  it('returns 0 with no parens', () => {
    expect(parseUnread('WhatsApp')).toBe(0);
  });

  it('parses simple count', () => {
    expect(parseUnread('(3) WhatsApp')).toBe(3);
  });

  it('returns 0 for zero in parens', () => {
    expect(parseUnread('(0) WhatsApp')).toBe(0);
  });

  it('parses large count', () => {
    expect(parseUnread('(120) WhatsApp')).toBe(120);
  });

  it('returns 0 for empty string', () => {
    expect(parseUnread('')).toBe(0);
  });

  it('returns 0 for garbage', () => {
    expect(parseUnread('hello world')).toBe(0);
  });

  it('returns 0 for non-numeric parens', () => {
    expect(parseUnread('(abc) WhatsApp')).toBe(0);
  });

  it('handles leading whitespace', () => {
    expect(parseUnread('  (5) WhatsApp')).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/titleParse.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/titleParse.ts
export function parseUnread(title: string): number {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const rest = trimmed.slice(1);
  const match = rest.match(/^(\d+)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/titleParse.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/titleParse.ts tests/titleParse.test.ts
git commit -m "feat: add titleParse module with unread count extraction"
```

---

## Task 3: Build Info Module (TDD)

**Files:**
- Create: `src/main/buildInfo.ts`
- Test: `tests/buildInfo.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/buildInfo.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimestampText } from '../src/main/buildInfo';

describe('buildTimestampText', () => {
  it('keeps explicit timezone offset', () => {
    const formatted = buildTimestampText('2026-04-25 14:23:11 +02:00');
    expect(formatted).toContain('+02:00');
    expect(formatted.startsWith('2026-04-25 14:23:11')).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(buildTimestampText(' 2026-04-25 14:23:11 +02:00 \n')).toBe(
      '2026-04-25 14:23:11 +02:00',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/buildInfo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/buildInfo.ts
declare const __BUILD_TIMESTAMP__: string;

export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export function buildTimestampText(timestamp: string): string {
  return timestamp.trim();
}

export function currentBuildInfo(version: string): BuildInfo {
  return {
    version,
    buildTimestamp: buildTimestampText(
      typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : '',
    ),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/buildInfo.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildInfo.ts tests/buildInfo.test.ts
git commit -m "feat: add buildInfo module with version and timestamp"
```

---

## Task 4: Tray State Module (TDD)

**Files:**
- Create: `src/main/tray.ts`
- Test: `tests/tray.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tray.test.ts
import { describe, it, expect } from 'vitest';
import { deriveTrayState, TrayState } from '../src/main/tray';

describe('deriveTrayState', () => {
  it('returns Normal when no unread and not disconnected', () => {
    expect(deriveTrayState(0, false)).toBe(TrayState.Normal);
  });

  it('returns Unread when unread count > 0 and not disconnected', () => {
    expect(deriveTrayState(1, false)).toBe(TrayState.Unread);
    expect(deriveTrayState(42, false)).toBe(TrayState.Unread);
  });

  it('returns Disconnected regardless of unread count', () => {
    expect(deriveTrayState(0, true)).toBe(TrayState.Disconnected);
    expect(deriveTrayState(5, true)).toBe(TrayState.Disconnected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tray.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/tray.ts
import { app, Menu, Tray, nativeImage, BrowserWindow } from 'electron';
import path from 'node:path';

export enum TrayState {
  Normal = 'normal',
  Unread = 'unread',
  Disconnected = 'disconnected',
}

export function deriveTrayState(unread: number, disconnected: boolean): TrayState {
  if (disconnected) return TrayState.Disconnected;
  if (unread > 0) return TrayState.Unread;
  return TrayState.Normal;
}

export interface TrayHandle {
  tray: Tray;
  state: TrayState;
  unread: number;
  disconnected: boolean;
}

export function createTray(
  iconDir: string,
  callbacks: {
    onShow: () => void;
    onSettings: () => void;
    onAbout: () => void;
    onDevTools: () => void;
    onQuit: () => void;
    onToggle: () => void;
  },
): TrayHandle {
  const iconPath = path.join(iconDir, 'tray-normal.png');
  const tray = new Tray(iconPath);
  tray.setToolTip('WhatsApp');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show WhatsApp', click: callbacks.onShow },
    { label: 'Settings…', click: callbacks.onSettings },
    { label: 'About…', click: callbacks.onAbout },
    { label: 'Open DevTools', click: callbacks.onDevTools },
    { type: 'separator' },
    { label: 'Quit', click: callbacks.onQuit },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', callbacks.onToggle);

  return { tray, state: TrayState.Normal, unread: 0, disconnected: false };
}

export function updateTray(
  handle: TrayHandle,
  iconDir: string,
  unreadOpt?: number,
  disconnectedOpt?: boolean,
): void {
  if (unreadOpt !== undefined) handle.unread = unreadOpt;
  if (disconnectedOpt !== undefined) handle.disconnected = disconnectedOpt;

  const newState = deriveTrayState(handle.unread, handle.disconnected);

  let tooltip: string;
  switch (newState) {
    case TrayState.Normal:
      tooltip = 'WhatsApp';
      break;
    case TrayState.Unread:
      tooltip = `WhatsApp — ${handle.unread} unread`;
      break;
    case TrayState.Disconnected:
      tooltip = 'WhatsApp — disconnected';
      break;
  }
  handle.tray.setToolTip(tooltip);

  if (handle.state !== newState) {
    const iconFile =
      newState === TrayState.Normal
        ? 'tray-normal.png'
        : newState === TrayState.Unread
          ? 'tray-unread.png'
          : 'tray-disconnected.png';
    handle.tray.setImage(path.join(iconDir, iconFile));
    handle.state = newState;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tray.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/tray.ts tests/tray.test.ts
git commit -m "feat: add tray module with state derivation and system tray management"
```

---

## Task 5: Settings Module (TDD)

**Files:**
- Create: `src/main/settings.ts`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/settings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../src/main/settings';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'whats-settings-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('settings', () => {
  it('returns defaults when file is missing', () => {
    const path = join(testDir, 'settings.json');
    const s = loadSettings(path);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings through save and load', () => {
    const path = join(testDir, 'settings.json');
    const custom: Settings = {
      notificationsEnabled: false,
      soundEnabled: false,
      includePreview: true,
      autoUpdateCheckEnabled: true,
      updateState: {
        lastCheckedAt: null,
        skippedVersion: null,
        consecutiveFailures: 0,
      },
    };
    saveSettings(path, custom);
    const loaded = loadSettings(path);
    expect(loaded).toEqual(custom);
  });

  it('returns defaults on corrupt JSON', () => {
    const path = join(testDir, 'settings.json');
    writeFileSync(path, '{not valid json');
    const s = loadSettings(path);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('leaves no .tmp file after successful save', () => {
    const path = join(testDir, 'settings.json');
    saveSettings(path, DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path + '.tmp')).toBe(false);
  });

  it('creates parent directories on save', () => {
    const path = join(testDir, 'nested', 'sub', 'settings.json');
    saveSettings(path, DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(true);
  });

  it('defaults have auto-update enabled', () => {
    expect(DEFAULT_SETTINGS.autoUpdateCheckEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.updateState.lastCheckedAt).toBeNull();
    expect(DEFAULT_SETTINGS.updateState.skippedVersion).toBeNull();
    expect(DEFAULT_SETTINGS.updateState.consecutiveFailures).toBe(0);
  });

  it('loads legacy settings with missing fields filled by defaults', () => {
    const path = join(testDir, 'settings.json');
    writeFileSync(
      path,
      JSON.stringify({
        notificationsEnabled: true,
        soundEnabled: false,
        includePreview: true,
      }),
    );
    const s = loadSettings(path);
    expect(s.notificationsEnabled).toBe(true);
    expect(s.soundEnabled).toBe(false);
    expect(s.includePreview).toBe(true);
    expect(s.autoUpdateCheckEnabled).toBe(true);
    expect(s.updateState.consecutiveFailures).toBe(0);
  });

  it('round-trips settings with update state', () => {
    const path = join(testDir, 'settings.json');
    const s: Settings = {
      notificationsEnabled: true,
      soundEnabled: true,
      includePreview: false,
      autoUpdateCheckEnabled: false,
      updateState: {
        lastCheckedAt: 1_700_000_000,
        skippedVersion: 'v0.2.0',
        consecutiveFailures: 2,
      },
    };
    saveSettings(path, s);
    const loaded = loadSettings(path);
    expect(loaded).toEqual(s);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/settings.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UpdateState {
  lastCheckedAt: number | null;
  skippedVersion: string | null;
  consecutiveFailures: number;
}

export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: UpdateState;
}

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  soundEnabled: true,
  includePreview: false,
  autoUpdateCheckEnabled: true,
  updateState: {
    lastCheckedAt: null,
    skippedVersion: null,
    consecutiveFailures: 0,
  },
};

export function loadSettings(path: string): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
    }
    console.error('settings: read failed, using defaults:', err);
    return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('settings: corrupt file, using defaults:', err);
    return { ...DEFAULT_SETTINGS, updateState: { ...DEFAULT_SETTINGS.updateState } };
  }

  const obj = parsed as Record<string, unknown>;
  const updateStateRaw = (obj.updateState as Record<string, unknown>) ?? {};

  return {
    notificationsEnabled:
      typeof obj.notificationsEnabled === 'boolean'
        ? obj.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    includePreview:
      typeof obj.includePreview === 'boolean'
        ? obj.includePreview
        : DEFAULT_SETTINGS.includePreview,
    autoUpdateCheckEnabled:
      typeof obj.autoUpdateCheckEnabled === 'boolean'
        ? obj.autoUpdateCheckEnabled
        : DEFAULT_SETTINGS.autoUpdateCheckEnabled,
    updateState: {
      lastCheckedAt:
        typeof updateStateRaw.lastCheckedAt === 'number'
          ? updateStateRaw.lastCheckedAt
          : DEFAULT_SETTINGS.updateState.lastCheckedAt,
      skippedVersion:
        typeof updateStateRaw.skippedVersion === 'string'
          ? updateStateRaw.skippedVersion
          : DEFAULT_SETTINGS.updateState.skippedVersion,
      consecutiveFailures:
        typeof updateStateRaw.consecutiveFailures === 'number'
          ? updateStateRaw.consecutiveFailures
          : DEFAULT_SETTINGS.updateState.consecutiveFailures,
    },
  };
}

export function saveSettings(path: string, settings: Settings): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = path + '.tmp';
  const json = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(tmp, json, 'utf-8');
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.ts tests/settings.test.ts
git commit -m "feat: add settings module with JSON persistence and atomic writes"
```

---

## Task 6: Notifications Module (TDD)

**Files:**
- Create: `src/main/notifications.ts`
- Test: `tests/notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/notifications.test.ts
import { describe, it, expect } from 'vitest';
import { shouldDispatch, isSafeExternalUrl } from '../src/main/notifications';

describe('shouldDispatch', () => {
  it('dispatches on first call (no previous notification)', () => {
    expect(shouldDispatch(null, Date.now(), 'Alice', 'hi', 1500)).toBe(true);
  });

  it('skips same payload within dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(false);
  });

  it('dispatches same payload after dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 2000;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(true);
  });

  it('dispatches different payload within dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Bob', 'hello', 1500)).toBe(true);
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts web and contact schemes', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('HTTP://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeExternalUrl('tel:+1234')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('ssh://host')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });
});

describe('isOpenActionOutput', () => {
  // Imported via the module for completeness
  it('only "open" (trimmed) activates window', async () => {
    const { isOpenActionOutput } = await import('../src/main/notifications');
    expect(isOpenActionOutput('open')).toBe(true);
    expect(isOpenActionOutput(' open \n')).toBe(true);
    expect(isOpenActionOutput('default')).toBe(false);
    expect(isOpenActionOutput('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notifications.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/notifications.ts
import { Notification, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';
const DEDUP_WINDOW_MS = 1500;

export interface LastNotification {
  time: number;
  sender: string;
  body: string;
}

export function shouldDispatch(
  last: LastNotification | null,
  now: number,
  sender: string,
  body: string,
  windowMs: number,
): boolean {
  if (!last) return true;
  const samePayload = last.sender === sender && last.body === body;
  return !samePayload || now - last.time >= windowMs;
}

export function isSafeExternalUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const colonIdx = lower.indexOf(':');
  if (colonIdx < 1) return false;
  const scheme = lower.slice(0, colonIdx);
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
}

export function isOpenActionOutput(line: string): boolean {
  return line.trim() === 'open';
}

export function showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  onClickShowWindow: () => void,
): void {
  const notification = new Notification({
    title: sender,
    body,
  });
  notification.on('click', onClickShowWindow);
  notification.show();

  if (withSound) {
    execFile('paplay', [SOUND_FILE], (err) => {
      if (err) console.error('notify: paplay failed:', err);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifications.test.ts`
Expected: 7 tests PASS (some tests may need vitest mock of electron — if so, add `vi.mock('electron', ...)` at top)

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications.ts tests/notifications.test.ts
git commit -m "feat: add notifications module with dedup logic and URL safety check"
```

---

## Task 7: Updater Module (TDD)

**Files:**
- Create: `src/main/updater.ts`
- Test: `tests/updater.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/updater.test.ts
import { describe, it, expect } from 'vitest';
import {
  decideUpdate,
  shouldRunCheck,
  bodyExcerpt,
  buildUpdateInfo,
  THROTTLE_SECONDS,
} from '../src/main/updater';

describe('decideUpdate', () => {
  it('returns true for newer release', () => {
    expect(decideUpdate('0.1.0', 'v0.2.0', null)).toBe(true);
  });

  it('returns false for equal versions', () => {
    expect(decideUpdate('0.2.0', 'v0.2.0', null)).toBe(false);
    expect(decideUpdate('0.2.0', '0.2.0', null)).toBe(false);
  });

  it('returns false for older release', () => {
    expect(decideUpdate('0.3.0', 'v0.2.0', null)).toBe(false);
  });

  it('compares numerically not lexically', () => {
    expect(decideUpdate('0.2.0', 'v0.10.0', null)).toBe(true);
  });

  it('returns false when latest matches skipped version', () => {
    expect(decideUpdate('0.1.0', 'v0.2.0', 'v0.2.0')).toBe(false);
  });

  it('does not suppress when skipped is older than latest', () => {
    expect(decideUpdate('0.1.0', 'v0.2.0', 'v0.1.5')).toBe(true);
  });

  it('handles garbage versions gracefully', () => {
    expect(decideUpdate('not-a-version', 'v0.2.0', null)).toBe(false);
    expect(decideUpdate('0.1.0', 'not-a-version', null)).toBe(false);
    expect(decideUpdate('', '', null)).toBe(false);
  });
});

describe('buildUpdateInfo', () => {
  const release = {
    tag_name: 'v0.2.0',
    name: 'Release Title',
    published_at: '2026-04-25T12:00:00Z',
    body: 'Notes',
    html_url: 'https://example.com/r',
  };

  it('populates all fields', () => {
    const info = buildUpdateInfo(release, '0.1.0');
    expect(info.currentVersion).toBe('0.1.0');
    expect(info.latestVersion).toBe('v0.2.0');
    expect(info.releaseName).toBe('Release Title');
    expect(info.releasedAt).toBe('2026-04-25T12:00:00Z');
    expect(info.bodyExcerpt).toBe('Notes');
    expect(info.htmlUrl).toBe('https://example.com/r');
  });

  it('falls back to tag when name is missing', () => {
    const info = buildUpdateInfo({ ...release, name: null }, '0.1.0');
    expect(info.releaseName).toBe('v0.2.0');
  });

  it('falls back to tag when name is blank', () => {
    const info = buildUpdateInfo({ ...release, name: '   ' }, '0.1.0');
    expect(info.releaseName).toBe('v0.2.0');
  });
});

describe('bodyExcerpt', () => {
  it('returns short input unchanged', () => {
    expect(bodyExcerpt('hello', 500)).toBe('hello');
  });

  it('trims whitespace', () => {
    expect(bodyExcerpt('  hi  ', 500)).toBe('hi');
  });

  it('returns empty string for null/undefined', () => {
    expect(bodyExcerpt(null, 500)).toBe('');
    expect(bodyExcerpt(undefined, 500)).toBe('');
  });

  it('truncates with ellipsis', () => {
    const long = 'a'.repeat(600);
    const out = bodyExcerpt(long, 500);
    expect([...out].length).toBe(501); // 500 chars + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('shouldRunCheck', () => {
  it('returns true when never checked', () => {
    expect(shouldRunCheck(1_700_000_000, null)).toBe(true);
  });

  it('returns false when recently checked', () => {
    const now = 1_700_000_000;
    const last = now - 1000;
    expect(shouldRunCheck(now, last)).toBe(false);
  });

  it('returns true after 24 hours', () => {
    const now = 1_700_000_000;
    const last = now - THROTTLE_SECONDS;
    expect(shouldRunCheck(now, last)).toBe(true);
  });

  it('returns true just past 24 hours', () => {
    const now = 1_700_000_000;
    const last = now - THROTTLE_SECONDS - 1;
    expect(shouldRunCheck(now, last)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/updater.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/main/updater.ts
import { gt, valid } from 'semver';

export const REPO = 'IgorKvasn/whats';
export const THROTTLE_SECONDS = 24 * 60 * 60;
export const FAILURE_THRESHOLD = 3;
export const BODY_EXCERPT_MAX_CHARS = 500;

export interface ReleaseInfo {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
  html_url: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releasedAt: string;
  bodyExcerpt: string;
  htmlUrl: string;
}

export type FetchOutcome =
  | { kind: 'found'; release: ReleaseInfo }
  | { kind: 'no-releases' }
  | { kind: 'failed'; error: string };

function stripV(s: string): string {
  return s.startsWith('v') ? s.slice(1) : s;
}

export function decideUpdate(
  current: string,
  latestTag: string,
  skippedVersion: string | null,
): boolean {
  if (skippedVersion && skippedVersion === latestTag) return false;

  const currentClean = valid(stripV(current));
  const latestClean = valid(stripV(latestTag));

  if (!currentClean || !latestClean) return false;
  return gt(latestClean, currentClean);
}

export function buildUpdateInfo(release: ReleaseInfo, currentVersion: string): UpdateInfo {
  const name = release.name?.trim();
  const releaseName = name && name.length > 0 ? name : release.tag_name;

  return {
    currentVersion,
    latestVersion: release.tag_name,
    releaseName,
    releasedAt: release.published_at ?? '',
    bodyExcerpt: bodyExcerpt(release.body, BODY_EXCERPT_MAX_CHARS),
    htmlUrl: release.html_url,
  };
}

export function bodyExcerpt(
  body: string | null | undefined,
  maxChars: number,
): string {
  const raw = (body ?? '').trim();
  if ([...raw].length <= maxChars) return raw;
  const truncated = [...raw].slice(0, maxChars).join('');
  return truncated + '…';
}

export function shouldRunCheck(nowUnix: number, lastCheckedAt: number | null): boolean {
  if (lastCheckedAt === null) return true;
  return nowUnix - lastCheckedAt >= THROTTLE_SECONDS;
}

export async function fetchLatestRelease(
  repo: string,
  appVersion: string,
): Promise<FetchOutcome> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const userAgent = `whats-desktop/${appVersion}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { kind: 'failed', error: `request: ${err}` };
  }

  if (response.status === 404) return { kind: 'no-releases' };
  if (!response.ok) return { kind: 'failed', error: `http ${response.status}` };

  try {
    const info = (await response.json()) as ReleaseInfo;
    return { kind: 'found', release: info };
  } catch (err) {
    return { kind: 'failed', error: `parse: ${err}` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/updater.test.ts`
Expected: 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater.ts tests/updater.test.ts
git commit -m "feat: add updater module with GitHub release checking and version comparison"
```

---

## Task 8: Inject Utilities Module (TDD)

**Files:**
- Create: `src/preload/inject.ts`
- Test: `tests/inject.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/inject.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  parseUnread,
  makeNotificationShim,
  shouldNotifyFromUnreadDelta,
  pickFallbackNotificationPayload,
} from '../src/preload/inject';

function makeDocumentFixture(map: Record<string, unknown>) {
  return {
    querySelector(selector: string) {
      return (map as Record<string, unknown>)[selector] ?? null;
    },
  };
}

function makeElement({ textContent = '', title = null as string | null } = {}) {
  return {
    textContent,
    getAttribute(name: string) {
      if (name === 'title') return title;
      return null;
    },
  };
}

describe('parseUnread', () => {
  it('returns 0 with no parens', () => expect(parseUnread('WhatsApp')).toBe(0));
  it('parses simple count', () => expect(parseUnread('(3) WhatsApp')).toBe(3));
  it('handles 0', () => expect(parseUnread('(0) WhatsApp')).toBe(0));
  it('handles large counts', () => expect(parseUnread('(120) WhatsApp')).toBe(120));
  it('returns 0 for garbage', () => expect(parseUnread('hello')).toBe(0));
  it('returns 0 for non-numeric parens', () => expect(parseUnread('(abc) X')).toBe(0));
  it('returns 0 for null/undefined', () => {
    expect(parseUnread(null as unknown as string)).toBe(0);
    expect(parseUnread(undefined as unknown as string)).toBe(0);
  });
});

describe('notification shim', () => {
  it('invokes notify_message with sender + body', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new (Shim as unknown as new (t: string, o: { body: string }) => unknown)('Alice', { body: 'hi' });
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Alice', body: 'hi' });
  });

  it('passes null body when options omitted', () => {
    const invoke = vi.fn();
    const Shim = makeNotificationShim(invoke);
    new (Shim as unknown as new (t: string) => unknown)('Bob');
    expect(invoke).toHaveBeenCalledWith('notify_message', { sender: 'Bob', body: null });
  });

  it('exposes permission as granted', () => {
    const Shim = makeNotificationShim(() => {});
    expect(Shim.permission).toBe('granted');
  });

  it('requestPermission resolves to granted', async () => {
    const Shim = makeNotificationShim(() => {});
    await expect(Shim.requestPermission()).resolves.toBe('granted');
  });
});

describe('unread delta fallback', () => {
  it('triggers when unread increases without recent direct notification', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 1,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 0,
        dedupeWindowMs: 1500,
      }),
    ).toBe(true);
  });

  it('does not trigger when unread does not increase', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 2,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 0,
        dedupeWindowMs: 1500,
      }),
    ).toBe(false);
  });

  it('does not trigger when direct notification was just forwarded', () => {
    expect(
      shouldNotifyFromUnreadDelta({
        previousUnread: 1,
        nextUnread: 2,
        nowMs: 5000,
        lastDirectNotificationAtMs: 4500,
        dedupeWindowMs: 1500,
      }),
    ).toBe(false);
  });
});

describe('fallback payload extraction', () => {
  it('prefers active conversation title and preview', () => {
    const doc = makeDocumentFixture({
      'header [title]': makeElement({ title: 'Alice', textContent: 'Alice' }),
      '[data-pre-plain-text] span[dir="auto"]': makeElement({ textContent: 'latest message' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Alice',
      body: 'latest message',
    });
  });

  it('falls back to unread chat row', () => {
    const doc = makeDocumentFixture({
      '[aria-label*="Unread"] [title]': makeElement({ title: 'Bob', textContent: 'Bob' }),
      '[aria-label*="Unread"] span[dir="auto"]': makeElement({ textContent: 'ping' }),
    });
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toEqual({
      sender: 'Bob',
      body: 'ping',
    });
  });

  it('returns null when no plausible sender found', () => {
    const doc = makeDocumentFixture({});
    expect(pickFallbackNotificationPayload(doc as unknown as Document)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/inject.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/preload/inject.ts
export function parseUnread(title: string): number {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const rest = trimmed.slice(1);
  const match = rest.match(/^(\d+)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readCandidate(doc: Document, selector: string): string {
  const el = doc?.querySelector?.(selector);
  if (!el) return '';
  return normalizeText(
    (el as HTMLElement).getAttribute?.('title') || (el as HTMLElement).textContent,
  );
}

type InvokeFn = (command: string, args: Record<string, unknown>) => void;

export interface NotificationShim {
  (title: string, options?: { body?: string }): { close: () => void };
  permission: string;
  requestPermission: (cb?: (result: string) => void) => Promise<string>;
}

export function makeNotificationShim(invokeFn: InvokeFn): NotificationShim {
  function Shim(title: string, options?: { body?: string }): { close: () => void } {
    const body = options && typeof options.body === 'string' ? options.body : null;
    invokeFn('notify_message', { sender: String(title || ''), body });
    return { close() {} };
  }
  Shim.permission = 'granted';
  Shim.requestPermission = function (cb?: (result: string) => void): Promise<string> {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  return Shim as unknown as NotificationShim;
}

export interface UnreadDeltaDetails {
  previousUnread: number;
  nextUnread: number;
  nowMs: number;
  lastDirectNotificationAtMs: number;
  dedupeWindowMs: number;
}

export function shouldNotifyFromUnreadDelta(details: UnreadDeltaDetails): boolean {
  if (!Number.isFinite(details.previousUnread) || details.previousUnread < 0) return false;
  if (!Number.isFinite(details.nextUnread) || details.nextUnread <= details.previousUnread)
    return false;
  if (!Number.isFinite(details.nowMs)) return false;
  if (!Number.isFinite(details.lastDirectNotificationAtMs)) return true;
  return details.nowMs - details.lastDirectNotificationAtMs >= details.dedupeWindowMs;
}

export function pickFallbackNotificationPayload(
  doc: Document,
): { sender: string; body: string | null } | null {
  const sender =
    readCandidate(doc, 'header [title]') ||
    readCandidate(doc, '[aria-label*="Unread"] [title]') ||
    readCandidate(doc, '[data-testid="cell-frame-title"] [title]');

  if (!sender) return null;

  const body =
    readCandidate(doc, '[data-pre-plain-text] span[dir="auto"]') ||
    readCandidate(doc, '[aria-label*="Unread"] span[dir="auto"]') ||
    null;

  return { sender, body };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/inject.test.ts`
Expected: 18 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/preload/inject.ts tests/inject.test.ts
git commit -m "feat: add inject utilities with notification shim and unread delta logic"
```

---

## Task 9: Windows Module

**Files:**
- Create: `src/main/windows.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/main/windows.ts
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
const dialogWindows: Map<string, BrowserWindow> = new Map();

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function mainInForeground(): boolean {
  if (!mainWindow) return false;
  return mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
}

export function showMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function hideMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.hide();
}

export function toggleMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

interface DialogOptions {
  label: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  preloadPath: string;
  rendererUrl: string;
}

function showDialogWindow(options: DialogOptions): void {
  const existing = dialogWindows.get(options.label);
  if (existing && !existing.isDestroyed()) {
    existing.restore();
    existing.show();
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    resizable: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dialogWindows.set(options.label, win);
  win.on('closed', () => dialogWindows.delete(options.label));

  const url = `${options.rendererUrl}?view=${options.label}`;
  win.loadURL(url);
}

export function createDialogOpeners(preloadPath: string, rendererUrl: string) {
  return {
    openSettings(): void {
      showDialogWindow({
        label: 'settings',
        title: 'WhatsApp — Settings',
        width: 480,
        height: 360,
        minWidth: 320,
        minHeight: 240,
        preloadPath,
        rendererUrl,
      });
    },
    openAbout(): void {
      showDialogWindow({
        label: 'about',
        title: 'WhatsApp — About',
        width: 440,
        height: 240,
        minWidth: 320,
        minHeight: 220,
        preloadPath,
        rendererUrl,
      });
    },
    openUpdate(): void {
      showDialogWindow({
        label: 'update',
        title: 'WhatsApp — Update available',
        width: 480,
        height: 420,
        minWidth: 360,
        minHeight: 320,
        preloadPath,
        rendererUrl,
      });
    },
  };
}

export function closeDialogWindow(label: string): void {
  const win = dialogWindows.get(label);
  if (win && !win.isDestroyed()) {
    win.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/windows.ts
git commit -m "feat: add windows module for main and dialog window management"
```

---

## Task 10: Preload Scripts

**Files:**
- Create: `src/preload/index.ts`
- Create: `src/preload/whatsapp.ts`

- [ ] **Step 1: Write the dialog preload**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getBuildInfo: () => ipcRenderer.invoke('build-info:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  previewNotification: () => ipcRenderer.invoke('settings:preview-notification'),
  previewSound: () => ipcRenderer.invoke('settings:preview-sound'),
  getUpdateInfo: () => ipcRenderer.invoke('update:get-info'),
  checkForUpdatesNow: () => ipcRenderer.invoke('update:check-now'),
  setSkippedVersion: (version: string) => ipcRenderer.invoke('update:skip-version', version),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  closeWindow: () => ipcRenderer.send('window:close'),
});
```

- [ ] **Step 2: Write the WhatsApp webview preload**

```ts
// src/preload/whatsapp.ts
import { ipcRenderer, webFrame } from 'electron';
import {
  parseUnread,
  shouldNotifyFromUnreadDelta,
  pickFallbackNotificationPayload,
} from './inject';

function safeIpcSend(channel: string, ...args: unknown[]): void {
  try {
    ipcRenderer.send(channel, ...args);
  } catch (err) {
    console.warn('[whats] ipc send failed:', channel, err);
  }
}

let lastUnread = -1;
let lastDirectNotificationAtMs = Number.NEGATIVE_INFINITY;

function pushTitle(): void {
  const n = parseUnread(document.title);
  const prev = lastUnread;
  if (n !== lastUnread) {
    lastUnread = n;
    safeIpcSend('whatsapp:unread', n);
    if (
      shouldNotifyFromUnreadDelta({
        previousUnread: prev,
        nextUnread: n,
        nowMs: Date.now(),
        lastDirectNotificationAtMs,
        dedupeWindowMs: 1500,
      })
    ) {
      const payload = pickFallbackNotificationPayload(document);
      if (payload) {
        safeIpcSend('whatsapp:notify', payload);
      }
    }
  }
}

function watchTitle(): void {
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(pushTitle).observe(titleEl, {
      subtree: true,
      characterData: true,
      childList: true,
    });
  }
  pushTitle();
}

function installNotificationShim(): void {
  const shimCode = `
    (function() {
      const originalNotification = window.Notification;
      function ShimNotification(title, options) {
        const body = options && typeof options.body === 'string' ? options.body : null;
        window.__whatsNotify(title, body);
        return { close: function() {} };
      }
      ShimNotification.permission = 'granted';
      ShimNotification.requestPermission = function(cb) {
        if (typeof cb === 'function') cb('granted');
        return Promise.resolve('granted');
      };
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: ShimNotification,
      });

      // Patch ServiceWorkerRegistration.showNotification
      try {
        const swc = navigator.serviceWorker;
        if (swc) {
          function wrapReg(reg) {
            if (!reg || reg.__whatsPatched) return reg;
            const orig = reg.showNotification ? reg.showNotification.bind(reg) : null;
            reg.showNotification = function(title, options) {
              const body = options && typeof options.body === 'string' ? options.body : null;
              window.__whatsNotify(title, body);
              if (orig) { try { return orig(title, options); } catch(_) {} }
              return Promise.resolve();
            };
            reg.__whatsPatched = true;
            return reg;
          }
          if (swc.getRegistration) {
            const origGetReg = swc.getRegistration.bind(swc);
            swc.getRegistration = function() { return origGetReg.apply(null, arguments).then(wrapReg); };
          }
          if (swc.getRegistrations) {
            const origGetRegs = swc.getRegistrations.bind(swc);
            swc.getRegistrations = function() { return origGetRegs.apply(null, arguments).then(function(r) { return r.map(wrapReg); }); };
          }
          if (swc.ready && typeof swc.ready.then === 'function') {
            swc.ready.then(wrapReg).catch(function(){});
          }
          if (swc.register) {
            const origRegister = swc.register.bind(swc);
            swc.register = function() { return origRegister.apply(null, arguments).then(wrapReg); };
          }
        }
      } catch(e) {}
    })();
  `;

  webFrame.executeJavaScript(`
    window.__whatsNotify = function() {};
    ${shimCode}
  `);

  ipcRenderer.on('__whats_notify_bridge', (_event, title: string, body: string | null) => {
    lastDirectNotificationAtMs = Date.now();
    safeIpcSend('whatsapp:notify', { sender: String(title || ''), body });
  });

  webFrame.executeJavaScript(`
    window.__whatsNotify = function(title, body) {
      require('electron').ipcRenderer.send('__whats_notify_bridge', title, body);
    };
  `).catch(() => {
    // If contextIsolation prevents this, use postMessage instead
    window.addEventListener('message', (event) => {
      if (event.data?.type === '__whats_notify') {
        lastDirectNotificationAtMs = Date.now();
        safeIpcSend('whatsapp:notify', {
          sender: String(event.data.title || ''),
          body: event.data.body ?? null,
        });
      }
    });

    webFrame.executeJavaScript(`
      window.__whatsNotify = function(title, body) {
        window.postMessage({ type: '__whats_notify', title: title, body: body }, '*');
      };
      ${shimCode}
    `);
  });
}

function installLinkInterceptor(): void {
  document.addEventListener(
    'click',
    (e) => handleLinkEvent(e),
    true,
  );
  document.addEventListener(
    'auxclick',
    (e) => handleLinkEvent(e),
    true,
  );
}

function handleLinkEvent(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  if (e.type === 'click' && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))
    return;
  if (e.type === 'auxclick' && e.button !== 1) return;

  const a = findAnchorInPath(e);
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !isExternalUrl(href)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  safeIpcSend('shell:open-external', href);
}

function findAnchorInPath(e: Event): HTMLAnchorElement | null {
  const path = e.composedPath?.();
  if (path) {
    for (const node of path) {
      if (
        node instanceof HTMLElement &&
        node.tagName === 'A' &&
        node.getAttribute('href')
      ) {
        return node as HTMLAnchorElement;
      }
    }
  }
  const target = e.target as HTMLElement | null;
  return target?.closest?.('a[href]') ?? null;
}

function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

const DISC_RE = /phone not connected|computer not connected|trouble connecting/i;
let lastDisconnected: boolean | null = null;
let checkScheduled = false;

function checkDisconnected(): void {
  checkScheduled = false;
  const alerts = document.querySelectorAll(
    '[role="alert"], [aria-live="polite"], [aria-live="assertive"]',
  );
  let text = '';
  alerts.forEach((el) => {
    text += el.textContent;
  });
  const isDisc = DISC_RE.test(text);
  if (isDisc !== lastDisconnected) {
    lastDisconnected = isDisc;
    safeIpcSend('whatsapp:disconnected', isDisc);
  }
}

function scheduleCheck(): void {
  if (!checkScheduled) {
    checkScheduled = true;
    setTimeout(checkDisconnected, 1000);
  }
}

function watchDisconnected(): void {
  checkDisconnected();
  new MutationObserver(scheduleCheck).observe(document.body, {
    subtree: true,
    childList: true,
  });
  setInterval(checkDisconnected, 30000);
}

function boot(): void {
  installNotificationShim();
  installLinkInterceptor();
  watchTitle();
  watchDisconnected();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/whatsapp.ts
git commit -m "feat: add preload scripts for dialog windows and WhatsApp webview"
```

---

## Task 11: Main Process Entry Point

**Files:**
- Create: `src/main/index.ts`

- [ ] **Step 1: Write the main process entry**

```ts
// src/main/index.ts
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings, type Settings } from './settings';
import { currentBuildInfo } from './buildInfo';
import {
  shouldDispatch,
  showNotification,
  isSafeExternalUrl,
  type LastNotification,
} from './notifications';
import { createTray, updateTray, type TrayHandle } from './tray';
import {
  decideUpdate,
  buildUpdateInfo,
  fetchLatestRelease,
  shouldRunCheck,
  REPO,
  FAILURE_THRESHOLD,
  type UpdateInfo,
  type FetchOutcome,
} from './updater';
import {
  setMainWindow,
  getMainWindow,
  showMainWindow,
  toggleMainWindow,
  mainInForeground,
  createDialogOpeners,
} from './windows';
import { parseUnread } from './titleParse';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings: Settings;
let lastNotification: LastNotification | null = null;
let currentUpdate: UpdateInfo | null = null;
let trayHandle: TrayHandle | null = null;
let dialogs: ReturnType<typeof createDialogOpeners>;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(initialize);
}

function getVersion(): string {
  return app.getVersion();
}

async function initialize(): Promise<void> {
  settings = loadSettings(settingsPath);

  const preloadDialogPath = path.join(__dirname, '../preload/index.js');
  const preloadWhatsappPath = path.join(__dirname, '../preload/whatsapp.js');

  const mainWindow = new BrowserWindow({
    title: 'WhatsApp',
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: preloadWhatsappPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setMainWindow(mainWindow);
  mainWindow.loadURL('https://web.whatsapp.com/');

  // Determine renderer URL for dialog windows
  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ??
    `file://${path.join(__dirname, '../renderer/index.html')}`;

  dialogs = createDialogOpeners(preloadDialogPath, rendererUrl);

  // System tray
  const iconDir = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'), 'icons');

  trayHandle = createTray(iconDir, {
    onShow: showMainWindow,
    onSettings: dialogs.openSettings,
    onAbout: dialogs.openAbout,
    onDevTools: () => {
      const win = getMainWindow();
      if (win) win.webContents.openDevTools();
    },
    onQuit: () => app.exit(0),
    onToggle: toggleMainWindow,
  });

  // Close to tray
  mainWindow.on('close', (e) => {
    if (trayHandle) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  registerIpcHandlers();

  // Startup update check
  if (settings.autoUpdateCheckEnabled) {
    setTimeout(() => runStartupCheck(), 5000);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('build-info:get', () => {
    return currentBuildInfo(getVersion());
  });

  ipcMain.handle('settings:get', () => {
    return settings;
  });

  ipcMain.handle('settings:set', (_event, newSettings: Settings) => {
    saveSettings(settingsPath, newSettings);
    settings = newSettings;
  });

  ipcMain.handle('settings:preview-notification', () => {
    showNotification('WhatsApp', 'Notification preview', false, showMainWindow);
  });

  ipcMain.handle('settings:preview-sound', () => {
    showNotification('WhatsApp', 'Sound preview', true, showMainWindow);
  });

  ipcMain.handle('update:get-info', () => {
    return currentUpdate;
  });

  ipcMain.handle('update:check-now', async () => {
    return await runManualCheck();
  });

  ipcMain.handle('update:skip-version', (_event, version: string) => {
    settings.updateState.skippedVersion = version;
    saveSettings(settingsPath, settings);
  });

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (!isSafeExternalUrl(url)) {
      throw new Error(`rejected url scheme: ${url}`);
    }
    shell.openExternal(url);
  });

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.on('whatsapp:notify', (_event, payload: { sender: string; body: string | null }) => {
    const { sender, body } = payload;
    const senderTrunc = sender.slice(0, 200);
    const bodyTrunc = body ? body.slice(0, 1000) : '';

    if (mainInForeground()) return;

    const now = Date.now();
    if (!shouldDispatch(lastNotification, now, senderTrunc, bodyTrunc, 1500)) return;

    lastNotification = { time: now, sender: senderTrunc, body: bodyTrunc };

    if (!settings.notificationsEnabled) return;

    const bodyText = settings.includePreview ? bodyTrunc : '';
    showNotification(senderTrunc, bodyText, settings.soundEnabled, showMainWindow);
  });

  ipcMain.on('whatsapp:unread', (_event, count: number) => {
    if (trayHandle) {
      updateTray(trayHandle, getIconDir(), count, undefined);
    }
  });

  ipcMain.on('whatsapp:disconnected', (_event, disconnected: boolean) => {
    if (trayHandle) {
      updateTray(trayHandle, getIconDir(), undefined, disconnected);
    }
  });

  ipcMain.on('shell:open-external', (_event, url: string) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  });
}

function getIconDir(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'),
    'icons',
  );
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function runStartupCheck(): Promise<void> {
  const now = currentUnixSeconds();
  if (!shouldRunCheck(now, settings.updateState.lastCheckedAt)) return;

  const outcome = await fetchLatestRelease(REPO, getVersion());
  handleFetchOutcome(outcome, now, settings.updateState.skippedVersion);
}

async function runManualCheck(): Promise<
  { status: 'update_available' } | { status: 'up_to_date'; current: string } | { status: 'failed'; error: string }
> {
  const outcome = await fetchLatestRelease(REPO, getVersion());

  if (outcome.kind === 'failed') {
    return { status: 'failed', error: outcome.error };
  }

  const now = currentUnixSeconds();
  if (outcome.kind === 'no-releases') {
    recordSuccess(now);
    return { status: 'up_to_date', current: getVersion() };
  }

  recordSuccess(now);
  if (decideUpdate(getVersion(), outcome.release.tag_name, null)) {
    const info = buildUpdateInfo(outcome.release, getVersion());
    currentUpdate = info;
    dialogs.openUpdate();
    return { status: 'update_available' };
  }
  return { status: 'up_to_date', current: getVersion() };
}

function handleFetchOutcome(
  outcome: FetchOutcome,
  now: number,
  skippedVersion: string | null,
): void {
  if (outcome.kind === 'failed') {
    handleFailure();
    return;
  }
  if (outcome.kind === 'no-releases') {
    recordSuccess(now);
    return;
  }
  recordSuccess(now);
  if (decideUpdate(getVersion(), outcome.release.tag_name, skippedVersion)) {
    currentUpdate = buildUpdateInfo(outcome.release, getVersion());
    dialogs.openUpdate();
  }
}

function recordSuccess(now: number): void {
  settings.updateState.lastCheckedAt = now;
  settings.updateState.consecutiveFailures = 0;
  saveSettings(settingsPath, settings);
}

function handleFailure(): void {
  settings.updateState.consecutiveFailures += 1;
  const fire = settings.updateState.consecutiveFailures >= FAILURE_THRESHOLD;
  if (fire) {
    settings.updateState.consecutiveFailures = 0;
  }
  saveSettings(settingsPath, settings);
  if (fire && settings.notificationsEnabled) {
    showNotification(
      'WhatsApp',
      "Couldn't check for updates — please verify your internet connection.",
      false,
      showMainWindow,
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: add electron main process entry with IPC handlers and app lifecycle"
```

---

## Task 12: Renderer (React Frontend)

**Files:**
- Create: `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- Create: `src/renderer/settingsApi.ts`, `src/renderer/buildInfoApi.ts`, `src/renderer/updateApi.ts`
- Create: `src/renderer/electron.d.ts`

- [ ] **Step 1: Create electron.d.ts**

```ts
// src/renderer/electron.d.ts
export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: unknown;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releasedAt: string;
  bodyExcerpt: string;
  htmlUrl: string;
}

export type ManualCheckResult =
  | { status: 'update_available' }
  | { status: 'up_to_date'; current: string }
  | { status: 'failed'; error: string };

interface ElectronAPI {
  getBuildInfo(): Promise<BuildInfo>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  previewNotification(): Promise<void>;
  previewSound(): Promise<void>;
  getUpdateInfo(): Promise<UpdateInfo | null>;
  checkForUpdatesNow(): Promise<ManualCheckResult>;
  setSkippedVersion(version: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  closeWindow(): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

- [ ] **Step 2: Create settingsApi.ts**

```ts
// src/renderer/settingsApi.ts
export interface Settings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  includePreview: boolean;
  autoUpdateCheckEnabled: boolean;
  updateState: unknown;
}

export async function getSettings(): Promise<Settings> {
  return window.electronAPI.getSettings();
}

export async function setSettings(s: Settings): Promise<void> {
  return window.electronAPI.setSettings(s);
}

export async function previewNotification(): Promise<void> {
  return window.electronAPI.previewNotification();
}

export async function previewSound(): Promise<void> {
  return window.electronAPI.previewSound();
}
```

- [ ] **Step 3: Create buildInfoApi.ts**

```ts
// src/renderer/buildInfoApi.ts
export interface BuildInfo {
  version: string;
  buildTimestamp: string;
}

export async function getBuildInfo(): Promise<BuildInfo> {
  return window.electronAPI.getBuildInfo();
}
```

- [ ] **Step 4: Create updateApi.ts**

```ts
// src/renderer/updateApi.ts
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releasedAt: string;
  bodyExcerpt: string;
  htmlUrl: string;
}

export type ManualCheckResult =
  | { status: 'update_available' }
  | { status: 'up_to_date'; current: string }
  | { status: 'failed'; error: string };

export async function getUpdateInfo(): Promise<UpdateInfo> {
  const info = await window.electronAPI.getUpdateInfo();
  if (!info) throw new Error('no update info available');
  return info;
}

export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  return window.electronAPI.checkForUpdatesNow();
}

export async function setSkippedVersion(tag: string): Promise<void> {
  return window.electronAPI.setSkippedVersion(tag);
}
```

- [ ] **Step 5: Create App.tsx**

```tsx
// src/renderer/App.tsx
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { getBuildInfo, type BuildInfo } from './buildInfoApi';
import {
  getSettings,
  previewNotification,
  previewSound,
  setSettings,
  type Settings,
} from './settingsApi';
import {
  checkForUpdatesNow,
  getUpdateInfo,
  setSkippedVersion,
  type ManualCheckResult,
  type UpdateInfo,
} from './updateApi';
import './styles.css';

const viewParam = new URLSearchParams(window.location.search).get('view');

export default function App() {
  if (viewParam === 'about') return <AboutView />;
  if (viewParam === 'update') return <UpdateView />;
  return <SettingsView />;
}

function SettingsView() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'up_to_date'; current: string }
    | { kind: 'failed' }
  >({ kind: 'idle' });

  useEffect(() => {
    getSettings().then(setLocal).catch((e) => setError(String(e)));
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    setUpdateCheckStatus({ kind: 'idle' });
    try {
      await setSettings(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCheckNow() {
    setUpdateCheckStatus({ kind: 'checking' });
    try {
      const result: ManualCheckResult = await checkForUpdatesNow();
      if (result.status === 'update_available') {
        setUpdateCheckStatus({ kind: 'idle' });
      } else if (result.status === 'up_to_date') {
        setUpdateCheckStatus({ kind: 'up_to_date', current: result.current });
      } else {
        setUpdateCheckStatus({ kind: 'failed' });
      }
    } catch {
      setUpdateCheckStatus({ kind: 'failed' });
    }
  }

  if (error) return <div className="settings"><p className="err">Error: {error}</p></div>;
  if (!settings) return <div className="settings"><p>Loading…</p></div>;

  return (
    <div className="dialog settings">
      <h1>Settings</h1>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.notificationsEnabled}
          onChange={(e) => update({ notificationsEnabled: e.target.checked })}
        />
        <span>Show notifications</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewNotification().catch((e) => setError(String(e)))}
          disabled={!settings.notificationsEnabled}
        >
          Preview notification
        </button>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.soundEnabled}
          onChange={(e) => update({ soundEnabled: e.target.checked })}
          disabled={!settings.notificationsEnabled}
        />
        <span>Play sound on notification</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewSound().catch((e) => setError(String(e)))}
          disabled={!settings.notificationsEnabled || !settings.soundEnabled}
        >
          Preview sound
        </button>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.includePreview}
          onChange={(e) => update({ includePreview: e.target.checked })}
          disabled={!settings.notificationsEnabled}
        />
        <span>Include message preview</span>
      </label>
      <hr />
      <label className="row">
        <input
          type="checkbox"
          checked={settings.autoUpdateCheckEnabled}
          onChange={(e) => update({ autoUpdateCheckEnabled: e.target.checked })}
        />
        <span>Automatically check for updates on startup</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={updateCheckStatus.kind === 'checking'}
        >
          {updateCheckStatus.kind === 'checking' ? 'Checking…' : 'Check for updates now'}
        </button>
      </div>
      {updateCheckStatus.kind === 'up_to_date' && (
        <div className="row">
          <span>You're up to date (v{updateCheckStatus.current}).</span>
        </div>
      )}
      {updateCheckStatus.kind === 'failed' && (
        <div className="row">
          <span className="err">Update check failed. Please try again later.</span>
        </div>
      )}
    </div>
  );
}

function AboutView() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBuildInfo().then(setBuildInfo).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!buildInfo) return <div className="dialog"><p>Loading…</p></div>;

  return (
    <div className="dialog about">
      <h1>About</h1>
      <dl className="details">
        <div className="detail">
          <dt>Version</dt>
          <dd>{buildInfo.version}</dd>
        </div>
        <div className="detail">
          <dt>Build date and time</dt>
          <dd>{buildInfo.buildTimestamp}</dd>
        </div>
      </dl>
    </div>
  );
}

function UpdateView() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipThis, setSkipThis] = useState(false);

  useEffect(() => {
    getUpdateInfo().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  async function persistSkipIfChecked(tag: string) {
    if (skipThis) {
      try {
        await setSkippedVersion(tag);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function handleOpenReleasePage() {
    if (!info) return;
    await persistSkipIfChecked(info.latestVersion);
    try {
      await window.electronAPI.openExternal(info.htmlUrl);
    } catch (e) {
      setError(String(e));
      return;
    }
    window.electronAPI.closeWindow();
  }

  async function handleLater() {
    if (!info) return;
    await persistSkipIfChecked(info.latestVersion);
    window.electronAPI.closeWindow();
  }

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!info) return <div className="dialog"><p>Loading…</p></div>;

  const releasedDisplay = info.releasedAt
    ? new Date(info.releasedAt).toLocaleDateString()
    : '—';

  return (
    <div className="dialog update">
      <h1>Update available</h1>
      <p>A new version of whats is available.</p>
      <dl className="details">
        <div className="detail">
          <dt>Current version</dt>
          <dd>{info.currentVersion}</dd>
        </div>
        <div className="detail">
          <dt>New version</dt>
          <dd>{info.latestVersion}</dd>
        </div>
        <div className="detail">
          <dt>Released</dt>
          <dd>{releasedDisplay}</dd>
        </div>
      </dl>
      {info.bodyExcerpt && (
        <>
          <h2 className="release-notes-heading">Release notes</h2>
          <div className="release-notes">
            <Markdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) window.electronAPI.openExternal(href);
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {info.bodyExcerpt}
            </Markdown>
          </div>
        </>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={skipThis}
          onChange={(e) => setSkipThis(e.target.checked)}
        />
        <span>Don't notify me about this version</span>
      </label>
      <div className="row buttons">
        <button type="button" onClick={handleLater}>Later</button>
        <button type="button" onClick={handleOpenReleasePage}>Open release page</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create main.tsx**

```tsx
// src/renderer/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: Copy styles.css from old source**

Copy the existing `src/styles.css` content to `src/renderer/styles.css` (unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/
git commit -m "feat: add renderer with React views and electron IPC API layer"
```

---

## Task 13: Component Tests (Settings and Update Views)

**Files:**
- Create: `tests/settingsView.test.tsx`
- Create: `tests/updateView.test.tsx`

- [ ] **Step 1: Write settings view tests**

```tsx
// tests/settingsView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mockElectronAPI = {
  getBuildInfo: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  previewNotification: vi.fn(),
  previewSound: vi.fn(),
  getUpdateInfo: vi.fn(),
  checkForUpdatesNow: vi.fn(),
  setSkippedVersion: vi.fn(),
  openExternal: vi.fn(),
  closeWindow: vi.fn(),
};

beforeEach(() => {
  cleanup();
  Object.values(mockElectronAPI).forEach((fn) => fn.mockReset());
  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

  mockElectronAPI.getSettings.mockResolvedValue({
    notificationsEnabled: true,
    soundEnabled: true,
    includePreview: false,
    autoUpdateCheckEnabled: true,
    updateState: {},
  });
  mockElectronAPI.setSettings.mockResolvedValue(undefined);
  mockElectronAPI.checkForUpdatesNow.mockResolvedValue({
    status: 'up_to_date',
    current: '0.1.0',
  });
});

// Mock the URL search params to render SettingsView
Object.defineProperty(window, 'location', {
  value: { search: '?view=settings' },
  writable: true,
});

describe('SettingsView auto-update controls', () => {
  it('renders the auto-update checkbox', async () => {
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Automatically check for updates on startup/i),
      ).toBeTruthy(),
    );
  });

  it('shows "up to date" message after Check now', async () => {
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(screen.getByText(/You're up to date \(v0\.1\.0\)/)).toBeTruthy(),
    );
  });

  it('shows failed message when manual check fails', async () => {
    mockElectronAPI.checkForUpdatesNow.mockResolvedValue({
      status: 'failed',
      error: 'boom',
    });
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(
        screen.getByText(/Update check failed\. Please try again later\./),
      ).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 2: Write update view tests**

```tsx
// tests/updateView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mockElectronAPI = {
  getBuildInfo: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  previewNotification: vi.fn(),
  previewSound: vi.fn(),
  getUpdateInfo: vi.fn(),
  checkForUpdatesNow: vi.fn(),
  setSkippedVersion: vi.fn(),
  openExternal: vi.fn(),
  closeWindow: vi.fn(),
};

const fakeInfo = {
  currentVersion: '0.1.0',
  latestVersion: 'v0.2.0',
  releaseName: 'v0.2.0',
  releasedAt: '2026-04-25T12:00:00Z',
  bodyExcerpt: 'fixed stuff',
  htmlUrl: 'https://github.com/IgorKvasn/whats/releases/tag/v0.2.0',
};

beforeEach(() => {
  cleanup();
  Object.values(mockElectronAPI).forEach((fn) => fn.mockReset());
  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
});

// Mock URL for update view
Object.defineProperty(window, 'location', {
  value: { search: '?view=update' },
  writable: true,
});

describe('UpdateView', () => {
  it('renders version comparison and release notes', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Update available'));
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('fixed stuff')).toBeTruthy();
  });

  it('Open release page calls openExternal and closes the window', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    mockElectronAPI.openExternal.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Open release page'));
    fireEvent.click(screen.getByText('Open release page'));
    await waitFor(() => expect(mockElectronAPI.closeWindow).toHaveBeenCalled());
    expect(mockElectronAPI.openExternal).toHaveBeenCalledWith(fakeInfo.htmlUrl);
    expect(mockElectronAPI.setSkippedVersion).not.toHaveBeenCalled();
  });

  it('Later with skip-checkbox persists skipped_version then closes', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    mockElectronAPI.setSkippedVersion.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Later'));
    fireEvent.click(screen.getByLabelText("Don't notify me about this version"));
    fireEvent.click(screen.getByText('Later'));
    await waitFor(() =>
      expect(mockElectronAPI.setSkippedVersion).toHaveBeenCalledWith('v0.2.0'),
    );
    expect(mockElectronAPI.closeWindow).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run component tests**

Run: `npx vitest run tests/settingsView.test.tsx tests/updateView.test.tsx`
Expected: 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/settingsView.test.tsx tests/updateView.test.tsx
git commit -m "test: add settings and update view component tests with electron API mocks"
```

---

## Task 14: Bundle Config Tests

**Files:**
- Create: `tests/bundleConfig.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/bundleConfig.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const rootDir = resolve(import.meta.dirname, '..');

describe('electron-builder config', () => {
  it('targets deb for linux', () => {
    const raw = readFileSync(resolve(rootDir, 'electron-builder.yml'), 'utf8');
    const config = parse(raw);
    expect(config.linux?.target).toBe('deb');
  });

  it('has correct app category and WM class', () => {
    const raw = readFileSync(resolve(rootDir, 'electron-builder.yml'), 'utf8');
    const config = parse(raw);
    expect(config.linux?.category).toContain('InstantMessaging');
    expect(config.linux?.desktop?.StartupWMClass).toBe('whats');
  });
});
```

- [ ] **Step 2: Add yaml dev dependency**

Run: `npm install --save-dev yaml`

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/bundleConfig.test.ts`
Expected: 2 tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/bundleConfig.test.ts package.json package-lock.json
git commit -m "test: add electron-builder config validation tests"
```

---

## Task 15: Update Build and Release Scripts

**Files:**
- Modify: `scripts/build-deb.sh`
- Modify: `scripts/release.sh`

- [ ] **Step 1: Rewrite build-deb.sh**

```bash
#!/usr/bin/env bash
#
# Build a .deb package of `whats` (Electron).
#
# Flags:
#   --skip-apt     Skip the apt-get install step.
#   --skip-tests   Skip npm test.
#   --no-sudo      Don't use sudo for apt-get.
#   -h, --help     Show this help.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SKIP_APT=0
SKIP_TESTS=0
SUDO="sudo"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --skip-apt)   SKIP_APT=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --no-sudo)    SUDO="" ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

cd "${REPO_ROOT}"

# Step 1 — system packages
if [[ "${SKIP_APT}" -eq 0 ]]; then
  log "Step 1/5: Installing system packages"
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y \
    libnotify-bin \
    pulseaudio-utils \
    dpkg \
    fakeroot
else
  log "Step 1/5: Skipping apt-get install (--skip-apt)"
fi

# Step 2 — toolchain check
log "Step 2/5: Verifying toolchain"
if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js >= 20.17 (nvm/fnm/distro)." >&2
  exit 1
fi
echo "node:   $(node --version)"
echo "npm:    $(npm --version)"

# Step 3 — npm install
log "Step 3/5: Installing project dependencies (npm install)"
npm install

# Step 4 — tests
if [[ "${SKIP_TESTS}" -eq 0 ]]; then
  log "Step 4/5: Running tests and build"
  npm test
  npm run build
else
  log "Step 4/5: Skipping tests (--skip-tests)"
  npm run build
fi

# Step 5 — package .deb
log "Step 5/5: Packaging .deb via electron-builder"
npx electron-builder --linux deb

DEB_DIR="${REPO_ROOT}/dist"
shopt -s nullglob
DEBS=("${DEB_DIR}"/*.deb)
shopt -u nullglob

if [[ "${#DEBS[@]}" -eq 0 ]]; then
  echo "No .deb produced in ${DEB_DIR}" >&2
  exit 1
fi

printf '\n\033[1;32mBuild complete.\033[0m\n'
for f in "${DEBS[@]}"; do
  printf '  %s (%s)\n' "$f" "$(du -h "$f" | cut -f1)"
done
printf '\nInstall with:\n  sudo apt install %s\n' "${DEBS[0]}"
```

- [ ] **Step 2: Update release.sh version bumping (remove Cargo/Tauri references)**

Replace the `bump_versions` function body with:

```bash
bump_versions() {
  # package.json + package-lock.json
  ( cd "${REPO_ROOT}" && npm version "${new_version}" --no-git-tag-version --allow-same-version >/dev/null )
}
```

Replace the `DEB_DIR` and deb detection section with:

```bash
DEB_DIR="${REPO_ROOT}/dist"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  deb_file="${DEB_DIR}/whats_${new_version}_amd64.deb"
  printf '   [dry-run] expecting deb at %s\n' "${deb_file}"
else
  shopt -s nullglob
  debs=("${DEB_DIR}"/whats*${new_version}*.deb "${DEB_DIR}"/whats*.deb)
  shopt -u nullglob
  [[ "${#debs[@]}" -ge 1 ]] || die "no .deb matching version ${new_version} in ${DEB_DIR}"
  deb_file="${debs[0]}"
  echo "Built: ${deb_file}"
fi
```

Replace the git add/commit section with:

```bash
run "git add package.json package-lock.json CHANGELOG.md"
run "git commit -m 'chore(release): ${tag}'"
```

Remove `cargo` from the preconditions check list.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-deb.sh scripts/release.sh
git commit -m "build: update release and build scripts for electron packaging"
```

---

## Task 16: Full Test Run and Final Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All ~67 tests pass.

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`
Expected: electron-vite build succeeds, produces `out/` directory with main, preload, and renderer bundles.

- [ ] **Step 3: Verify electron starts (smoke test)**

Run: `npm run dev`
Expected: Electron window opens, loads WhatsApp Web. Tray icon appears. Close the window — it hides to tray.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve integration issues from full test run"
```

---

## Summary

| Task | Module | Tests |
|------|--------|-------|
| 1 | Project scaffolding | — |
| 2 | titleParse | 8 |
| 3 | buildInfo | 2 |
| 4 | tray | 3 |
| 5 | settings | 8 |
| 6 | notifications | 7 |
| 7 | updater | 14 |
| 8 | inject utilities | 18 |
| 9 | windows | — |
| 10 | preload scripts | — |
| 11 | main process | — |
| 12 | renderer | — |
| 13 | component tests | 6 |
| 14 | bundle config tests | 2 |
| 15 | build/release scripts | — |
| 16 | verification | — |

**Total tests: ~68**
