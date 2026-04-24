use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub include_preview: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            notifications_enabled: true,
            sound_enabled: true,
            include_preview: false,
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
}
