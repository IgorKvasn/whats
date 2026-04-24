// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod title_parse;
mod tray;
mod settings;
mod ipc;
mod notify;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            use tauri::Manager;
            let settings_path = app
                .path()
                .app_data_dir()
                .expect("app data dir available")
                .join("settings.json");
            let settings = crate::settings::Settings::load_or_default(&settings_path);
            app.manage(crate::ipc::AppState {
                settings: std::sync::Mutex::new(settings),
                settings_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::get_settings,
            crate::ipc::set_settings,
            crate::ipc::report_unread,
            crate::ipc::report_disconnected,
            crate::ipc::notify_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
