use crate::settings::Settings;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

pub fn dispatch(app: &AppHandle, settings: Settings, sender: &str, body: Option<&str>) {
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
    show(app, sender, body_text, settings.sound_enabled);
}

pub fn preview(app: &AppHandle, with_sound: bool) {
    let body = if with_sound {
        "Sound preview"
    } else {
        "Notification preview"
    };
    show(app, "WhatsApp", body, with_sound);
}

pub fn update_check_failed(app: &AppHandle, settings: &Settings) {
    if !settings.notifications_enabled {
        eprintln!("notify::update_check_failed: skipped (notifications_enabled=false)");
        return;
    }
    show(
        app,
        "WhatsApp",
        "Couldn't check for updates — please verify your internet connection.",
        false,
    );
}

const SOUND_FILE: &str = "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga";

static APP_IMAGE_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
const OPEN_ACTION_ID: &str = "open";

fn app_image_path(app: &AppHandle) -> Option<&'static PathBuf> {
    APP_IMAGE_PATH
        .get_or_init(|| {
            let resource_dir = app.path().resource_dir().ok()?;
            for candidate in ["icons/128x128.png", "icons/icon.png", "icons/32x32.png"] {
                let p = resource_dir.join(candidate);
                if p.is_file() {
                    return Some(p);
                }
            }
            None
        })
        .as_ref()
}

fn is_open_action_output(line: &str) -> bool {
    line.trim() == OPEN_ACTION_ID
}

fn show(app: &AppHandle, title: &str, body: &str, with_sound: bool) {
    let mut cmd = Command::new("notify-send");
    cmd.arg("-a").arg("WhatsApp");
    if let Some(image) = app_image_path(app) {
        cmd.arg(format!("--hint=string:image-path:{}", image.display()));
    }
    cmd.arg(format!("--action={OPEN_ACTION_ID}=Open"))
        .arg("--")
        .arg(title)
        .arg(body)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let child = cmd.spawn();
    match child {
        Ok(mut child) => {
            eprintln!("notify: spawned title={title:?} body_len={} sound={with_sound}", body.len());
            let stdout = child.stdout.take();
            let app_handle = app.clone();
            std::thread::spawn(move || {
                if let Some(out) = stdout {
                    let reader = BufReader::new(out);
                    for line in reader.lines().map_while(Result::ok) {
                        if is_open_action_output(&line) {
                            eprintln!("notify: open action invoked, showing main window");
                            let _ = app_handle.run_on_main_thread({
                                let app_handle = app_handle.clone();
                                move || crate::windows::show_main(&app_handle)
                            });
                            break;
                        }
                    }
                }
                let _ = child.wait();
            });
        }
        Err(e) => eprintln!("notify: FAILED title={title:?}: {e}"),
    }
    if with_sound {
        if let Err(e) = Command::new("paplay").arg(SOUND_FILE).spawn() {
            eprintln!("notify: paplay failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_open_action_output;

    #[test]
    fn only_open_button_output_activates_window() {
        assert!(is_open_action_output("open"));
        assert!(is_open_action_output(" open \n"));
        assert!(!is_open_action_output("default"));
        assert!(!is_open_action_output(""));
    }
}
