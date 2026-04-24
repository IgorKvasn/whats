use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
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
pub fn report_unread(_app: AppHandle, count: u32) {
    // Wired up in Task 9.
    let _ = count;
}

#[tauri::command]
pub fn report_disconnected(_app: AppHandle, disconnected: bool) {
    // Wired up in Task 9.
    let _ = disconnected;
}

#[tauri::command]
pub fn notify_message(
    _app: AppHandle,
    _state: State<'_, AppState>,
    sender: String,
    body: Option<String>,
) {
    // Wired up in Task 8.
    let _ = (sender, body);
}
