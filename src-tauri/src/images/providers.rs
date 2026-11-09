use async_trait::async_trait;
use serde_json::Value;

use crate::ai::get_api_key;
use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct ImageCandidate {
    pub url: String,
    pub page_url: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub provider: String,
}

#[async_trait]
pub trait ImageProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn search(
        &self,
        http: &reqwest::Client,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ImageCandidate>, AppError>;
}

pub struct Openverse;

#[async_trait]
impl ImageProvider for Openverse {
    fn name(&self) -> &'static str {
        "openverse"
    }

    async fn search(
        &self,
        http: &reqwest::Client,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ImageCandidate>, AppError> {
        let page_size = limit.to_string();
        let response = http
            .get("https://api.openverse.org/v1/images/")
            .query(&[
                ("q", query),
                ("page_size", page_size.as_str()),
                ("license_type", "commercial,modification"),
                ("mature", "false"),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Upstream(format!(
                "Openverse returned {}",
                response.status()
            )));
        }

        let value: Value = response.json().await?;
        let mut output = Vec::new();

        for result in value["results"].as_array().into_iter().flatten() {
            let page_url = result["foreign_landing_url"].as_str().map(str::to_string);
            let author = result["creator"].as_str().map(str::to_string);
            let license = result["license"]
                .as_str()
                .map(|license| license.to_uppercase());

            // Try the original first for quality, then Openverse's own
            // thumbnail endpoint. Some originals are too large, hotlink-blocked,
            // or in a format the decoder cannot read; the proxied thumbnail is a
            // reliable fallback.
            for url in [result["url"].as_str(), result["thumbnail"].as_str()]
                .into_iter()
                .flatten()
            {
                if !is_http(url) || output.iter().any(|candidate: &ImageCandidate| candidate.url == url)
                {
                    continue;
                }

                output.push(ImageCandidate {
                    url: url.to_string(),
                    page_url: page_url.clone(),
                    author: author.clone(),
                    license: license.clone(),
                    provider: "openverse".into(),
                });
            }
        }

        Ok(output)
    }
}

pub struct Brave {
    pub safe_search: bool,
}

#[async_trait]
impl ImageProvider for Brave {
    fn name(&self) -> &'static str {
        "brave"
    }

    async fn search(
        &self,
        http: &reqwest::Client,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ImageCandidate>, AppError> {
        let key = get_api_key("brave").await?;
        let count = limit.to_string();
        let safesearch = if self.safe_search {
            "strict"
        } else {
            "moderate"
        };

        let response = http
            .get("https://api.search.brave.com/res/v1/images/search")
            .header("X-Subscription-Token", key)
            .header("Accept", "application/json")
            .query(&[
                ("q", query),
                ("count", count.as_str()),
                ("safesearch", safesearch),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Upstream(format!(
                "Brave Images returned {}",
                response.status()
            )));
        }

        let value: Value = response.json().await?;
        let mut output = Vec::new();

        for result in value["results"].as_array().into_iter().flatten() {
            let Some(url) = result["properties"]["url"]
                .as_str()
                .or_else(|| result["thumbnail"]["src"].as_str())
            else {
                continue;
            };
            if !is_http(url) {
                continue;
            }

            output.push(ImageCandidate {
                url: url.to_string(),
                page_url: result["url"].as_str().map(str::to_string),
                author: result["source"].as_str().map(str::to_string),
                license: None,
                provider: "brave".into(),
            });
        }

        Ok(output)
    }
}

pub struct Wikimedia;

#[async_trait]
impl ImageProvider for Wikimedia {
    fn name(&self) -> &'static str {
        "wikimedia"
    }

    async fn search(
        &self,
        http: &reqwest::Client,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ImageCandidate>, AppError> {
        // `filetype:bitmap` keeps Commons from returning magazine PDFs and SVG
        // logos, which cannot be cached as photos.
        let search = format!("{query} filetype:bitmap");
        let gsrlimit = limit.max(6).to_string();
        let response = http
            .get("https://commons.wikimedia.org/w/api.php")
            .query(&[
                ("action", "query"),
                ("format", "json"),
                ("generator", "search"),
                ("gsrsearch", search.as_str()),
                ("gsrnamespace", "6"),
                ("gsrlimit", gsrlimit.as_str()),
                ("prop", "imageinfo"),
                ("iiprop", "url|mime|extmetadata"),
                ("iiurlwidth", "900"),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Upstream(format!(
                "Wikimedia Commons returned {}",
                response.status()
            )));
        }

        let value: Value = response.json().await?;
        let Some(pages) = value["query"]["pages"].as_object() else {
            return Ok(Vec::new());
        };

        let mut output = Vec::new();

        for page in pages.values() {
            let Some(info) = page["imageinfo"].as_array().and_then(|items| items.first()) else {
                continue;
            };

            let mime = info["mime"].as_str().unwrap_or_default();
            if !mime.starts_with("image/") || mime.contains("svg") {
                continue;
            }

            let Some(url) = info["thumburl"].as_str().or_else(|| info["url"].as_str()) else {
                continue;
            };
            if !is_http(url) {
                continue;
            }

            let metadata = &info["extmetadata"];

            output.push(ImageCandidate {
                url: url.to_string(),
                page_url: info["descriptionurl"].as_str().map(str::to_string),
                author: metadata["Artist"]["value"].as_str().map(clean_html),
                license: metadata["LicenseShortName"]["value"]
                    .as_str()
                    .map(clean_html),
                provider: "wikimedia".into(),
            });
        }

        Ok(output)
    }
}

fn is_http(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn clean_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut inside_tag = false;

    for character in input.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }

    output
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .chars()
        .take(120)
        .collect()
}
