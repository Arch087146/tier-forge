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
    chain: &[Arc<dyn providers::ImageProvider>],
) -> Option<CachedImage> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }

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
