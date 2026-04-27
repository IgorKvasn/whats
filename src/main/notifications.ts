import { Notification } from 'electron';
import { execFile } from 'node:child_process';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';

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
