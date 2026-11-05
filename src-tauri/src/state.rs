use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

/// A live recording. The stop closure owns the `CaptureControl` and is consumed
/// exactly once, on a blocking worker thread.
pub struct RecordingSession {
    pub stop: Box<dyn FnOnce() -> Result<(), String> + Send>,
    pub output: PathBuf,
    pub started: Instant,
    pub width: u32,
    pub height: u32,
}

pub struct AppState {
    pub http: reqwest::Client,
    pub cache_dir: PathBuf,
    pub video_dir: PathBuf,
    pub cancel: Mutex<Option<CancellationToken>>,
    pub recording: Mutex<Option<RecordingSession>>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let cache_dir = app.path().app_cache_dir()?.join("images");
        let video_dir = app
            .path()
            .video_dir()
            .unwrap_or_else(|_| {
                app.path()
                    .app_data_dir()
                    .unwrap_or_else(|_| cache_dir.clone())
            })
            .join("TierForge");

        std::fs::create_dir_all(&cache_dir)?;
        std::fs::create_dir_all(&video_dir)?;

        let http = reqwest::Client::builder()
            .user_agent(concat!(
                "TierForge/",
                env!("CARGO_PKG_VERSION"),
                " (desktop tier list studio)"
            ))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .pool_max_idle_per_host(8)
            .build()?;

        Ok(Self {
            http,
            cache_dir,
            video_dir,
            cancel: Mutex::new(None),
            recording: Mutex::new(None),
        })
    }
}
