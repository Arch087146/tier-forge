use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::{get_api_key, system_prompt, LlmProvider, SeedItem};
use crate::error::AppError;

pub async fn generate(
    client: &reqwest::Client,
    prompt: &str,
    count: usize,
    provider: LlmProvider,
    model: Option<&str>,
) -> Result<Vec<SeedItem>, AppError> {
    let max_tokens = max_output_tokens(count);

    match provider {
        LlmProvider::OpenAi => {
            openai(
                client,
                prompt,
                count,
                model.unwrap_or("gpt-4.1-mini"),
                max_tokens,
            )
            .await
        }
        LlmProvider::Gemini => {
            gemini(
                client,
                prompt,
                count,
                model.unwrap_or("gemini-2.5-flash"),
                max_tokens,
            )
            .await
        }
        LlmProvider::OpenRouter => {
            openrouter(
                client,
                prompt,
                count,
                model.unwrap_or("openai/gpt-4.1-mini"),
                max_tokens,
            )
            .await
        }
    }
}

/// Bound the completion so providers do not reserve the model's maximum output
/// against the account balance. OpenRouter in particular rejects a request with
/// HTTP 402 when the *reserved* tokens exceed the remaining credits, even if the
/// actual completion would be tiny.
fn max_output_tokens(count: usize) -> u32 {
    let per_item = 140_u32;
    let base = 512_u32;
    count
        .try_into()
        .unwrap_or(u32::MAX)
        .saturating_mul(per_item)
        .saturating_add(base)
        .clamp(1_200, 8_192)
}

async fn openai(
    client: &reqwest::Client,
    prompt: &str,
    count: usize,
    model: &str,
    max_tokens: u32,
) -> Result<Vec<SeedItem>, AppError> {
    let key = get_api_key("openai").await?;

    let body = json!({
        "model": model,
        "temperature": 0.7,
        "max_completion_tokens": max_tokens,
        "messages": [
            { "role": "system", "content": system_prompt(count) },
            {
                "role": "user",
                "content": format!(
                    "Theme: {prompt}\nGenerate exactly {count} distinct items for a tier list."
                )
            }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "tier_list_items",
                "strict": true,
                "schema": object_schema()
            }
        }
    });

    let request = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(key)
        .json(&body);

    let value = send_with_retry(request).await?;
    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Parse("OpenAI returned no message content.".into()))?;

    parse_items(content)
}

async fn gemini(
    client: &reqwest::Client,
    prompt: &str,
    count: usize,
    model: &str,
    max_tokens: u32,
) -> Result<Vec<SeedItem>, AppError> {
    let key = get_api_key("gemini").await?;
    let url =
        format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": system_prompt(count) }]
        },
        "contents": [{
            "role": "user",
            "parts": [{
                "text": format!(
                    "Theme: {prompt}\nGenerate exactly {count} distinct items for a tier list."
                )
            }]
        }],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
            "responseSchema": gemini_schema()
        }
    });

    let request = client.post(url).header("x-goog-api-key", key).json(&body);

    let value = send_with_retry(request).await?;
    let content = value["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| AppError::Parse("Gemini returned no text content.".into()))?;

    parse_items(content)
}

async fn openrouter(
    client: &reqwest::Client,
    prompt: &str,
    count: usize,
    model: &str,
    max_tokens: u32,
) -> Result<Vec<SeedItem>, AppError> {
    let key = get_api_key("openrouter").await?;
    let system = format!(
        "{}\n\nReturn one JSON object with an \"items\" array. Each item must have exactly the string fields \"name\", \"search_query\", and \"description\".",
        system_prompt(count)
    );

    // OpenRouter exposes an OpenAI-compatible chat endpoint but support for
    // strict `json_schema` response formats varies by model. A clear JSON
    // instruction plus the tolerant parser below works across the catalogue.
    let body = json!({
        "model": model,
        "temperature": 0.7,
        "max_tokens": max_tokens,
        "messages": [
            { "role": "system", "content": system },
            {
                "role": "user",
                "content": format!(
                    "Theme: {prompt}\nGenerate exactly {count} distinct items for a tier list."
                )
            }
        ]
    });

    let request = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(key)
        .header("X-Title", "TierForge")
        .json(&body);

    let value = send_with_retry(request).await?;
    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Parse("OpenRouter returned no message content.".into()))?;

    parse_items(content)
}

fn object_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "search_query": { "type": "string" },
                        "description": { "type": "string" }
                    },
                    "required": ["name", "search_query", "description"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["items"],
        "additionalProperties": false
    })
}

fn gemini_schema() -> Value {
    json!({
        "type": "OBJECT",
        "properties": {
            "items": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": { "type": "STRING" },
                        "search_query": { "type": "STRING" },
                        "description": { "type": "STRING" }
                    },
                    "required": ["name", "search_query", "description"]
                }
            }
        },
        "required": ["items"]
    })
}

#[derive(Deserialize)]
struct Envelope {
    items: Vec<SeedItem>,
}

fn parse_items(text: &str) -> Result<Vec<SeedItem>, AppError> {
    let cleaned = strip_fences(text);
    let start = cleaned
        .find(|character| character == '{' || character == '[')
        .ok_or_else(|| AppError::Parse("No JSON object found in the model response.".into()))?;
    let end = cleaned
        .rfind(|character| character == '}' || character == ']')
        .ok_or_else(|| AppError::Parse("Unterminated JSON in the model response.".into()))?;

    if end <= start {
        return Err(AppError::Parse("Empty JSON payload.".into()));
    }

    let slice = &cleaned[start..=end];

    if let Ok(items) = serde_json::from_str::<Vec<SeedItem>>(slice) {
        return Ok(items);
    }

    let envelope: Envelope = serde_json::from_str(slice)
        .map_err(|error| AppError::Parse(format!("{error}: {}", truncate(slice, 300))))?;
    Ok(envelope.items)
}

fn strip_fences(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let without_open = trimmed.trim_start_matches("```");
    let without_language = without_open
        .strip_prefix("json")
        .unwrap_or(without_open)
        .trim_start();

    without_language.trim_end_matches("```").trim().to_string()
}

async fn send_with_retry(request: reqwest::RequestBuilder) -> Result<Value, AppError> {
    let mut delay = 600_u64;

    for attempt in 0..4 {
        let Some(cloned) = request.try_clone() else {
            return Err(AppError::Config(
                "Could not clone the upstream HTTP request.".into(),
            ));
        };

        let response = cloned.send().await?;
        let status = response.status();

        if status.is_success() {
            return Ok(response.json::<Value>().await?);
        }

        let retryable = status.as_u16() == 429 || status.is_server_error();
        let body = response.text().await.unwrap_or_default();

        if retryable && attempt < 3 {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            delay = (delay * 2).min(8_000);
            continue;
        }

        let hint = match status.as_u16() {
            401 => " Check that the API key in Settings is correct and active.",
            402 => " The provider account is out of credits. Add credits, or choose a cheaper model / fewer items.",
            403 => " The provider denied access to this key or model.",
            404 => " The selected model was not found. Check the model name.",
            429 => " Rate limited. Wait a moment and try again.",
            _ => "",
        };

        return Err(AppError::Upstream(format!(
            "{} {}: {}{}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("error"),
            truncate(&body, 400),
            hint
        )));
    }

    Err(AppError::Upstream(
        "The upstream request failed after retries.".into(),
    ))
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
