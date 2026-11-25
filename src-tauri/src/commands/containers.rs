// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Docker containers of the machine, read through the `docker` CLI for the
//! home Containers screen. The CLI rather than the engine socket: it honours
//! Docker contexts (Desktop, rootless, Colima) and exists on every platform.

use std::collections::HashMap;
use std::io::ErrorKind;

use serde::{Deserialize, Serialize};

use crate::child_env;

const PS_FORMAT: &str = concat!(
    r#"{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"#,
    r#""state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}},"#,
    r#""project":{{json (.Label "com.docker.compose.project")}},"#,
    r#""service":{{json (.Label "com.docker.compose.service")}},"#,
    r#""workingDir":{{json (.Label "com.docker.compose.project.working_dir")}}}"#,
);

const INSPECT_FORMAT: &str = "{{json .Id}} {{json .State.StartedAt}} {{json .State.FinishedAt}}";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedPort {
    /// The host address, `*` for every interface.
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    /// Docker's own state: `running`, `exited`, `paused`, `restarting`, `created`, `dead`.
    pub state: String,
    /// `healthy`, `unhealthy`, `starting`, or empty when the image has no healthcheck.
    pub health: String,
    pub exit_code: Option<i32>,
    /// Docker's English status line, kept for a tooltip.
    pub status: String,
    pub started_at: String,
    pub finished_at: String,
    pub ports: Vec<PublishedPort>,
    pub compose_project: String,
    pub compose_service: String,
    pub compose_working_dir: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DockerStatus {
    Ok,
    NotInstalled,
    DaemonDown,
    PermissionDenied,
    Error,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContainersReport {
    pub status: DockerStatus,
    pub containers: Vec<Container>,
    /// The CLI's own error, shown under the explanation when status is not ok.
    pub message: String,
}

impl ContainersReport {
    fn failed(status: DockerStatus, message: String) -> Self {
        Self { status, containers: Vec::new(), message }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PsRow {
    id: String,
    name: String,
    image: String,
    state: String,
    status: String,
    ports: String,
    #[serde(default)]
    project: String,
    #[serde(default)]
    service: String,
    #[serde(default)]
    working_dir: String,
}

fn classify_error(stderr: &str) -> DockerStatus {
    let lower = stderr.to_lowercase();
    if lower.contains("permission denied") {
        DockerStatus::PermissionDenied
    } else if lower.contains("cannot connect to the docker daemon")
        || lower.contains("is the docker daemon running")
        || lower.contains("error during connect")
    {
        DockerStatus::DaemonDown
    } else {
        DockerStatus::Error
    }
}

/// Health and exit code are only spelled in the status line:
/// `Up 3 days (healthy)`, `Exited (137) 2 hours ago`.
fn parse_status(status: &str) -> (String, Option<i32>) {
    let health = if status.contains("(healthy)") {
        "healthy"
    } else if status.contains("(unhealthy)") {
        "unhealthy"
    } else if status.contains("(health: starting)") {
        "starting"
    } else {
        ""
    };
    let exit_code = status
        .strip_prefix("Exited (")
        .and_then(|rest| rest.split_once(')'))
        .and_then(|(code, _)| code.parse().ok());
    (health.to_string(), exit_code)
}

/// Parses `docker ps`'s ports column. Only published ports are kept, and the
/// IPv4 and IPv6 bindings of the same mapping fold into one.
fn parse_ports(raw: &str) -> Vec<PublishedPort> {
    let mut ports: Vec<PublishedPort> = Vec::new();
    for entry in raw.split(", ") {
        let Some((host, container)) = entry.trim().split_once("->") else { continue };
        let Some((host_ip, host_port)) = host.rsplit_once(':') else { continue };
        let Some((container_port, protocol)) = container.split_once('/') else { continue };
        let (Ok(host_port), Ok(container_port)) = (host_port.parse(), container_port.parse()) else {
            continue;
        };
        let host_ip = match host_ip.trim_start_matches('[').trim_end_matches(']') {
            "0.0.0.0" | "::" => "*".to_string(),
            other => other.to_string(),
        };
        let port = PublishedPort { host_ip, host_port, container_port, protocol: protocol.to_string() };
        if !ports.contains(&port) {
            ports.push(port);
        }
    }
    ports
}

fn parse_ps(out: &str) -> Vec<Container> {
    out.lines()
        .filter_map(|line| serde_json::from_str::<PsRow>(line).ok())
        .map(|row| {
            let (health, exit_code) = parse_status(&row.status);
            Container {
                ports: parse_ports(&row.ports),
                id: row.id,
                name: row.name,
                image: row.image,
                state: row.state,
                health,
                exit_code,
                status: row.status,
                started_at: String::new(),
                finished_at: String::new(),
                compose_project: row.project,
                compose_service: row.service,
                compose_working_dir: row.working_dir,
            }
        })
        .collect()
}

/// Docker writes the zero time for a container that never started or stopped.
fn real_time(raw: String) -> String {
    if raw.starts_with("0001-") { String::new() } else { raw }
}

fn parse_inspect(out: &str) -> HashMap<String, (String, String)> {
    out.lines()
        .filter_map(|line| {
            let mut fields = line.split(' ').map(|f| serde_json::from_str::<String>(f).ok());
            let id = fields.next()??;
            let started = real_time(fields.next()??);
            let finished = real_time(fields.next()??);
            Some((id, (started, finished)))
        })
        .collect()
}

fn list() -> ContainersReport {
    let out = match child_env::command("docker")
        .args(["ps", "--all", "--no-trunc", "--format", PS_FORMAT])
        .output()
    {
        Ok(out) => out,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return ContainersReport::failed(DockerStatus::NotInstalled, String::new());
        }
        Err(e) => return ContainersReport::failed(DockerStatus::Error, e.to_string()),
    };
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return ContainersReport::failed(classify_error(&stderr), stderr);
    }

    let mut containers = parse_ps(&String::from_utf8_lossy(&out.stdout));
    if !containers.is_empty() {
        // A container removed between the two calls makes inspect exit non-zero
        // while still printing the others, so its output is read regardless.
        let times = child_env::command("docker")
            .args(["inspect", "--format", INSPECT_FORMAT])
            .args(containers.iter().map(|c| c.id.as_str()))
            .output()
            .map(|o| parse_inspect(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default();
        for c in containers.iter_mut() {
            if let Some((started, finished)) = times.get(&c.id) {
                c.started_at = started.clone();
                c.finished_at = finished.clone();
            }
        }
    }
    ContainersReport { status: DockerStatus::Ok, containers, message: String::new() }
}

#[tauri::command]
pub async fn list_containers() -> ContainersReport {
    list()
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Remove,
}

/// A container id or name as `docker ps` prints them. Anything else - above
/// all a leading dash - would reach the CLI as an option.
fn is_valid_ref(r: &str) -> bool {
    !r.is_empty()
        && !r.starts_with('-')
        && r.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn action_args(action: ContainerAction, ids: &[String]) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Err("no container given".into());
    }
    if let Some(bad) = ids.iter().find(|id| !is_valid_ref(id)) {
        return Err(format!("invalid container reference: {bad}"));
    }
    let verb = match action {
        ContainerAction::Start => "start",
        ContainerAction::Stop => "stop",
        ContainerAction::Restart => "restart",
        ContainerAction::Remove => "rm",
    };
    Ok(std::iter::once(verb.to_string()).chain(ids.iter().cloned()).collect())
}

fn run_docker(args: &[String], neutral_dir: bool) -> Result<(), String> {
    let mut cmd = child_env::command("docker");
    cmd.args(args);
    // Compose loads a compose file found in the working directory before it
    // falls back to the project's labels; a neutral directory keeps it on the labels.
    if neutral_dir {
        cmd.current_dir(std::env::temp_dir());
    }
    let out = cmd.output().map_err(|e| match e.kind() {
        ErrorKind::NotFound => "docker is not installed".to_string(),
        _ => e.to_string(),
    })?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Runs one action on several containers at once: a Compose project's start,
/// stop and restart are those of its containers.
#[tauri::command]
pub async fn container_action(ids: Vec<String>, action: ContainerAction) -> Result<(), String> {
    run_docker(&action_args(action, &ids)?, false)
}

/// `docker compose down` on a project known by name only: its compose file may
/// be gone, and the labels are enough for compose to find what it created.
#[tauri::command]
pub async fn compose_down(project: String) -> Result<(), String> {
    if !is_valid_ref(&project) {
        return Err(format!("invalid project name: {project}"));
    }
    run_docker(&["compose".into(), "--project-name".into(), project, "down".into()], true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_rows() {
        let out = concat!(
            r#"{"id":"abc","name":"kn-proxy-1","image":"nginx:alpine","state":"running","status":"Up 18 hours (healthy)","ports":"80/tcp, 0.0.0.0:8282->8282/tcp, [::]:8282->8282/tcp","project":"kn","service":"proxy","workingDir":"/home/me/kn"}"#,
            "\n",
            r#"{"id":"def","name":"lonely","image":"redis","state":"exited","status":"Exited (137) 2 hours ago","ports":"","project":"","service":"","workingDir":""}"#,
            "\nnot json\n",
        );
        let containers = parse_ps(out);
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].health, "healthy");
        assert_eq!(containers[0].exit_code, None);
        assert_eq!(containers[0].compose_project, "kn");
        assert_eq!(containers[0].compose_working_dir, "/home/me/kn");
        assert_eq!(containers[0].ports.len(), 1);
        assert_eq!(containers[1].exit_code, Some(137));
        assert_eq!(containers[1].health, "");
        assert!(containers[1].ports.is_empty());
    }

    #[test]
    fn keeps_published_ports_only_and_folds_families() {
        let ports = parse_ports(
            "7473/tcp, 0.0.0.0:7475->7474/tcp, [::]:7475->7474/tcp, 127.0.0.1:15432->5432/tcp, 0.0.0.0:53->53/udp",
        );
        assert_eq!(
            ports,
            vec![
                PublishedPort { host_ip: "*".into(), host_port: 7475, container_port: 7474, protocol: "tcp".into() },
                PublishedPort { host_ip: "127.0.0.1".into(), host_port: 15432, container_port: 5432, protocol: "tcp".into() },
                PublishedPort { host_ip: "*".into(), host_port: 53, container_port: 53, protocol: "udp".into() },
            ]
        );
    }

    #[test]
    fn reads_health_from_status() {
        assert_eq!(parse_status("Up About a minute (unhealthy)").0, "unhealthy");
        assert_eq!(parse_status("Up 2 seconds (health: starting)").0, "starting");
        assert_eq!(parse_status("Exited (0) 6 days ago"), (String::new(), Some(0)));
        assert_eq!(parse_status("Created"), (String::new(), None));
    }

    #[test]
    fn parses_inspect_times_and_drops_the_zero_time() {
        let out = "\"abc\" \"2026-11-12T16:35:16.9Z\" \"0001-01-01T00:00:00Z\"\ngarbage\n";
        let times = parse_inspect(out);
        assert_eq!(times.len(), 1);
        assert_eq!(times["abc"], ("2026-11-12T16:35:16.9Z".into(), String::new()));
    }

    #[test]
    fn classifies_cli_errors() {
        assert_eq!(
            classify_error("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock"),
            DockerStatus::PermissionDenied
        );
        assert_eq!(
            classify_error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"),
            DockerStatus::DaemonDown
        );
        assert_eq!(classify_error("error during connect: Get \"http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json\""), DockerStatus::DaemonDown);
        assert_eq!(classify_error("something else"), DockerStatus::Error);
    }

    #[test]
    fn builds_action_arguments() {
        let ids = vec!["abc".to_string(), "web-app-1".to_string()];
        assert_eq!(action_args(ContainerAction::Stop, &ids).unwrap(), ["stop", "abc", "web-app-1"]);
        assert_eq!(action_args(ContainerAction::Remove, &ids[..1]).unwrap(), ["rm", "abc"]);
    }

    #[test]
    fn refuses_a_reference_that_would_read_as_an_option() {
        assert!(action_args(ContainerAction::Remove, &["--force".to_string()]).is_err());
        assert!(action_args(ContainerAction::Stop, &["a b".to_string()]).is_err());
        assert!(action_args(ContainerAction::Start, &[]).is_err());
        assert!(is_valid_ref("cristal-meth_back.v2"));
    }
}
