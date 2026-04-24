#[cfg(test)]
pub fn parse_unread_from_title(title: &str) -> u32 {
    let trimmed = title.trim_start();
    let rest = match trimmed.strip_prefix('(') {
        Some(r) => r,
        None => return 0,
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_parens_is_zero() {
        assert_eq!(parse_unread_from_title("WhatsApp"), 0);
    }

    #[test]
    fn simple_count() {
        assert_eq!(parse_unread_from_title("(3) WhatsApp"), 3);
    }

    #[test]
    fn zero_in_parens() {
        assert_eq!(parse_unread_from_title("(0) WhatsApp"), 0);
    }

    #[test]
    fn large_count() {
        assert_eq!(parse_unread_from_title("(120) WhatsApp"), 120);
    }

    #[test]
    fn empty_string() {
        assert_eq!(parse_unread_from_title(""), 0);
    }

    #[test]
    fn garbage() {
        assert_eq!(parse_unread_from_title("hello world"), 0);
    }

    #[test]
    fn parens_without_number() {
        assert_eq!(parse_unread_from_title("(abc) WhatsApp"), 0);
    }

    #[test]
    fn leading_whitespace() {
        assert_eq!(parse_unread_from_title("  (5) WhatsApp"), 5);
    }
}
