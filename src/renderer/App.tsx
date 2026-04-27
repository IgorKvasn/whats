import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { getBuildInfo, type BuildInfo } from './buildInfoApi';
import {
  getSettings,
  previewNotification,
  previewSound,
  setSettings,
  type Settings,
} from './settingsApi';
import {
  checkForUpdatesNow,
  getUpdateInfo,
  setSkippedVersion,
  type ManualCheckResult,
  type UpdateInfo,
} from './updateApi';
import './styles.css';

const viewParam = new URLSearchParams(window.location.search).get('view');

export default function App() {
  if (viewParam === 'about') return <AboutView />;
  if (viewParam === 'update') return <UpdateView />;
  return <SettingsView />;
}

function SettingsView() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'up_to_date'; current: string }
    | { kind: 'failed' }
  >({ kind: 'idle' });
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSettings().then(setLocal).catch((e) => setError(String(e)));
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    setUpdateCheckStatus({ kind: 'idle' });
    try {
      await setSettings(next);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSavedVisible(true);
      savedTimerRef.current = setTimeout(() => setSavedVisible(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCheckNow() {
    setUpdateCheckStatus({ kind: 'checking' });
    try {
      const result: ManualCheckResult = await checkForUpdatesNow();
      if (result.status === 'update_available') {
        setUpdateCheckStatus({ kind: 'idle' });
      } else if (result.status === 'up_to_date') {
        setUpdateCheckStatus({ kind: 'up_to_date', current: result.current });
      } else {
        setUpdateCheckStatus({ kind: 'failed' });
      }
    } catch {
      setUpdateCheckStatus({ kind: 'failed' });
    }
  }

  if (error) return <div className="settings"><p className="err">Error: {error}</p></div>;
  if (!settings) return <div className="settings"><p>Loading…</p></div>;

  return (
    <div className="dialog settings">
      <h1>Settings</h1>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.notificationsEnabled}
          onChange={(e) => update({ notificationsEnabled: e.target.checked })}
        />
        <span>Show notifications</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.includePreview}
          onChange={(e) => update({ includePreview: e.target.checked })}
          disabled={!settings.notificationsEnabled}
        />
        <span>Include message preview</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewNotification().catch((e) => setError(String(e)))}
          disabled={!settings.notificationsEnabled}
        >
          Preview notification
        </button>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.soundEnabled}
          onChange={(e) => update({ soundEnabled: e.target.checked })}
          disabled={!settings.notificationsEnabled}
        />
        <span>Play sound on notification</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewSound().catch((e) => setError(String(e)))}
          disabled={!settings.notificationsEnabled || !settings.soundEnabled}
        >
          Preview sound
        </button>
      </div>
      <hr />
      <label className="row">
        <input
          type="checkbox"
          checked={settings.autoUpdateCheckEnabled}
          onChange={(e) => update({ autoUpdateCheckEnabled: e.target.checked })}
        />
        <span>Automatically check for updates on startup</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={updateCheckStatus.kind === 'checking'}
        >
          {updateCheckStatus.kind === 'checking' ? 'Checking…' : 'Check for updates now'}
        </button>
      </div>
      {updateCheckStatus.kind === 'up_to_date' && (
        <div className="row">
          <span>You're up to date (v{updateCheckStatus.current}).</span>
        </div>
      )}
      {updateCheckStatus.kind === 'failed' && (
        <div className="row">
          <span className="err">Update check failed. Please try again later.</span>
        </div>
      )}
      <hr />
      <h2>Performance</h2>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.hardwareAccelerationEnabled}
          onChange={(e) => update({ hardwareAccelerationEnabled: e.target.checked })}
        />
        <span>Hardware acceleration (GPU)</span>
      </label>
      <p className="hint">
        Uses the GPU to render the interface. Disabling this reduces memory
        usage by ~100–200 MB but may make scrolling and animations less smooth.
        Requires restart.
      </p>
      <div className={`saved-toast ${savedVisible ? 'visible' : ''}`}>
        Setting saved
      </div>
    </div>
  );
}

function AboutView() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBuildInfo().then(setBuildInfo).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!buildInfo) return <div className="dialog"><p>Loading…</p></div>;

  return (
    <div className="dialog about">
      <h1>About</h1>
      <dl className="details">
        <div className="detail">
          <dt>Version</dt>
          <dd>{buildInfo.version}</dd>
        </div>
        <div className="detail">
          <dt>Build date and time</dt>
          <dd>{buildInfo.buildTimestamp}</dd>
        </div>
      </dl>
    </div>
  );
}

function UpdateView() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipThis, setSkipThis] = useState(false);

  useEffect(() => {
    getUpdateInfo().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  async function persistSkipIfChecked(tag: string) {
    if (skipThis) {
      try {
        await setSkippedVersion(tag);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function handleOpenReleasePage() {
    if (!info) return;
    await persistSkipIfChecked(info.latestVersion);
    try {
      await window.electronAPI.openExternal(info.htmlUrl);
    } catch (e) {
      setError(String(e));
      return;
    }
    window.electronAPI.closeWindow();
  }

  async function handleLater() {
    if (!info) return;
    await persistSkipIfChecked(info.latestVersion);
    window.electronAPI.closeWindow();
  }

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!info) return <div className="dialog"><p>Loading…</p></div>;

  const releasedDisplay = info.releasedAt
    ? new Date(info.releasedAt).toLocaleDateString()
    : '—';

  return (
    <div className="dialog update">
      <h1>Update available</h1>
      <p>A new version of whats is available.</p>
      <dl className="details">
        <div className="detail">
          <dt>Current version</dt>
          <dd>{info.currentVersion}</dd>
        </div>
        <div className="detail">
          <dt>New version</dt>
          <dd>{info.latestVersion}</dd>
        </div>
        <div className="detail">
          <dt>Released</dt>
          <dd>{releasedDisplay}</dd>
        </div>
      </dl>
      {info.bodyExcerpt && (
        <>
          <h2 className="release-notes-heading">Release notes</h2>
          <div className="release-notes">
            <Markdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) window.electronAPI.openExternal(href);
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {info.bodyExcerpt}
            </Markdown>
          </div>
        </>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={skipThis}
          onChange={(e) => setSkipThis(e.target.checked)}
        />
        <span>Don't notify me about this version</span>
      </label>
      <div className="row buttons">
        <button type="button" onClick={handleLater}>Later</button>
        <button type="button" onClick={handleOpenReleasePage}>Open release page</button>
      </div>
    </div>
  );
}
