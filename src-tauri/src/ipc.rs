use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};

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
pub fn report_unread(app: AppHandle, count: u32) {
    crate::tray::update(&app, Some(count), None);
}

#[tauri::command]
pub fn report_disconnected(app: AppHandle, disconnected: bool) {
    crate::tray::update(&app, None, Some(disconnected));
}

#[tauri::command]
pub fn notify_message(
    app: AppHandle,
    state: State<'_, AppState>,
    sender: String,
    body: Option<String>,
) {
    let settings = *state.settings.lock().unwrap();
    crate::notify::dispatch(&app, settings, &sender, body.as_deref());
}
