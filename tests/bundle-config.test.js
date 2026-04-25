import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tauriDir = resolve(import.meta.dirname, '../src-tauri');

describe('linux bundle desktop launchers', () => {
  it('uses an explicit desktop template for linux packages', () => {
    const config = JSON.parse(readFileSync(resolve(tauriDir, 'tauri.conf.json'), 'utf8'));

    expect(config.bundle?.linux?.deb?.desktopTemplate).toBe('bundle/linux/whats.desktop.hbs');
    expect(config.bundle?.linux?.rpm?.desktopTemplate).toBe('bundle/linux/whats.desktop.hbs');
  });

  it('keeps package launchers on the installed binary path', () => {
    const template = readFileSync(resolve(tauriDir, 'bundle/linux/whats.desktop.hbs'), 'utf8');

    expect(template).toContain('Exec={{exec}}');
    expect(template).toContain('Categories=Network;InstantMessaging;');
    expect(template).not.toContain('run.sh');
    expect(template).not.toContain('/data/projects/whats');
  });
});

describe('tauri capabilities', () => {
  it('allow the dedicated settings and about utility windows', () => {
    const capability = JSON.parse(
      readFileSync(resolve(tauriDir, 'capabilities/whats.json'), 'utf8'),
    );

    expect(capability.windows).toContain('settings');
    expect(capability.windows).toContain('about');
  });
});
