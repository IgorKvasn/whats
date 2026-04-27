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
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe('whats');
  });
});
