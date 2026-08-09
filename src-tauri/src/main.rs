#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "desktop-e2e")]
use tauri::Manager;

#[cfg(feature = "desktop-e2e")]
const DESKTOP_E2E_CAPABILITY: &str = r#"{
  "identifier": "desktop-e2e-webdriver",
  "description": "WebDriver permission loaded only by the native runner-test build",
  "windows": ["main"],
  "permissions": ["wdio-webdriver:default"]
}"#;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(feature = "desktop-e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .setup(|app| {
            // Keep the WebDriver ACL marker out of the generated production
            // context. This permission currently grants no IPC commands; the
            // feature-gated plugin exposes its test server over loopback HTTP.
            app.add_capability(DESKTOP_E2E_CAPABILITY)?;
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("Midori Kanjo could not start");
}
