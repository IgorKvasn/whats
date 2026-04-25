import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
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

const currentWindowLabel = getCurrentWindow().label;

export default function App() {
  if (currentWindowLabel === 'about') {
    return <AboutView />;
  }
  if (currentWindowLabel === 'update') {
    return <UpdateView />;
  }
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
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCheckNow() {
    setUpdateCheckStatus({ kind: 'checking' });
    try {
      const result: ManualCheckResult = await checkForUpdatesNow();
      if (result.status === 'update_available') {
        // Update window opened by Rust; clear inline status.
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
          checked={settings.notifications_enabled}
          onChange={(e) => update({ notifications_enabled: e.target.checked })}
        />
        <span>Show notifications</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewNotification().catch((e) => setError(String(e)))}
          disabled={!settings.notifications_enabled}
        >
          Preview notification
        </button>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.sound_enabled}
          onChange={(e) => update({ sound_enabled: e.target.checked })}
          disabled={!settings.notifications_enabled}
        />
        <span>Play sound on notification</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => previewSound().catch((e) => setError(String(e)))}
          disabled={!settings.notifications_enabled || !settings.sound_enabled}
        >
          Preview sound
        </button>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.include_preview}
          onChange={(e) => update({ include_preview: e.target.checked })}
          disabled={!settings.notifications_enabled}
        />
        <span>Include message preview</span>
      </label>
      <hr />
      <label className="row">
        <input
          type="checkbox"
          checked={settings.auto_update_check_enabled}
          onChange={(e) =>
            update({ auto_update_check_enabled: e.target.checked })
          }
        />
        <span>Automatically check for updates on startup</span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={updateCheckStatus.kind === 'checking'}
        >
          {updateCheckStatus.kind === 'checking'
            ? 'Checking…'
            : 'Check for updates now'}
        </button>
      </div>
      {updateCheckStatus.kind === 'up_to_date' && (
        <div className="row">
          <span>You're up to date (v{updateCheckStatus.current}).</span>
        </div>
      )}
      {updateCheckStatus.kind === 'failed' && (
        <div className="row">
          <span className="err">
            Update check failed. Please try again later.
          </span>
        </div>
      )}
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
          <dt>Build date and time</dt>
          <dd>{buildInfo.build_timestamp}</dd>
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
    await persistSkipIfChecked(info.latest_version);
    try {
      await invoke('open_external', { url: info.html_url });
    } catch (e) {
      setError(String(e));
      return;
    }
    await getCurrentWindow().close();
  }

  async function handleLater() {
    if (!info) return;
    await persistSkipIfChecked(info.latest_version);
    await getCurrentWindow().close();
  }

  if (error) return <div className="dialog"><p className="err">Error: {error}</p></div>;
  if (!info) return <div className="dialog"><p>Loading…</p></div>;

  const releasedDisplay = info.released_at
    ? new Date(info.released_at).toLocaleDateString()
    : '—';

  return (
    <div className="dialog update">
      <h1>Update available</h1>
      <p>A new version of whats is available.</p>
      <dl className="details">
        <div className="detail">
          <dt>Current version</dt>
          <dd>{info.current_version}</dd>
        </div>
        <div className="detail">
          <dt>New version</dt>
          <dd>{info.latest_version}</dd>
        </div>
        <div className="detail">
          <dt>Released</dt>
          <dd>{releasedDisplay}</dd>
        </div>
      </dl>
      {info.body_excerpt && (
        <>
          <h2 className="release-notes-heading">Release notes</h2>
          <pre className="release-notes">{info.body_excerpt}</pre>
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
        <button type="button" onClick={handleOpenReleasePage}>
          Open release page
        </button>
      </div>
    </div>
  );
}
