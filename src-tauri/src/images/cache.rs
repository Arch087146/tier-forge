use std::{
    io::BufWriter,
    path::{Path, PathBuf},
};

use bytes::{Bytes, BytesMut};
use futures::StreamExt;
use image::{ExtendedColorType, Rgba, RgbaImage};
use sha2::{Digest, Sha256};

use super::{providers::ImageCandidate, CachedImage};
use crate::error::AppError;
use crate::state::AppState;

const MAX_BYTES: usize = 15 * 1024 * 1024;
const MAX_LOCAL_BYTES: usize = 30 * 1024 * 1024;
const MAX_EDGE: u32 = 768;

pub async fn download_and_cache(
    http: &reqwest::Client,
    cache_dir: &Path,
    candidate: &ImageCandidate,
) -> Result<CachedImage, AppError> {
    let id = sha256_hex(candidate.url.as_bytes());
    let path = cache_dir.join(format!("{id}.jpg"));

    if path.exists() {
        if let Ok((width, height)) = image::image_dimensions(&path) {
            return Ok(to_cached(&id, &path, width, height, candidate));
        }
        let _ = std::fs::remove_file(&path);
    }

    let bytes = download_limited(http, &candidate.url).await?;
    let output = path.clone();
    let (width, height) = tokio::task::spawn_blocking(move || process_to_jpeg(&bytes, &output))
        .await
        .map_err(|error| AppError::Image(error.to_string()))??;

    Ok(to_cached(&id, &path, width, height, candidate))
}

pub async fn import_local(state: &AppState, source: PathBuf) -> Result<CachedImage, AppError> {
    let bytes = tokio::fs::read(&source).await?;
    if bytes.len() > MAX_LOCAL_BYTES {
        return Err(AppError::Image("That image is larger than 30 MB.".into()));
    }

    let id = sha256_hex(&bytes);
    let path = state.cache_dir.join(format!("{id}.jpg"));
    let output = path.clone();
    let (width, height) = tokio::task::spawn_blocking(move || process_to_jpeg(&bytes, &output))
        .await
        .map_err(|error| AppError::Image(error.to_string()))??;

    Ok(CachedImage {
        id,
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        provider: "local".into(),
        source_url: source.to_string_lossy().into_owned(),
        page_url: None,
        author: None,
        license: None,
    })
}

fn to_cached(
    id: &str,
    path: &Path,
    width: u32,
    height: u32,
    candidate: &ImageCandidate,
) -> CachedImage {
    CachedImage {
        id: id.to_string(),
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        provider: candidate.provider.clone(),
        source_url: candidate.url.clone(),
        page_url: candidate.page_url.clone(),
        author: candidate.author.clone(),
        license: candidate.license.clone(),
    }
}

async fn download_limited(http: &reqwest::Client, url: &str) -> Result<Bytes, AppError> {
    let response = http
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        )
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Upstream(format!("image download {status}")));
    }

    if let Some(length) = response.content_length() {
        if length > MAX_BYTES as u64 {
            return Err(AppError::Image("Image is too large to cache.".into()));
        }
    }

    let mut buffer = BytesMut::with_capacity(256 * 1024);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if buffer.len() + chunk.len() > MAX_BYTES {
            return Err(AppError::Image("Image is too large to cache.".into()));
        }
        buffer.extend_from_slice(&chunk);
    }

    if buffer.is_empty() {
        return Err(AppError::Image("The image response was empty.".into()));
    }

    Ok(buffer.freeze())
}

fn process_to_jpeg(bytes: &[u8], output: &Path) -> Result<(u32, u32), AppError> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| AppError::Image(format!("Could not decode image: {error}")))?;

    let image = image.thumbnail(MAX_EDGE, MAX_EDGE);
    let width = image.width().max(1);
    let height = image.height().max(1);

    let rgba = image.to_rgba8();
    let mut canvas = RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]));
    image::imageops::overlay(&mut canvas, &rgba, 0, 0);
    let rgb = image::DynamicImage::ImageRgba8(canvas).to_rgb8();

    let file = std::fs::File::create(output)?;
    let mut writer = BufWriter::new(file);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 82);
    encoder
        .encode(rgb.as_raw(), width, height, ExtendedColorType::Rgb8)
        .map_err(|error| AppError::Image(format!("Could not encode JPEG: {error}")))?;

    Ok((width, height))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}
