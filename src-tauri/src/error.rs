use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Config(String),
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("upstream API error: {0}")]
    Upstream(String),
    #[error("could not parse model output: {0}")]
    Parse(String),
    #[error("image error: {0}")]
    Image(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("recorder error: {0}")]
    Recorder(String),
    #[error("cancelled")]
    Cancelled,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
