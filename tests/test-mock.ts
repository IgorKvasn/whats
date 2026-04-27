import { describe, it, expect, vi } from 'vitest';

const mockFn = vi.fn();

vi.mock('node:child_process', () => {
  return { execFile: mockFn };
});

import { execFile } from 'node:child_process';

describe('mock test', () => {
  it('works', () => {
    console.log('mockFn:', mockFn);
    console.log('execFile:', execFile);
    console.log('are they same?', mockFn === execFile);
    (execFile as any)('test', [], () => {});
    console.log('mockFn.mock.calls:', mockFn.mock.calls);
    expect(true).toBe(true);
  });
});
