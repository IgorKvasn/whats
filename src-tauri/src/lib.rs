mod title_parse;
mod build_info;
mod tray;
mod settings;
mod ipc;
mod notify;
mod windows;
mod updater;

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
                current_update: std::sync::Mutex::new(None),
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

            let auto_check = {
                let state = handle.state::<crate::ipc::AppState>();
                let s = state.settings.lock().unwrap();
                s.auto_update_check_enabled
            };
            if auto_check {
                let handle_for_task = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    crate::updater::run_startup_check(&handle_for_task).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::get_build_info,
            crate::ipc::get_update_info,
            crate::ipc::get_settings,
            crate::ipc::set_settings,
            crate::ipc::check_for_updates_now,
            crate::ipc::set_skipped_version,
            crate::ipc::report_unread,
            crate::ipc::report_disconnected,
            crate::ipc::notify_message,
            crate::ipc::preview_notification,
            crate::ipc::preview_sound,
            crate::ipc::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
