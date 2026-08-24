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
  reconnectNow: vi.fn(),
  onReconnectStatus: vi.fn(),
  getDownloadPromptInfo: vi.fn(),
  openDownload: vi.fn(),
  revealDownload: vi.fn(),
  dismissDownload: vi.fn(),
};

const fakeSettings = {
  notificationsEnabled: true,
  soundEnabled: true,
  includePreview: false,
  autoUpdateCheckEnabled: true,
  hardwareAccelerationEnabled: true,
  startMinimizedToTray: false,
  downloadPromptEnabled: true,
  updateState: { lastCheckedAt: null, skippedVersion: null, consecutiveFailures: 0 },
};

beforeEach(() => {
  cleanup();
  vi.resetModules();
  Object.values(mockElectronAPI).forEach((fn) => fn.mockReset());
  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

  Object.defineProperty(window, 'location', {
    value: { search: '?view=download-prompt&id=download-1' },
    writable: true,
  });
});

describe('DownloadPromptView', () => {
  it('shows the filename and offers open, reveal, and dismiss', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('invoice.pdf'));
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Reveal')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('withholds the open action when canOpen is false', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'script.sh',
      filePath: '/tmp/script.sh',
      canOpen: false,
    });
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('script.sh'));
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.getByText('Reveal')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('clicking Open calls openDownload with this prompt id', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    mockElectronAPI.openDownload.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(mockElectronAPI.openDownload).toHaveBeenCalledWith('download-1'));
  });

  it('clicking Reveal calls revealDownload with this prompt id', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    mockElectronAPI.revealDownload.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Reveal'));
    fireEvent.click(screen.getByText('Reveal'));
    await waitFor(() => expect(mockElectronAPI.revealDownload).toHaveBeenCalledWith('download-1'));
  });

  it('clicking Dismiss calls dismissDownload with this prompt id', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    mockElectronAPI.dismissDownload.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Dismiss'));
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(mockElectronAPI.dismissDownload).toHaveBeenCalledWith('download-1'));
  });

  it('checking "Don\'t ask again" persists downloadPromptEnabled=false before acting', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    mockElectronAPI.getSettings.mockResolvedValue(fakeSettings);
    mockElectronAPI.setSettings.mockResolvedValue(undefined);
    mockElectronAPI.dismissDownload.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Dismiss'));
    fireEvent.click(screen.getByLabelText("Don't ask again"));
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() =>
      expect(mockElectronAPI.setSettings).toHaveBeenCalledWith({
        ...fakeSettings,
        downloadPromptEnabled: false,
      }),
    );
    expect(mockElectronAPI.dismissDownload).toHaveBeenCalledWith('download-1');
  });

  it('does not persist the preference when "Don\'t ask again" is left unchecked', async () => {
    mockElectronAPI.getDownloadPromptInfo.mockResolvedValue({
      id: 'download-1',
      filename: 'invoice.pdf',
      filePath: '/tmp/invoice.pdf',
      canOpen: true,
    });
    mockElectronAPI.dismissDownload.mockResolvedValue(undefined);
    const { default: App } = await import('../src/renderer/App');
    render(<App />);
    await waitFor(() => screen.getByText('Dismiss'));
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(mockElectronAPI.dismissDownload).toHaveBeenCalledWith('download-1'));
    expect(mockElectronAPI.setSettings).not.toHaveBeenCalled();
  });
});
