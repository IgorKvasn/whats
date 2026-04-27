import { vi } from 'vitest';

const mockFn = vi.fn();
console.log('Mock created:', mockFn);

vi.mock('node:child_process', async () => {
  console.log('Inside vi.mock, mockFn:', mockFn);
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFile: mockFn,
  };
});

import { execFile } from 'node:child_process';
console.log('After import, execFile:', execFile);
console.log('After import, mockFn:', mockFn);
console.log('Are they same?', execFile === mockFn);
