mod ai;
mod commands;
mod error;
mod images;
mod recorder;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("tier_forge_lib=info,warn")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle().clone();
                    let recording = app
                        .state::<AppState>()
                        .recording
                        .lock()
                        .map(|guard| guard.is_some())
                        .unwrap_or(false);

                    if recording {
                        // Finalize the MP4 before the process goes away. The
                        // WGC handler also finalizes on window close, but the
                        // process must stay alive long enough for it to finish.
                        api.prevent_close();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<AppState>();
                            let _ = recorder::stop(app.clone(), state.inner()).await;
                            if let Some(hud) = app.get_webview_window("recorder") {
                                let _ = hud.close();
                            }
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.close();
                            }
                        });
                    } else if let Some(hud) = app.get_webview_window("recorder") {
                        // The hidden HUD counts as a window; close it so the
                        // app can exit when the main window goes away.
                        let _ = hud.close();
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if let Some(hud) = window.app_handle().get_webview_window("recorder") {
                        let _ = hud.close();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::populate_board,
            commands::cancel_populate,
            commands::set_api_key,
            commands::has_api_key,
            commands::clear_api_key,
            commands::import_image,
            commands::reveal_recording,
            commands::start_recording,
            commands::stop_recording,
            commands::recording_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TierForge");
}
