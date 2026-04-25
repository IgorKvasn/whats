import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'settings', close: vi.fn() }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import App from '../src/App';

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_settings') {
      return {
        notifications_enabled: true,
        sound_enabled: true,
        include_preview: false,
        auto_update_check_enabled: true,
        update_state: {},
      };
    }
    if (cmd === 'check_for_updates_now') {
      return { status: 'up_to_date', current: '0.1.0' };
    }
    if (cmd === 'set_settings') return undefined;
    throw new Error(`unexpected ipc: ${cmd}`);
  });
});

describe('SettingsView auto-update controls', () => {
  it('renders the auto-update checkbox', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Automatically check for updates on startup/i),
      ).toBeTruthy(),
    );
  });

  it('shows "up to date" message after Check now', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(screen.getByText(/You're up to date \(v0\.1\.0\)/)).toBeTruthy(),
    );
  });

  it('shows failed message when manual check fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_settings') {
        return {
          notifications_enabled: true,
          sound_enabled: true,
          include_preview: false,
          auto_update_check_enabled: true,
          update_state: {},
        };
      }
      if (cmd === 'check_for_updates_now') {
        return { status: 'failed', error: 'boom' };
      }
      throw new Error(`unexpected ipc: ${cmd}`);
    });
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(
        screen.getByText(/Update check failed\. Please try again later\./),
      ).toBeTruthy(),
    );
  });
});
