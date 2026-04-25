use chrono::{DateTime, Local};

fn build_timestamp() -> String {
    if let Ok(source_date_epoch) = std::env::var("SOURCE_DATE_EPOCH") {
        if let Ok(seconds) = source_date_epoch.parse::<i64>() {
            if let Some(timestamp) = DateTime::from_timestamp(seconds, 0) {
                return timestamp.format("%Y-%m-%d %H:%M:%S %:z").to_string();
            }
        }
    }

    Local::now().format("%Y-%m-%d %H:%M:%S %:z").to_string()
}

fn main() {
    println!("cargo:rustc-env=WHATS_BUILD_TIMESTAMP={}", build_timestamp());
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
    tauri_build::build()
}
