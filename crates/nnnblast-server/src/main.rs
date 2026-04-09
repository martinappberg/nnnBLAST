mod api;

use axum::{routing::{get, post}, Router};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

pub type AppState = Arc<RwLock<api::JobStore>>;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nnnblast_core=info,nnnblast_server=info".parse().unwrap()),
        )
        .init();

    let state: AppState = Arc::new(RwLock::new(api::JobStore::new()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/search", post(api::submit_search))
        .route("/api/results/{job_id}", get(api::get_results))
        .with_state(state)
        .layer(cors);

    let addr = "0.0.0.0:3001";
    println!("nnnBLAST server listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
