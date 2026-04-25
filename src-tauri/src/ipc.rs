use crate::settings::Settings;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub last_notification: Mutex<Option<(Instant, String, String)>>,
}

#[tauri::command]
pub fn get_build_info() -> crate::build_info::BuildInfo {
    crate::build_info::current_build_info()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    *state.settings.lock().unwrap()
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    new_settings: Settings,
) -> Result<(), String> {
    new_settings.save(&state.settings_path).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = new_settings;
    Ok(())
}

#[tauri::command]
pub fn report_unread(app: AppHandle, count: u32) {
    crate::tray::update(&app, Some(count), None);
}

#[tauri::command]
pub fn report_disconnected(app: AppHandle, disconnected: bool) {
    crate::tray::update(&app, None, Some(disconnected));
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !is_safe_external_url(&url) {
        return Err(format!("rejected url scheme: {url}"));
    }
    Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn is_safe_external_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    matches!(
        lower.split_once(':'),
        Some(("http", _)) | Some(("https", _)) | Some(("mailto", _)) | Some(("tel", _))
    )
}

#[tauri::command]
pub fn preview_notification(app: AppHandle) {
    crate::notify::preview(&app, false);
}

#[tauri::command]
pub fn preview_sound(app: AppHandle) {
    crate::notify::preview(&app, true);
}

pub fn should_dispatch(
    last: Option<&(Instant, String, String)>,
    now: Instant,
    sender: &str,
    body: Option<&str>,
    window: Duration,
) -> bool {
    match last {
        None => true,
        Some((last_time, last_sender, last_body)) => {
            let same_payload = last_sender == sender && last_body == body.unwrap_or("");
            !same_payload || now.duration_since(*last_time) >= window
        }
    }
}

#[tauri::command]
pub fn notify_message(
    app: AppHandle,
    state: State<'_, AppState>,
    sender: String,
    body: Option<String>,
) {
    let sender: String = sender.chars().take(200).collect();
    let body: Option<String> = body.map(|b| b.chars().take(1000).collect());
    eprintln!(
        "notify_message: received sender={sender:?} body_len={}",
        body.as_deref().map(str::len).unwrap_or(0)
    );

    if crate::windows::main_in_foreground(&app) {
        eprintln!("notify_message: skipped (main window in foreground)");
        return;
    }

    let now = Instant::now();
    let dedup_window = Duration::from_millis(1500);

    let dispatch = {
        let last = state.last_notification.lock().unwrap();
        should_dispatch(last.as_ref(), now, &sender, body.as_deref(), dedup_window)
    };

    if !dispatch {
        eprintln!("notify_message: deduped sender={sender:?}");
        return;
    }

    {
        let mut last = state.last_notification.lock().unwrap();
        *last = Some((now, sender.clone(), body.clone().unwrap_or_default()));
    }

    let settings = *state.settings.lock().unwrap();
    crate::notify::dispatch(&app, settings, &sender, body.as_deref());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_call_dispatches() {
        let now = Instant::now();
        assert!(should_dispatch(None, now, "Alice", Some("hi"), Duration::from_millis(1500)));
    }

    #[test]
    fn same_payload_within_window_skips() {
        let base = Instant::now();
        let last = (base, "Alice".to_string(), "hi".to_string());
        let now = base + Duration::from_millis(100);
        assert!(!should_dispatch(Some(&last), now, "Alice", Some("hi"), Duration::from_millis(1500)));
    }

    #[test]
    fn same_payload_past_window_dispatches() {
        let base = Instant::now();
        let last = (base, "Alice".to_string(), "hi".to_string());
        let now = base + Duration::from_millis(2000);
        assert!(should_dispatch(Some(&last), now, "Alice", Some("hi"), Duration::from_millis(1500)));
    }

    #[test]
    fn safe_external_url_accepts_web_and_contact_schemes() {
        assert!(is_safe_external_url("https://example.com"));
        assert!(is_safe_external_url("HTTP://example.com"));
        assert!(is_safe_external_url("mailto:a@b.c"));
        assert!(is_safe_external_url("tel:+1234"));
    }

    #[test]
    fn safe_external_url_rejects_dangerous_schemes() {
        assert!(!is_safe_external_url("file:///etc/passwd"));
        assert!(!is_safe_external_url("javascript:alert(1)"));
        assert!(!is_safe_external_url("data:text/html,<script>"));
        assert!(!is_safe_external_url("ssh://host"));
        assert!(!is_safe_external_url("not-a-url"));
        assert!(!is_safe_external_url(""));
    }

    #[test]
    fn different_payload_within_window_dispatches() {
        let base = Instant::now();
        let last = (base, "Alice".to_string(), "hi".to_string());
        let now = base + Duration::from_millis(100);
        assert!(should_dispatch(Some(&last), now, "Bob", Some("hello"), Duration::from_millis(1500)));
    }
}
