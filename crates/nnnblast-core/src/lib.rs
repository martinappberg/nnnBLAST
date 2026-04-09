pub mod align;
pub mod query;
pub mod stats;
pub mod types;

// Server-only modules (require tokio, reqwest, rayon, etc.)
#[cfg(feature = "server")]
pub mod index;
#[cfg(feature = "server")]
pub mod ncbi;
#[cfg(feature = "server")]
pub mod search;
