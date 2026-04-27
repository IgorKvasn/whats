import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mockElectronAPI = {
  getBuildInfo: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  previewNotification: vi.fn(),
  previewSound: vi.fn(),
  getUpdateInfo: vi.fn(),
  checkForUpdatesNow: vi.fn(),
  setSkippedVersion: vi.fn(),
  openExternal: vi.fn(),
  closeWindow: vi.fn(),
};

beforeEach(() => {
  cleanup();
  vi.resetModules();
  Object.values(mockElectronAPI).forEach((fn) => fn.mockReset());
  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

  mockElectronAPI.getSettings.mockResolvedValue({
    notificationsEnabled: true,
    soundEnabled: true,
    includePreview: false,
    autoUpdateCheckEnabled: true,
    updateState: {},
  });
  mockElectronAPI.setSettings.mockResolvedValue(undefined);
  mockElectronAPI.checkForUpdatesNow.mockResolvedValue({
    status: 'up_to_date',
    current: '0.1.0',
  });

  Object.defineProperty(window, 'location', {
    value: { search: '?view=settings' },
    writable: true,
  });
});

describe('SettingsView auto-update controls', () => {
  it('renders the auto-update checkbox', async () => {
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Automatically check for updates on startup/i),
      ).toBeTruthy(),
    );
  });

  it('shows "up to date" message after Check now', async () => {
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText(/Check for updates now/i));
    fireEvent.click(screen.getByText(/Check for updates now/i));
    await waitFor(() =>
      expect(screen.getByText(/You're up to date \(v0\.1\.0\)/)).toBeTruthy(),
    );
  });

  it('shows failed message when manual check fails', async () => {
    mockElectronAPI.checkForUpdatesNow.mockResolvedValue({
      status: 'failed',
      error: 'boom',
    });
    const { default: App } = await import('../src/renderer/App');
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
