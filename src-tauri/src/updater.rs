use reqwest;
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

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseInfo {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    pub html_url: String,
}

#[derive(Debug)]
pub enum FetchOutcome {
    Found(ReleaseInfo),
    NoReleases,
    Failed(String),
}

pub async fn fetch_latest_release(repo: &str, app_version: &str) -> FetchOutcome {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let user_agent = format!("whats-desktop/{app_version}");

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(user_agent)
        .build()
    {
        Ok(c) => c,
        Err(e) => return FetchOutcome::Failed(format!("client build: {e}")),
    };

    let response = match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return FetchOutcome::Failed(format!("request: {e}")),
    };

    let status = response.status();
    if status.as_u16() == 404 {
        return FetchOutcome::NoReleases;
    }
    if !status.is_success() {
        return FetchOutcome::Failed(format!("http {status}"));
    }

    match response.json::<ReleaseInfo>().await {
        Ok(info) => FetchOutcome::Found(info),
        Err(e) => FetchOutcome::Failed(format!("parse: {e}")),
    }
}

pub fn body_excerpt(body: Option<&str>, max_chars: usize) -> String {
    let raw = body.unwrap_or("").trim();
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    let truncated: String = raw.chars().take(max_chars).collect();
    format!("{truncated}…")
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

    #[test]
    fn body_excerpt_short_returns_input() {
        assert_eq!(body_excerpt(Some("hello"), 500), "hello");
    }

    #[test]
    fn body_excerpt_trims_whitespace() {
        assert_eq!(body_excerpt(Some("  hi  "), 500), "hi");
    }

    #[test]
    fn body_excerpt_none_returns_empty() {
        assert_eq!(body_excerpt(None, 500), "");
    }

    #[test]
    fn body_excerpt_truncates_with_ellipsis() {
        let long = "a".repeat(600);
        let out = body_excerpt(Some(&long), 500);
        assert_eq!(out.chars().count(), 501); // 500 + ellipsis char
        assert!(out.ends_with('…'));
    }
}
