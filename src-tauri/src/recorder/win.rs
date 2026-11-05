use std::{ffi::c_void, path::PathBuf, time::Duration};

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
        VideoSettingsSubType,
    },
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

use crate::error::AppError;

pub fn hwnd_of(window: &WebviewWindow) -> Result<*mut c_void, AppError> {
    let handle = window.window_handle().map_err(|error| {
        AppError::Recorder(format!(
            "Could not access the native window handle: {error}"
        ))
    })?;

    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => Ok(win32.hwnd.get() as *mut c_void),
        other => Err(AppError::Recorder(format!(
            "Unexpected window handle type: {other:?}"
        ))),
    }
}

pub fn title_bar_height(hwnd: *mut c_void) -> Result<u32, AppError> {
    Window::from_raw_hwnd(hwnd)
        .title_bar_height()
        .map_err(|error| AppError::Recorder(format!("Could not inspect window chrome: {error}")))
}

pub fn is_capturable(hwnd: *mut c_void) -> bool {
    Window::from_raw_hwnd(hwnd).is_valid()
}

struct RecorderFlags {
    encoder: VideoEncoder,
    app: AppHandle,
}

struct Recorder {
    encoder: Option<VideoEncoder>,
    app: AppHandle,
}

impl GraphicsCaptureApiHandler for Recorder {
    type Flags = RecorderFlags;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let flags = context.flags;
        let _ = flags.app.emit("recorder://started", ());
        Ok(Self {
            encoder: Some(flags.encoder),
            app: flags.app,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame<'_>,
        _control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if let Some(encoder) = self.encoder.as_mut() {
            encoder
                .send_frame(frame)
                .map_err(|error| format!("frame encode failed: {error}"))?;
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        if let Some(encoder) = self.encoder.take() {
            if let Err(error) = encoder.finish() {
                tracing::warn!(%error, "failed to finalize MP4 after the window closed");
            }
        }
        let _ = self.app.emit("recorder://closed", ());
        Ok(())
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        if let Some(encoder) = self.encoder.take() {
            if let Err(error) = encoder.finish() {
                tracing::warn!(%error, "failed to finalize MP4 while stopping the recorder");
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn start_capture(
    hwnd: *mut c_void,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    include_cursor: bool,
    output: PathBuf,
    app: AppHandle,
) -> Result<Box<dyn FnOnce() -> Result<(), String> + Send>, AppError> {
    // Explicit H.264: the crate defaults to HEVC, which many editors and
    // browsers refuse to play.
    let video = VideoSettingsBuilder::new(width, height)
        .sub_type(VideoSettingsSubType::H264)
        .bitrate(bitrate)
        .frame_rate(fps);

    let encoder = VideoEncoder::new(
        video,
        AudioSettingsBuilder::default().disabled(true),
        ContainerSettingsBuilder::default(),
        &output,
    )
    .map_err(|error| {
        AppError::Recorder(format!("Could not create the H.264 MP4 encoder: {error}"))
    })?;

    let window = Window::from_raw_hwnd(hwnd);
    let cursor = if include_cursor {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::WithoutCursor
    };

    let settings = Settings::new(
        window,
        cursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis((1_000 / fps.max(1)) as u64)),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        RecorderFlags { encoder, app },
    );

    let control = match Recorder::start_free_threaded(settings) {
        Ok(control) => control,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            return Err(AppError::Recorder(format!(
                "Could not start Windows Graphics Capture: {error}"
            )));
        }
    };

    Ok(Box::new(move || {
        control.stop().map_err(|error| error.to_string())
    }))
}
