import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getBuildInfo, type BuildInfo } from './buildInfoApi';
import {
  getSettings,
  previewNotification,
  previewSound,
  setSettings,
  type Settings,
} from './settingsApi';
import './styles.css';

const currentWindowLabel = getCurrentWindow().label;

export default function App() {
  if (currentWindowLabel === 'about') {
    return <AboutView />;
  }

  return <SettingsView />;
}

function SettingsView() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setLocal).catch((e) => setError(String(e)));
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    try {
      await setSettings(next);
    } catch (e) {
      setError(String(e));
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
