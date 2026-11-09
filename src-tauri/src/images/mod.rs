pub mod cache;
pub mod providers;

use std::{path::Path, sync::Arc};

use serde::{Deserialize, Serialize};

pub use cache::import_local;

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageProviderKind {
    #[default]
    Auto,
    Openverse,
    Brave,
    Wikimedia,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedImage {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub provider: String,
    pub source_url: String,
    pub page_url: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
}

pub fn provider_chain(
    kind: ImageProviderKind,
    safe_search: bool,
) -> Vec<Arc<dyn providers::ImageProvider>> {
    use providers::{Brave, Openverse, Wikimedia};

    match kind {
        ImageProviderKind::Openverse => vec![Arc::new(Openverse)],
        ImageProviderKind::Brave => vec![Arc::new(Brave { safe_search })],
        ImageProviderKind::Wikimedia => vec![Arc::new(Wikimedia)],
        ImageProviderKind::Auto => {
            let mut chain: Vec<Arc<dyn providers::ImageProvider>> = vec![Arc::new(Openverse)];
            // Brave is optional. Skip it entirely when no key is configured so
            // every item does not pay for a failed credential lookup.
            if crate::ai::get_api_key_blocking("brave").is_some() {
                chain.push(Arc::new(Brave { safe_search }));
            }
            chain.push(Arc::new(Wikimedia));
            chain
        }
    }
}

pub async fn resolve(
    http: &reqwest::Client,
    cache_dir: &Path,
    query: &str,
    fallback_query: Option<&str>,
    chain: &[Arc<dyn providers::ImageProvider>],
) -> Option<CachedImage> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }

    if let Some(image) = resolve_with(http, cache_dir, query, chain).await {
        return Some(image);
    }

    // The model's `search_query` is descriptive, which suits Openverse, while
    // Wikimedia's search does best with a bare entity name. Retry the name on
    // Wikimedia only, so a throttled Openverse request does not cost another
    // Openverse call.
    let fallback = fallback_query
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != query);

    if let Some(fallback) = fallback {
        let wikimedia: Vec<Arc<dyn providers::ImageProvider>> = chain
            .iter()
            .filter(|provider| provider.name() == "wikimedia")
            .cloned()
            .collect();

        if !wikimedia.is_empty() {
            return resolve_with(http, cache_dir, fallback, &wikimedia).await;
        }
    }

    None
}

async fn resolve_with(
    http: &reqwest::Client,
    cache_dir: &Path,
    query: &str,
    chain: &[Arc<dyn providers::ImageProvider>],
) -> Option<CachedImage> {
    for provider in chain {
        match provider.search(http, query, 4).await {
            Ok(candidates) => {
                for candidate in candidates {
                    match cache::download_and_cache(http, cache_dir, &candidate).await {
                        Ok(image) if is_usable(&image) => return Some(image),
                        Ok(_) => {}
                        Err(error) => {
                            tracing::debug!(
                                provider = provider.name(),
                                %error,
                                "image candidate rejected"
                            );
                        }
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    provider = provider.name(),
                    %error,
                    "image search failed"
                );
            }
        }
    }

    None
}

fn is_usable(image: &CachedImage) -> bool {
    let ratio = image.width as f32 / image.height.max(1) as f32;
    image.width >= 200 && image.height >= 200 && (0.3..=3.2).contains(&ratio)
}
