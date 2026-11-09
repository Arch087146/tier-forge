pub mod providers;

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use futures::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::AppError;
use crate::images::{self, CachedImage, ImageProviderKind};
use crate::state::AppState;

const KEY_SERVICE: &str = "com.tierforge.app";

const SYSTEM_PROMPT: &str = r#"You are a meticulous pop-culture and product research assistant.
Given a theme, produce a list of distinct, recognizable, visually iconic entries that a person could rank in a tier list.

Rules:
- Produce exactly {{count}} entries.
- No duplicates or near-duplicates. No generic category names.
- Prefer specific, nameable things (characters, products, songs, foods, games, places) over abstract concepts.
- "search_query" must be a short English image-search query that will find a clear, representative photo or official artwork. Add franchise, year, or context when it disambiguates.
- "description" is one short sentence, at most 120 characters.
- Never invent image URLs. Never include markdown.
Return JSON only, matching the provided schema."#;

fn default_count() -> usize {
    24
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    #[default]
    OpenAi,
    Gemini,
    OpenRouter,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub prompt: String,
    #[serde(default = "default_count")]
    pub count: usize,
    #[serde(default)]
    pub provider: LlmProvider,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub image_provider: ImageProviderKind,
    #[serde(default = "default_true")]
    pub safe_search: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedItem {
    pub name: String,
    #[serde(default)]
    pub search_query: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub image: Option<CachedImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopulateResult {
    pub theme: String,
    pub items: Vec<ResolvedItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    done: usize,
    total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    item: Option<ResolvedItem>,
}

fn emit(app: &AppHandle, payload: Progress) {
    let _ = app.emit("ai://progress", payload);
}

pub async fn populate(
    app: AppHandle,
    state: &AppState,
    req: GenerateRequest,
) -> Result<PopulateResult, AppError> {
    let prompt = req.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(AppError::Config("Enter a theme first.".into()));
    }

    let count = req.count.clamp(4, 48);

    let token = CancellationToken::new();
    {
        let mut guard = state
            .cancel
            .lock()
            .map_err(|_| AppError::Config("State lock poisoned.".into()))?;
        if let Some(previous) = guard.take() {
            previous.cancel();
        }
        *guard = Some(token.clone());
    }

    emit(
        &app,
        Progress {
            phase: "generating",
            done: 0,
            total: count,
            item: None,
        },
    );

    let seeds = tokio::select! {
        result = providers::generate(
            &state.http,
            &prompt,
            count,
            req.provider,
            req.model.as_deref(),
        ) => result?,
        _ = token.cancelled() => return Err(AppError::Cancelled),
    };

    let seeds = normalize_seeds(seeds, count);
    let total = seeds.len();
    if total == 0 {
        return Err(AppError::Parse(
            "The model returned no usable items.".into(),
        ));
    }

    if req.image_provider == ImageProviderKind::Brave && get_api_key("brave").await.is_err() {
        return Err(AppError::Config(
            "Brave image search requires a Brave Search API key. Add one in Settings or use Auto."
                .into(),
        ));
    }

    let chain = images::provider_chain(req.image_provider, req.safe_search);
    let completed = Arc::new(AtomicUsize::new(0));

    let mut tasks = stream::iter(seeds.into_iter().enumerate().map(|(index, seed)| {
        let app = app.clone();
        let token = token.clone();
        let chain = chain.clone();
        let completed = completed.clone();
        let http = state.http.clone();
        let cache_dir = state.cache_dir.clone();
        let total = total;

        async move {
            if token.is_cancelled() {
                return Err(AppError::Cancelled);
            }

            let image = tokio::select! {
                image = images::resolve(
                    &http,
                    &cache_dir,
                    &seed.search_query,
                    Some(&seed.name),
                    &chain,
                ) => image,
                _ = token.cancelled() => return Err(AppError::Cancelled),
            };

            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let item = ResolvedItem {
                id: Uuid::new_v4().to_string(),
                name: seed.name,
                description: seed.description,
                image,
            };

            emit(
                &app,
                Progress {
                    phase: "resolving",
                    done,
                    total,
                    item: Some(item.clone()),
                },
            );

            Ok::<(usize, ResolvedItem), AppError>((index, item))
        }
    }))
    .buffer_unordered(5);

    let mut resolved = Vec::with_capacity(total);
    while let Some(result) = tasks.next().await {
        resolved.push(result?);
    }
    resolved.sort_by_key(|(index, _)| *index);

    if let Ok(mut guard) = state.cancel.lock() {
        if guard.as_ref().is_some_and(CancellationToken::is_cancelled) {
            *guard = None;
        }
    }

    emit(
        &app,
        Progress {
            phase: "done",
            done: total,
            total,
            item: None,
        },
    );

    Ok(PopulateResult {
        theme: prompt,
        items: resolved.into_iter().map(|(_, item)| item).collect(),
    })
}

fn normalize_seeds(seeds: Vec<SeedItem>, count: usize) -> Vec<SeedItem> {
    let mut seen = HashSet::new();
    let mut output = Vec::with_capacity(count);

    for mut seed in seeds {
        seed.name = seed.name.trim().to_string();
        seed.description = seed.description.trim().chars().take(160).collect();
        seed.search_query = seed.search_query.trim().to_string();

        if seed.name.is_empty() {
            continue;
        }
        if seed.search_query.is_empty() {
            seed.search_query = seed.name.clone();
        }

        let key = seed.name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }

        output.push(seed);
        if output.len() >= count {
            break;
        }
    }

    output
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    if matches!(provider, "openai" | "gemini" | "openrouter" | "brave") {
        Ok(())
    } else {
        Err(AppError::Config(format!("Unknown provider: {provider}")))
    }
}

fn env_name(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("OPENAI_API_KEY"),
        "gemini" => Some("GEMINI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "brave" => Some("BRAVE_API_KEY"),
        _ => None,
    }
}

pub fn store_api_key(provider: &str, key: &str) -> Result<(), AppError> {
    validate_provider(provider)?;
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Config("The API key is empty.".into()));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let entry = keyring::Entry::new(KEY_SERVICE, provider)
            .map_err(|error| AppError::Config(format!("Credential vault: {error}")))?;
        entry
            .set_password(key)
            .map_err(|error| AppError::Config(format!("Credential vault: {error}")))?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = key;
        Err(AppError::Config(
            "Secure key storage is unavailable on this platform. Set OPENAI_API_KEY, GEMINI_API_KEY, or BRAVE_API_KEY instead.".into(),
        ))
    }
}

pub fn clear_api_key(provider: &str) -> Result<(), AppError> {
    validate_provider(provider)?;

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let entry = keyring::Entry::new(KEY_SERVICE, provider)
            .map_err(|error| AppError::Config(format!("Credential vault: {error}")))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::Config(format!("Credential vault: {error}"))),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(AppError::Config(
            "Secure key storage is unavailable on this platform.".into(),
        ))
    }
}

pub fn get_api_key_blocking(provider: &str) -> Option<String> {
    if let Some(name) = env_name(provider) {
        if let Ok(value) = std::env::var(name) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, provider) {
            if let Ok(value) = entry.get_password() {
                let value = value.trim().to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }

    None
}

pub async fn get_api_key(provider: &str) -> Result<String, AppError> {
    validate_provider(provider)?;
    let provider_for_task = provider.to_string();
    let provider_for_error = provider.to_string();
    tokio::task::spawn_blocking(move || get_api_key_blocking(&provider_for_task))
        .await
        .map_err(|error| AppError::Config(error.to_string()))?
        .ok_or_else(|| {
            AppError::Config(format!(
                "No API key configured for {provider_for_error}. Open Settings and add one."
            ))
        })
}

pub(crate) fn system_prompt(count: usize) -> String {
    SYSTEM_PROMPT.replace("{{count}}", &count.to_string())
}
