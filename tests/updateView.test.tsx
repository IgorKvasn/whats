import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const closeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'update', close: closeMock }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import App from '../src/App';

const invokeMock = vi.mocked(invoke);

const fakeInfo = {
  current_version: '0.1.0',
  latest_version: 'v0.2.0',
  release_name: 'v0.2.0',
  released_at: '2026-04-25T12:00:00Z',
  body_excerpt: 'fixed stuff',
  html_url: 'https://github.com/IgorKvasn/whats/releases/tag/v0.2.0',
};

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  closeMock.mockReset();
});

describe('UpdateView', () => {
  it('renders version comparison and release notes', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Update available'));
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('fixed stuff')).toBeTruthy();
  });

  it('Open release page calls open_external and closes the window', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      if (cmd === 'open_external') return undefined;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Open release page'));
    fireEvent.click(screen.getByText('Open release page'));
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith('open_external', {
      url: fakeInfo.html_url,
    });
    // skip checkbox not checked → no set_skipped_version call
    expect(
      invokeMock.mock.calls.find((c) => c[0] === 'set_skipped_version'),
    ).toBeUndefined();
  });

  it('Later with skip-checkbox persists skipped_version then closes', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_update_info') return fakeInfo;
      if (cmd === 'set_skipped_version') return undefined;
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText('Later'));
    fireEvent.click(
      screen.getByLabelText("Don't notify me about this version"),
    );
    fireEvent.click(screen.getByText('Later'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('set_skipped_version', {
        tag: 'v0.2.0',
      }),
    );
    expect(closeMock).toHaveBeenCalled();
  });
});
