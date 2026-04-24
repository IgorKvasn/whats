import { useEffect, useState } from 'react';
import { getSettings, setSettings, type Settings } from './settingsApi';
import './styles.css';

export default function App() {
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
    <div className="settings">
      <h1>Settings</h1>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.notifications_enabled}
          onChange={(e) => update({ notifications_enabled: e.target.checked })}
        />
        <span>Show notifications</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.sound_enabled}
          onChange={(e) => update({ sound_enabled: e.target.checked })}
          disabled={!settings.notifications_enabled}
        />
        <span>Play sound on notification</span>
      </label>
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
