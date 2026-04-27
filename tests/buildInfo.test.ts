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
