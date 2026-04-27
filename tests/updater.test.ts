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
    expect([...out].length).toBe(501);
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
