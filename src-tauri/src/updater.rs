use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub released_at: String,
    pub body_excerpt: String,
    pub html_url: String,
}

pub fn decide_update(
    current: &str,
    latest_tag: &str,
    skipped_version: Option<&str>,
) -> Option<UpdateInfo> {
    if let Some(skipped) = skipped_version {
        if skipped == latest_tag {
            return None;
        }
    }

    let current_v = match semver::Version::parse(strip_v(current)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("updater: failed to parse current version {current:?}: {e}");
            return None;
        }
    };
    let latest_v = match semver::Version::parse(strip_v(latest_tag)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("updater: failed to parse latest tag {latest_tag:?}: {e}");
            return None;
        }
    };

    if latest_v <= current_v {
        return None;
    }

    Some(UpdateInfo {
        current_version: current.to_string(),
        latest_version: latest_tag.to_string(),
        release_name: String::new(),
        released_at: String::new(),
        body_excerpt: String::new(),
        html_url: String::new(),
    })
}

fn strip_v(s: &str) -> &str {
    s.strip_prefix('v').unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_release_returns_some() {
        let info = decide_update("0.1.0", "v0.2.0", None);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.current_version, "0.1.0");
        assert_eq!(info.latest_version, "v0.2.0");
    }

    #[test]
    fn equal_versions_returns_none() {
        assert!(decide_update("0.2.0", "v0.2.0", None).is_none());
        assert!(decide_update("0.2.0", "0.2.0", None).is_none());
    }

    #[test]
    fn older_release_returns_none() {
        assert!(decide_update("0.3.0", "v0.2.0", None).is_none());
    }

    #[test]
    fn semver_compare_not_lexical() {
        // 0.10.0 > 0.2.0 in semver, but < lexically
        assert!(decide_update("0.2.0", "v0.10.0", None).is_some());
    }

    #[test]
    fn skipped_exact_match_returns_none() {
        assert!(decide_update("0.1.0", "v0.2.0", Some("v0.2.0")).is_none());
        // also matches without v-prefix variation: skip is "v0.2.0", tag is "v0.2.0"
    }

    #[test]
    fn skipped_older_than_latest_does_not_suppress() {
        // user skipped v0.1.5; v0.2.0 has since been released — they should still see it
        assert!(decide_update("0.1.0", "v0.2.0", Some("v0.1.5")).is_some());
    }

    #[test]
    fn garbage_versions_return_none_no_panic() {
        assert!(decide_update("not-a-version", "v0.2.0", None).is_none());
        assert!(decide_update("0.1.0", "not-a-version", None).is_none());
        assert!(decide_update("", "", None).is_none());
    }
}
