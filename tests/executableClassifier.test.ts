import { describe, expect, it, afterEach } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hasDangerousExtension,
  hasSafeExtension,
  isSafeToOpen,
} from '../src/main/executableClassifier';

// @vitest-environment node

describe('hasDangerousExtension', () => {
  it('flags desktop entries', () => {
    expect(hasDangerousExtension('/tmp/malware.desktop')).toBe(true);
  });

  it('flags shell scripts', () => {
    expect(hasDangerousExtension('/tmp/run.sh')).toBe(true);
  });

  it('flags AppImages', () => {
    expect(hasDangerousExtension('/tmp/app.AppImage')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hasDangerousExtension('/tmp/RUN.SH')).toBe(true);
  });

  it('does not flag ordinary files', () => {
    expect(hasDangerousExtension('/tmp/photo.png')).toBe(false);
  });
});

describe('hasSafeExtension', () => {
  it('recognizes images, documents, archives, and media as safe', () => {
    expect(hasSafeExtension('/tmp/photo.png')).toBe(true);
    expect(hasSafeExtension('/tmp/report.pdf')).toBe(true);
    expect(hasSafeExtension('/tmp/archive.zip')).toBe(true);
    expect(hasSafeExtension('/tmp/song.mp3')).toBe(true);
  });

  it('does not treat unrecognized extensions as safe', () => {
    expect(hasSafeExtension('/tmp/mystery.xyz')).toBe(false);
  });

  it('does not treat dangerous extensions as safe', () => {
    expect(hasSafeExtension('/tmp/run.sh')).toBe(false);
  });
});

describe('isSafeToOpen', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('allows ordinary files', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'whats-classify-'));
    const filePath = path.join(dir, 'photo.png');
    await writeFile(filePath, 'data');
    expect(await isSafeToOpen(filePath)).toBe(true);
  });

  it('withholds open for a dangerous extension', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'whats-classify-'));
    const filePath = path.join(dir, 'run.sh');
    await writeFile(filePath, '#!/bin/sh');
    expect(await isSafeToOpen(filePath)).toBe(false);
  });

  it('withholds open for an unrecognized extension', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'whats-classify-'));
    const filePath = path.join(dir, 'mystery.xyz');
    await writeFile(filePath, 'data');
    expect(await isSafeToOpen(filePath)).toBe(false);
  });

  it('withholds open for an ordinary-extension file carrying the executable bit', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'whats-classify-'));
    const filePath = path.join(dir, 'photo.png');
    await writeFile(filePath, 'data');
    await chmod(filePath, 0o755);
    expect(await isSafeToOpen(filePath)).toBe(false);
  });
});
