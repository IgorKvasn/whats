use crate::settings::Settings;
use std::process::Command;
use tauri::AppHandle;

pub fn dispatch(_app: &AppHandle, settings: Settings, sender: &str, body: Option<&str>) {
    if !settings.notifications_enabled {
        eprintln!("notify::dispatch: skipped (notifications_enabled=false)");
        return;
    }
    let body_text = if settings.include_preview {
        body.unwrap_or("")
    } else {
        ""
    };
    eprintln!(
        "notify::dispatch: forwarding to show() sender={sender:?} body_len={} sound={}",
        body_text.len(),
        settings.sound_enabled
    );
    show(sender, body_text, settings.sound_enabled);
}

pub fn preview(_app: &AppHandle, with_sound: bool) {
    let body = if with_sound {
        "Sound preview"
    } else {
        "Notification preview"
    };
    show("WhatsApp", body, with_sound);
}

const SOUND_FILE: &str = "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga";

fn show(title: &str, body: &str, with_sound: bool) {
    let status = Command::new("notify-send")
        .arg("-a").arg("WhatsApp")
        .arg("-i").arg("dialog-information")
        .arg("--")
        .arg(title)
        .arg(body)
        .status();
    match status {
        Ok(s) if s.success() => eprintln!("notify: shown title={title:?} body_len={} sound={with_sound}", body.len()),
        Ok(s) => eprintln!("notify: notify-send exited with {s}"),
        Err(e) => eprintln!("notify: FAILED title={title:?}: {e}"),
    }
    if with_sound {
        if let Err(e) = Command::new("paplay").arg(SOUND_FILE).spawn() {
            eprintln!("notify: paplay failed: {e}");
        }
    }
}
