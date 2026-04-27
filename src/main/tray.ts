import { Menu, Tray } from 'electron';
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
