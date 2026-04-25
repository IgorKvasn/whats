use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub include_preview: bool,
    #[serde(default = "default_auto_update_check_enabled")]
    pub auto_update_check_enabled: bool,
    #[serde(default)]
    pub update_state: UpdateState,
}

fn default_auto_update_check_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateState {
    #[serde(default)]
    pub last_checked_at: Option<i64>,
    #[serde(default)]
    pub skipped_version: Option<String>,
    #[serde(default)]
    pub consecutive_failures: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
            auto_update_check_enabled: true,
            update_state: UpdateState::default(),
        }
    }
}

impl Settings {
    pub fn load_or_default(path: &Path) -> Settings {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                eprintln!("settings: corrupt file, using defaults: {err}");
                Settings::default()
            }),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Settings::default(),
            Err(err) => {
                eprintln!("settings: read failed, using defaults: {err}");
                Settings::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = tmp_path(path);
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&tmp, &json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_when_file_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings::load_or_default(&path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings {
            notifications_enabled: false,
            sound_enabled: false,
            include_preview: true,
            auto_update_check_enabled: true,
            update_state: UpdateState::default(),
        };
        s.save(&path).unwrap();
        let loaded = Settings::load_or_default(&path);
        assert_eq!(loaded, s);
    }

    #[test]
    fn corrupt_file_returns_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, b"{not valid json").unwrap();
        let s = Settings::load_or_default(&path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn atomic_save_leaves_no_tmp_on_success() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        Settings::default().save(&path).unwrap();
        assert!(path.exists());
        assert!(!tmp_path(&path).exists());
    }

    #[test]
    fn save_creates_parent_directory() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/sub/settings.json");
        Settings::default().save(&path).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn defaults_have_auto_update_enabled() {
        let s = Settings::default();
        assert!(s.auto_update_check_enabled);
        assert!(s.update_state.last_checked_at.is_none());
        assert!(s.update_state.skipped_version.is_none());
        assert_eq!(s.update_state.consecutive_failures, 0);
    }

    #[test]
    fn legacy_settings_file_loads_with_defaults_filled_in() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Old shape: only the original three fields, no auto-update fields
        fs::write(
            &path,
            br#"{"notifications_enabled":true,"sound_enabled":false,"include_preview":true}"#,
        )
        .unwrap();
        let s = Settings::load_or_default(&path);
        assert_eq!(s.notifications_enabled, true);
        assert_eq!(s.sound_enabled, false);
        assert_eq!(s.include_preview, true);
        assert!(s.auto_update_check_enabled, "missing field should default to true");
        assert_eq!(s.update_state.consecutive_failures, 0);
        assert!(s.update_state.last_checked_at.is_none());
        assert!(s.update_state.skipped_version.is_none());
    }

    #[test]
    fn round_trip_with_update_state() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
            auto_update_check_enabled: false,
            update_state: UpdateState {
                last_checked_at: Some(1_700_000_000),
                skipped_version: Some("v0.2.0".to_string()),
                consecutive_failures: 2,
            },
        };
        s.save(&path).unwrap();
        let loaded = Settings::load_or_default(&path);
        assert_eq!(loaded, s);
    }
}
