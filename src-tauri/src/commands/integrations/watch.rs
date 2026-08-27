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

#[cfg(test)]
mod tests {
    use super::*;

    fn actor() -> Actor {
        Actor {
            login: "ada".to_string(),
            display_name: "Ada".to_string(),
            avatar_url: None,
        }
    }

    fn merge_request() -> MergeRequest {
        MergeRequest {
            id: "mr-1".to_string(),
            number: "1".to_string(),
            title: "Ajouter une chose".to_string(),
            description: String::new(),
            state: MergeRequestState::Open,
            is_draft: false,
            source_branch: "feat/x".to_string(),
            target_branch: "main".to_string(),
            author: actor(),
            reviewers: vec![],
            assignees: vec![],
            labels: vec![],
            approvals: Approvals {
                approved: 0,
                required: Some(1),
                approved_by_me: false,
            },
            mergeable: Mergeable::Yes,
            has_conflicts: false,
            head_sha: "abc1234".to_string(),
            pipeline_status: Some(PipelineStatus::Running),
            url: "https://example.test/mr/1".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn job(status: PipelineStatus) -> PipelineJob {
        PipelineJob {
            id: "j1".to_string(),
            name: "build".to_string(),
            status,
            duration_ms: None,
            started_at: None,
            can_retry: false,
            can_cancel: false,
            is_manual: false,
            url: String::new(),
        }
    }

    fn pipeline() -> Pipeline {
        Pipeline {
            id: "p-1".to_string(),
            number: "1".to_string(),
            status: PipelineStatus::Running,
            git_ref: "feat/x".to_string(),
            sha: "abc1234".to_string(),
            title: "pipeline".to_string(),
            source: None,
            stages: vec![PipelineStage {
                name: "test".to_string(),
                status: PipelineStatus::Running,
                jobs: vec![job(PipelineStatus::Running)],
            }],
            started_at: None,
            finished_at: None,
            duration_ms: None,
            url: String::new(),
            failed_job_id: None,
        }
    }

    #[test]
    fn nothing_watched_yet_has_a_null_signature() {
        assert_eq!(merge_request_signature(&None), Value::Null);
        assert_eq!(pipeline_signature(&None), Value::Null);
    }

    #[test]
    fn an_unchanged_merge_request_keeps_its_signature() {
        let first = merge_request_signature(&Some(merge_request()));
        let second = merge_request_signature(&Some(merge_request()));
        assert_eq!(first, second);
    }

    #[test]
    fn a_merge_request_that_moved_changes_its_signature() {
        let before = merge_request_signature(&Some(merge_request()));
        for mutate in [
            |mr: &mut MergeRequest| mr.updated_at = "2026-01-02T00:00:00Z".to_string(),
            |mr: &mut MergeRequest| mr.state = MergeRequestState::Merged,
            |mr: &mut MergeRequest| mr.pipeline_status = Some(PipelineStatus::Failed),
            |mr: &mut MergeRequest| mr.approvals.approved = 1,
            |mr: &mut MergeRequest| mr.is_draft = true,
            |mr: &mut MergeRequest| mr.head_sha = "def5678".to_string(),
        ] {
            let mut mr = merge_request();
            mutate(&mut mr);
            assert_ne!(
                merge_request_signature(&Some(mr)),
                before,
                "a change the user must see left the signature alone"
            );
        }
    }

    /// The signature is deliberately narrow: a field the merge request view
    /// does not react to must not wake every watcher up.
    #[test]
    fn a_field_the_view_ignores_leaves_the_signature_alone() {
        let before = merge_request_signature(&Some(merge_request()));
        let mut mr = merge_request();
        mr.description = "a much longer description".to_string();
        mr.labels = vec!["urgent".to_string()];
        assert_eq!(merge_request_signature(&Some(mr)), before);
    }

    #[test]
    fn a_merge_request_appearing_changes_the_signature() {
        assert_ne!(
            merge_request_signature(&Some(merge_request())),
            merge_request_signature(&None)
        );
    }

    #[test]
    fn an_unchanged_pipeline_keeps_its_signature() {
        assert_eq!(
            pipeline_signature(&Some(pipeline())),
            pipeline_signature(&Some(pipeline()))
        );
    }

    #[test]
    fn a_pipeline_that_moved_changes_its_signature() {
        let before = pipeline_signature(&Some(pipeline()));
        for mutate in [
            |p: &mut Pipeline| p.status = PipelineStatus::Success,
            |p: &mut Pipeline| p.finished_at = Some("2026-01-01T01:00:00Z".to_string()),
            |p: &mut Pipeline| p.failed_job_id = Some("j1".to_string()),
            |p: &mut Pipeline| p.id = "p-2".to_string(),
        ] {
            let mut p = pipeline();
            mutate(&mut p);
            assert_ne!(pipeline_signature(&Some(p)), before);
        }
    }

    /// A job turning green inside an otherwise unchanged pipeline has to reach
    /// the view: the stage detail is part of the signature for that reason.
    #[test]
    fn a_job_changing_status_changes_the_signature() {
        let before = pipeline_signature(&Some(pipeline()));
        let mut p = pipeline();
        p.stages[0].jobs[0].status = PipelineStatus::Success;
        assert_ne!(pipeline_signature(&Some(p)), before);
    }

    #[test]
    fn a_stage_changing_status_changes_the_signature() {
        let before = pipeline_signature(&Some(pipeline()));
        let mut p = pipeline();
        p.stages[0].status = PipelineStatus::Failed;
        assert_ne!(pipeline_signature(&Some(p)), before);
    }

    #[test]
    fn a_stage_being_added_changes_the_signature() {
        let before = pipeline_signature(&Some(pipeline()));
        let mut p = pipeline();
        p.stages.push(PipelineStage {
            name: "deploy".to_string(),
            status: PipelineStatus::Pending,
            jobs: vec![],
        });
        assert_ne!(pipeline_signature(&Some(p)), before);
    }

    #[test]
    fn a_job_detail_the_view_ignores_leaves_the_signature_alone() {
        let before = pipeline_signature(&Some(pipeline()));
        let mut p = pipeline();
        p.stages[0].jobs[0].duration_ms = Some(9_000);
        p.stages[0].jobs[0].url = "https://example.test/job".to_string();
        assert_eq!(pipeline_signature(&Some(p)), before);
    }

    #[test]
    fn a_pipeline_appearing_changes_the_signature() {
        assert_ne!(
            pipeline_signature(&Some(pipeline())),
            pipeline_signature(&None)
        );
    }

    /// The very first poll compares against "unset", never against null, so a
    /// branch that genuinely has nothing does not look like a change.
    #[test]
    fn the_seed_value_is_neither_of_the_signatures() {
        let seed = json!("unset");
        assert_ne!(seed, merge_request_signature(&None));
        assert_ne!(seed, merge_request_signature(&Some(merge_request())));
        assert_ne!(seed, pipeline_signature(&None));
        assert_ne!(seed, pipeline_signature(&Some(pipeline())));
    }
}
