use crate::settings::Settings;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn dispatch(app: &AppHandle, settings: Settings, sender: &str, body: Option<&str>) {
    if !settings.notifications_enabled {
        return;
    }
    let mut builder = app.notification().builder().title(sender);
    if settings.include_preview {
        if let Some(b) = body {
            builder = builder.body(b);
        }
    }
    if settings.sound_enabled {
        builder = builder.sound("default");
    }
    if let Err(err) = builder.show() {
        eprintln!("notify: failed to show notification: {err}");
    }
}
