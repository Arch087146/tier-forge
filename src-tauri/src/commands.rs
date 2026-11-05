use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::ai::{self, GenerateRequest, PopulateResult};
use crate::error::AppError;
use crate::images::{self, CachedImage};
use crate::recorder::{
    self, RecordingResult, RecordingStarted, RecordingStatus, StartRecordingRequest,
};
use crate::state::AppState;

#[tauri::command]
pub async fn populate_board(
    app: AppHandle,
    state: State<'_, AppState>,
    req: GenerateRequest,
) -> Result<PopulateResult, AppError> {
    ai::populate(app, state.inner(), req).await
}

#[tauri::command]
pub fn cancel_populate(state: State<'_, AppState>) -> bool {
    match state.cancel.lock() {
        Ok(mut guard) => match guard.take() {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || ai::store_api_key(&provider, &key))
        .await
        .map_err(|error| AppError::Config(error.to_string()))?
}

#[tauri::command]
pub async fn has_api_key(provider: String) -> Result<bool, AppError> {
    Ok(ai::get_api_key(&provider).await.is_ok())
}

#[tauri::command]
pub async fn clear_api_key(provider: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || ai::clear_api_key(&provider))
        .await
        .map_err(|error| AppError::Config(error.to_string()))?
}

#[tauri::command]
pub async fn import_image(
    state: State<'_, AppState>,
    path: String,
) -> Result<CachedImage, AppError> {
    images::import_local(state.inner(), PathBuf::from(path)).await
}

#[tauri::command]
pub fn reveal_recording(app: AppHandle, path: String) -> Result<(), AppError> {
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| AppError::Config(error.to_string()))
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StartRecordingRequest,
) -> Result<RecordingStarted, AppError> {
    recorder::start(&app, state.inner(), req)
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordingResult, AppError> {
    recorder::stop(app, state.inner()).await
}

#[tauri::command]
pub fn recording_status(state: State<'_, AppState>) -> RecordingStatus {
    recorder::status(state.inner())
}
