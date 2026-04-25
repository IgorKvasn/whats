use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const SETTINGS_LABEL: &str = "settings";
const ABOUT_LABEL: &str = "about";
const UPDATE_LABEL: &str = "update";

pub fn main_in_foreground(app: &AppHandle) -> bool {
    let Some(w) = app.get_webview_window(MAIN_LABEL) else {
        return false;
    };
    w.is_visible().unwrap_or(false)
        && !w.is_minimized().unwrap_or(false)
        && w.is_focused().unwrap_or(false)
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

pub fn show_settings(app: &AppHandle) {
    show_dialog_window(
        app,
        SETTINGS_LABEL,
        "WhatsApp — Settings",
        480.0,
        360.0,
        320.0,
        240.0,
    );
}

pub fn show_about(app: &AppHandle) {
    show_dialog_window(
        app,
        ABOUT_LABEL,
        "WhatsApp — About",
        440.0,
        240.0,
        320.0,
        220.0,
    );
}

pub fn show_update_window(app: &AppHandle) {
    show_dialog_window(
        app,
        UPDATE_LABEL,
        "WhatsApp — Update available",
        480.0,
        420.0,
        360.0,
        320.0,
    );
}

fn show_dialog_window(
    app: &AppHandle,
    label: &str,
    title: &str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .resizable(true)
        .build();
}

pub fn install_close_to_tray(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let tray_present = app.try_state::<crate::tray::TrayHandle>().is_some();
    if !tray_present {
        return;
    }
    let w_clone = w.clone();
    w.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_clone.hide();
        }
    });
}
