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

const fakeInfo = {
  currentVersion: '0.1.0',
  latestVersion: 'v0.2.0',
  releaseName: 'v0.2.0',
  releasedAt: '2026-04-25T12:00:00Z',
  bodyExcerpt: 'fixed stuff',
  htmlUrl: 'https://github.com/IgorKvasn/whats/releases/tag/v0.2.0',
};

beforeEach(() => {
  cleanup();
  vi.resetModules();
  Object.values(mockElectronAPI).forEach((fn) => fn.mockReset());
  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

  Object.defineProperty(window, 'location', {
    value: { search: '?view=update' },
    writable: true,
  });
});

describe('UpdateView', () => {
  it('renders version comparison and release notes', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Update available'));
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('fixed stuff')).toBeTruthy();
  });

  it('Open release page calls openExternal and closes the window', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    mockElectronAPI.openExternal.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Open release page'));
    fireEvent.click(screen.getByText('Open release page'));
    await waitFor(() => expect(mockElectronAPI.openExternal).toHaveBeenCalledWith(fakeInfo.htmlUrl));
    expect(mockElectronAPI.closeWindow).toHaveBeenCalled();
  });

  it('Later with skip-checkbox persists skipped version then closes', async () => {
    mockElectronAPI.getUpdateInfo.mockResolvedValue(fakeInfo);
    mockElectronAPI.setSkippedVersion.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Later'));
    fireEvent.click(screen.getByLabelText("Don't notify me about this version"));
    fireEvent.click(screen.getByText('Later'));
    await waitFor(() =>
      expect(mockElectronAPI.setSkippedVersion).toHaveBeenCalledWith('v0.2.0'),
    );
    expect(mockElectronAPI.closeWindow).toHaveBeenCalled();
  });
});
