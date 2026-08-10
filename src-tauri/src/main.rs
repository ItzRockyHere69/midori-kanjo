#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[cfg(feature = "desktop-e2e")]
const DESKTOP_E2E_CAPABILITY: &str = r#"{
  "identifier": "desktop-e2e-webdriver",
  "description": "WebDriver permission loaded only by the native runner-test build",
  "windows": ["main"],
  "permissions": ["wdio-webdriver:default"]
}"#;

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let builder = tauri::Builder::default()
        // Single-instance must be registered first so a second launch cannot
        // race the existing IndexedDB profile or its cloud-sync worker.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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

    let app = builder
        .build(tauri::generate_context!())
        .expect("Midori Kanjo could not start");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                focus_main_window(app_handle);
            }
        }
    });
}
