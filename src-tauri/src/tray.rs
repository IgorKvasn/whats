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
