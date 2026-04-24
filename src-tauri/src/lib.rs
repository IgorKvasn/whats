mod title_parse;
mod tray;
mod settings;
mod ipc;
mod notify;
mod windows;

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
                last_notification: std::sync::Mutex::new(None),
            });
            let tray_handle = crate::tray::build_tray(app)?;
            app.manage(tray_handle);

            let inject_path = app
                .path()
                .resource_dir()?
                .join("resources/inject.js");
            let inject_js = std::fs::read_to_string(&inject_path)
                .unwrap_or_else(|e| {
                    eprintln!("inject.js not found at {inject_path:?}: {e}");
                    String::new()
                });

            let _main = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External("https://web.whatsapp.com/".parse().unwrap()),
            )
            .title("WhatsApp")
            .inner_size(1200.0, 800.0)
            .min_inner_size(600.0, 400.0)
            .initialization_script(&inject_js)
            .build()?;

            let handle = app.handle().clone();
            crate::windows::install_close_to_tray(&handle);
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
