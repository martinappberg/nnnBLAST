use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use nnnblast_core::{
    query::{detect_rna_mode, parse_query},
    search::search_ncbi,
    types::{JobProgress, NcbiParams, ProgressHandle, SearchParams, SearchResults},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_database")]
    pub database: String,
    pub email: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_max_mismatches")]
    pub max_mismatches: usize,
    #[serde(default = "default_evalue_cutoff")]
    pub evalue_cutoff: f64,
}

fn default_database() -> String { "core_nt".into() }
fn default_max_mismatches() -> usize { 2 }
fn default_evalue_cutoff() -> f64 { 10.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<SearchResults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobProgress>,
}

#[derive(Clone)]
pub enum JobStatus {
    Running(ProgressHandle),
    Complete(SearchResults),
    Failed(String),
}

pub struct JobStore {
    pub jobs: HashMap<String, JobStatus>,
}

impl JobStore {
    pub fn new() -> Self {
        Self {
            jobs: HashMap::new(),
        }
    }
}

pub async fn submit_search(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, (StatusCode, String)> {
    let structured_query = parse_query(&req.query)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid query: {e}")))?;

    let rna_mode = detect_rna_mode(&req.query);

    if req.email.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Email is required (NCBI policy)".into(),
        ));
    }

    let job_id = Uuid::new_v4().to_string();

    let progress: ProgressHandle = Arc::new(RwLock::new(JobProgress {
        stage: "starting".into(),
        detail: None,
    }));

    {
        let mut store = state.write().await;
        store
            .jobs
            .insert(job_id.clone(), JobStatus::Running(progress.clone()));
    }

    let state_clone = state.clone();
    let job_id_clone = job_id.clone();

    tokio::spawn(async move {
        let params = SearchParams {
            query: structured_query,
            max_mismatches: req.max_mismatches,
            evalue_cutoff: req.evalue_cutoff,
            match_score: 2,
            mismatch_score: -3,
            rna_mode,
        };

        let ncbi_params = NcbiParams {
            database: req.database,
            email: req.email,
            api_key: req.api_key,
            max_blast_hits: 500,
        };

        match search_ncbi(&params, &ncbi_params, progress).await {
            Ok(results) => {
                let mut store = state_clone.write().await;
                store
                    .jobs
                    .insert(job_id_clone, JobStatus::Complete(results));
            }
            Err(e) => {
                let mut store = state_clone.write().await;
                store
                    .jobs
                    .insert(job_id_clone, JobStatus::Failed(e.to_string()));
            }
        }
    });

    Ok(Json(SearchResponse { job_id }))
}

pub async fn get_results(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<JobResult>, (StatusCode, String)> {
    let store = state.read().await;

    match store.jobs.get(&job_id) {
        Some(JobStatus::Running(progress)) => {
            let p = progress.read().await;
            Ok(Json(JobResult {
                status: "running".into(),
                results: None,
                error: None,
                progress: Some(p.clone()),
            }))
        }
        Some(JobStatus::Complete(results)) => Ok(Json(JobResult {
            status: "complete".into(),
            results: Some(results.clone()),
            error: None,
            progress: None,
        })),
        Some(JobStatus::Failed(err)) => Ok(Json(JobResult {
            status: "failed".into(),
            results: None,
            error: Some(err.clone()),
            progress: None,
        })),
        None => Err((StatusCode::NOT_FOUND, format!("Job {job_id} not found"))),
    }
}
