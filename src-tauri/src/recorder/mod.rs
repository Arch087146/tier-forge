use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::error::AppError;
use crate::state::{AppState, RecordingSession};

#[cfg(target_os = "windows")]
mod win;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRecordingRequest {
    pub fps: Option<u32>,
    pub bitrate: Option<u32>,
    pub include_cursor: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    pub output: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub output: String,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub recording: bool,
    pub elapsed_ms: u64,
    pub output: Option<String>,
    pub width: u32,
    pub height: u32,
}

pub fn start(
    app: &AppHandle,
    state: &AppState,
    req: StartRecordingRequest,
) -> Result<RecordingStarted, AppError> {
    if state
        .recording
        .lock()
        .map_err(|_| AppError::Recorder("Recording state lock poisoned.".into()))?
        .is_some()
    {
        return Err(AppError::Recorder(
            "A recording is already in progress.".into(),
        ));
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Recorder("Main window not found.".into()))?;

    if window.is_minimized().unwrap_or(false) {
        return Err(AppError::Recorder(
            "Restore the window before recording.".into(),
        ));
    }

    let size = window
        .inner_size()
        .map_err(|error| AppError::Recorder(format!("Could not read window size: {error}")))?;

    // H.264 requires even dimensions.
    let width = size.width & !1;
    let height = size.height & !1;

    if width < 320 || height < 240 {
        return Err(AppError::Recorder(
            "The window is too small to record. Resize it and try again.".into(),
        ));
    }

    let fps = req.fps.unwrap_or(30).clamp(15, 60);
    let bitrate = req
        .bitrate
        .unwrap_or_else(|| default_bitrate(width, height, fps));
    let include_cursor = req.include_cursor.unwrap_or(true);

    let output = state.video_dir.join(format!(
        "tierforge-{}-{}.mp4",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    ));

    #[cfg(target_os = "windows")]
    let stop = {
        let hwnd = win::hwnd_of(&window)?;

        // Hard invariant: never encode OS chrome. `decorations: false` in
        // tauri.conf.json makes this zero; a decorated window is rejected.
        if win::title_bar_height(hwnd)? > 0 {
            return Err(AppError::Recorder(
                "Recording requires the borderless window mode (decorations: false).".into(),
            ));
        }

        if !win::is_capturable(hwnd) {
            return Err(AppError::Recorder(
                "The window is not capturable yet. Make sure it is visible and try again.".into(),
            ));
        }

        win::start_capture(
            hwnd,
            width,
            height,
            fps,
            bitrate,
            include_cursor,
            output.clone(),
            app.clone(),
        )?
    };

    #[cfg(not(target_os = "windows"))]
    let stop: Box<dyn FnOnce() -> Result<(), String> + Send> = {
        let _ = (&include_cursor, &output, fps, bitrate);
        return Err(AppError::Recorder(
            "The native recorder is currently Windows-only. Run the app on Windows to record."
                .into(),
        ));
    };

    // WGC delivers frames at the window's current client size. Freezing the
    // geometry prevents an encoder/frame-size mismatch mid-session.
    let _ = window.set_resizable(false);
    let _ = window.set_title("TierForge — REC");

    position_hud(app, &window);
    if let Some(hud) = app.get_webview_window("recorder") {
        let _ = hud.show();
    }

    let output_string = output.to_string_lossy().into_owned();
    let session = RecordingSession {
        stop,
        output,
        started: Instant::now(),
        width,
        height,
    };

    *state
        .recording
        .lock()
        .map_err(|_| AppError::Recorder("Recording state lock poisoned.".into()))? = Some(session);

    let _ = app.emit(
        "recorder://state",
        serde_json::json!({ "recording": true, "output": output_string }),
    );

    Ok(RecordingStarted {
        output: output_string,
        width,
        height,
    })
}

pub async fn stop(app: AppHandle, state: &AppState) -> Result<RecordingResult, AppError> {
    let session = {
        let mut guard = state
            .recording
            .lock()
            .map_err(|_| AppError::Recorder("Recording state lock poisoned.".into()))?;
        guard.take()
    };

    let Some(session) = session else {
        return Err(AppError::Recorder("No recording is in progress.".into()));
    };

    let RecordingSession {
        stop,
        output,
        started,
        width,
        height,
    } = session;

    let duration_ms = started.elapsed().as_millis() as u64;

    let stop_result = tauri::async_runtime::spawn_blocking(move || stop()).await;

    // Always restore the app chrome, even if the recorder thread panicked.
    restore_window(&app);

    let stop_result = stop_result
        .map_err(|error| AppError::Recorder(format!("Recorder thread failed: {error}")))?;

    let output_string = output.to_string_lossy().into_owned();

    let result: Result<(), AppError> = match stop_result {
        Ok(()) => {
            let size = std::fs::metadata(&output)
                .map(|meta| meta.len())
                .unwrap_or(0);
            if size == 0 {
                Err(AppError::Recorder(format!(
                    "The encoder produced no data at {output_string}."
                )))
            } else {
                Ok(())
            }
        }
        Err(error) => Err(AppError::Recorder(error)),
    };

    match &result {
        Ok(()) => {
            let _ = app.emit(
                "recorder://state",
                serde_json::json!({ "recording": false, "output": output_string.clone() }),
            );
        }
        Err(error) => {
            let _ = app.emit(
                "recorder://state",
                serde_json::json!({ "recording": false, "error": error.to_string() }),
            );
        }
    }

    result?;

    Ok(RecordingResult {
        output: output_string,
        duration_ms,
        width,
        height,
    })
}

pub fn status(state: &AppState) -> RecordingStatus {
    let Ok(guard) = state.recording.lock() else {
        return RecordingStatus {
            recording: false,
            elapsed_ms: 0,
            output: None,
            width: 0,
            height: 0,
        };
    };

    match guard.as_ref() {
        Some(session) => RecordingStatus {
            recording: true,
            elapsed_ms: session.started.elapsed().as_millis() as u64,
            output: Some(session.output.to_string_lossy().into_owned()),
            width: session.width,
            height: session.height,
        },
        None => RecordingStatus {
            recording: false,
            elapsed_ms: 0,
            output: None,
            width: 0,
            height: 0,
        },
    }
}

fn restore_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_resizable(true);
        let _ = window.set_title("TierForge");
    }
    if let Some(hud) = app.get_webview_window("recorder") {
        let _ = hud.hide();
    }
}

fn position_hud(app: &AppHandle, main: &WebviewWindow) {
    let Some(hud) = app.get_webview_window("recorder") else {
        return;
    };

    if let (Ok(position), Ok(size), Ok(hud_size)) =
        (main.outer_position(), main.outer_size(), hud.outer_size())
    {
        // Work in physical pixels so the HUD stays centered on HiDPI displays.
        let margin = 24_i32;
        let x = position.x + (size.width as i32 - hud_size.width as i32) / 2;
        let y = position.y + size.height as i32 - hud_size.height as i32 - margin;
        let _ = hud.set_position(PhysicalPosition::new(x.max(position.x), y.max(position.y)));
    }
}

fn default_bitrate(width: u32, height: u32, fps: u32) -> u32 {
    let pixels = width as u64 * height as u64;
    let base = if pixels >= 1920 * 1080 {
        10_000_000
    } else if pixels >= 1280 * 720 {
        7_000_000
    } else {
        4_000_000
    };

    ((base as u64 * fps as u64) / 30).min(u32::MAX as u64) as u32
}
