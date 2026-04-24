#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Normal,
    Unread,
    Disconnected,
}

impl TrayState {
    pub fn derive(unread: u32, disconnected: bool) -> TrayState {
        if disconnected {
            TrayState::Disconnected
        } else if unread > 0 {
            TrayState::Unread
        } else {
            TrayState::Normal
        }
    }
}

use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager};

pub struct TrayHandle {
    pub icon: TrayIcon,
    pub state: Mutex<TrayState>,
    pub unread: Mutex<u32>,
    pub disconnected: Mutex<bool>,
}

pub fn build_tray(app: &App) -> tauri::Result<TrayHandle> {
    let show = MenuItemBuilder::with_id("show", "Show WhatsApp").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings, &quit])
        .build()?;

    let icon_bytes = include_bytes!("../icons/tray-normal.png");
    let image = Image::from_bytes(icon_bytes)?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(image)
        .tooltip("WhatsApp")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::windows::show_main(app),
            "settings" => crate::windows::show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows::toggle_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(TrayHandle {
        icon: tray,
        state: Mutex::new(TrayState::Normal),
        unread: Mutex::new(0),
        disconnected: Mutex::new(false),
    })
}

pub fn update(app: &AppHandle, unread_opt: Option<u32>, disc_opt: Option<bool>) {
    let handle = match app.try_state::<TrayHandle>() {
        Some(h) => h,
        None => return,
    };
    if let Some(u) = unread_opt {
        *handle.unread.lock().unwrap() = u;
    }
    if let Some(d) = disc_opt {
        *handle.disconnected.lock().unwrap() = d;
    }
    let unread = *handle.unread.lock().unwrap();
    let disconnected = *handle.disconnected.lock().unwrap();
    let new_state = TrayState::derive(unread, disconnected);

    let tooltip = match new_state {
        TrayState::Normal => "WhatsApp".to_string(),
        TrayState::Unread => format!("WhatsApp — {unread} unread"),
        TrayState::Disconnected => "WhatsApp — disconnected".to_string(),
    };
    let _ = handle.icon.set_tooltip(Some(&tooltip));

    let mut current = handle.state.lock().unwrap();
    if *current != new_state {
        let bytes: &[u8] = match new_state {
            TrayState::Normal => include_bytes!("../icons/tray-normal.png"),
            TrayState::Unread => include_bytes!("../icons/tray-unread.png"),
            TrayState::Disconnected => include_bytes!("../icons/tray-disconnected.png"),
        };
        if let Ok(img) = Image::from_bytes(bytes) {
            let _ = handle.icon.set_icon(Some(img));
        }
        *current = new_state;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_unread_not_disconnected() {
        assert_eq!(TrayState::derive(0, false), TrayState::Normal);
    }

    #[test]
    fn unread_not_disconnected() {
        assert_eq!(TrayState::derive(1, false), TrayState::Unread);
        assert_eq!(TrayState::derive(42, false), TrayState::Unread);
    }

    #[test]
    fn disconnected_beats_unread() {
        assert_eq!(TrayState::derive(0, true), TrayState::Disconnected);
        assert_eq!(TrayState::derive(5, true), TrayState::Disconnected);
    }
}
