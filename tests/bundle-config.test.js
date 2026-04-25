import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('linux bundle desktop launchers', () => {
  it('uses an explicit desktop template for linux packages', () => {
    const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

    expect(config.bundle?.linux?.deb?.desktopTemplate).toBe('bundle/linux/whats.desktop.hbs');
    expect(config.bundle?.linux?.rpm?.desktopTemplate).toBe('bundle/linux/whats.desktop.hbs');
  });

  it('keeps package launchers on the installed binary path', () => {
    const template = readFileSync(new URL('../src-tauri/bundle/linux/whats.desktop.hbs', import.meta.url), 'utf8');

    expect(template).toContain('Exec={{exec}}');
    expect(template).toContain('Categories=Network;InstantMessaging;');
    expect(template).not.toContain('run.sh');
    expect(template).not.toContain('/data/projects/whats');
  });
});
