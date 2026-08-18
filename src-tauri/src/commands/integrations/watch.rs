//! Polls the merge request of a branch and its latest pipeline for every
//! watched instance, and emits `integration-update` only when something moved.

use std::time::Duration;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use super::model::*;
use super::provider::{Backend, CiProvider, ForgeProvider};
use crate::commands::settings::{default_integrations_poll_seconds, read_settings};

pub const INTEGRATION_UPDATE_EVENT: &str = "integration-update";
const MANUAL_MODE_RECHECK: Duration = Duration::from_secs(30);

pub struct WatchHandle {
    handle: tauri::async_runtime::JoinHandle<()>,
}

impl WatchHandle {
    pub fn stop(self) {
        self.handle.abort();
    }
}

fn merge_request_signature(mr: &Option<MergeRequest>) -> Value {
    match mr {
        None => Value::Null,
        Some(mr) => json!([mr.id, mr.updated_at, mr.state, mr.pipeline_status, mr.approvals, mr.is_draft, mr.head_sha]),
    }
}

fn pipeline_signature(p: &Option<Pipeline>) -> Value {
    match p {
        None => Value::Null,
        Some(p) => json!([p.id, p.status, p.finished_at, p.failed_job_id, p.stages.iter().map(|s| (&s.name, s.status, s.jobs.iter().map(|j| j.status).collect::<Vec<_>>())).collect::<Vec<_>>()]),
    }
}

fn emit(app: &AppHandle, project_id: &str, instance_id: &str, kind: IntegrationUpdateKind, data: Value) {
    let _ = app.emit(
        INTEGRATION_UPDATE_EVENT,
        IntegrationUpdateEvent {
            project_id: project_id.to_string(),
            instance_id: instance_id.to_string(),
            kind,
            data,
        },
    );
}

async fn poll_merge_request(project_id: &str, branch: &str) -> Result<Option<MergeRequest>, IntegrationError> {
    Backend::for_capability(project_id, Capability::Forge)?.find_merge_request(branch).await
}

async fn poll_pipeline(project_id: &str, branch: &str) -> Result<Option<Pipeline>, IntegrationError> {
    let page =
        Backend::for_capability(project_id, Capability::Ci)?.list_pipelines(branch, &PipelineQuery::default(), 1, 1).await?;
    Ok(page.items.into_iter().next())
}

pub fn start(app: AppHandle, project_id: String, instance_id: String, branch: String) -> WatchHandle {
    let handle = tauri::async_runtime::spawn(async move {
        let mut last_mr = json!("unset");
        let mut last_pipeline = json!("unset");
        loop {
            let seconds = read_settings()
                .map(|s| s.integrations_poll_seconds)
                .unwrap_or_else(|_| default_integrations_poll_seconds());
            if seconds == 0 {
                tokio::time::sleep(MANUAL_MODE_RECHECK).await;
                continue;
            }
            let mut pause = Duration::from_secs(seconds);

            match poll_merge_request(&project_id, &branch).await {
                Ok(mr) => {
                    let signature = merge_request_signature(&mr);
                    if signature != last_mr {
                        last_mr = signature;
                        if let Some(mr) = mr {
                            emit(&app, &project_id, &instance_id, IntegrationUpdateKind::MergeRequest, json!(mr));
                        }
                    }
                }
                Err(e) if e.code == IntegrationErrorCode::RateLimited => {
                    pause = pause.max(Duration::from_millis(e.retry_after_ms.unwrap_or(60_000)));
                }
                Err(_) => {}
            }

            match poll_pipeline(&project_id, &branch).await {
                Ok(pipeline) => {
                    let signature = pipeline_signature(&pipeline);
                    if signature != last_pipeline {
                        last_pipeline = signature;
                        if let Some(pipeline) = pipeline {
                            emit(&app, &project_id, &instance_id, IntegrationUpdateKind::Pipeline, json!(pipeline));
                        }
                    }
                }
                Err(e) if e.code == IntegrationErrorCode::RateLimited => {
                    pause = pause.max(Duration::from_millis(e.retry_after_ms.unwrap_or(60_000)));
                }
                Err(_) => {}
            }

            tokio::time::sleep(pause).await;
        }
    });
    WatchHandle { handle }
}
