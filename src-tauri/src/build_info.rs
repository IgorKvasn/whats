use serde::Serialize;

const BUILD_TIMESTAMP: &str = env!("WHATS_BUILD_TIMESTAMP");

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BuildInfo {
    pub build_timestamp: String,
}

pub fn build_timestamp_text(timestamp: &str) -> String {
    timestamp.trim().to_string()
}

pub fn current_build_info() -> BuildInfo {
    BuildInfo {
        build_timestamp: build_timestamp_text(BUILD_TIMESTAMP),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_explicit_timezone_offset_in_build_timestamp() {
        let formatted = build_timestamp_text("2026-04-25 14:23:11 +02:00");
        assert!(formatted.contains("+02:00"));
        assert!(formatted.starts_with("2026-04-25 14:23:11"));
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(
            build_timestamp_text(" 2026-04-25 14:23:11 +02:00 \n"),
            "2026-04-25 14:23:11 +02:00"
        );
    }
}
