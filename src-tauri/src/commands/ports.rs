// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Listening TCP ports of the machine and the processes that own them, read
//! back by the home Ports screen so a forgotten dev server can be found and
//! killed without leaving the app.

use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    /// `{pid}:{port}:{address}`, stable enough to key a list row on.
    pub id: String,
    pub pid: i32,
    pub port: u16,
    /// What the socket is bound to: `*`, `127.0.0.1`, `::1`...
    pub address: String,
    /// `IPv4`, `IPv6`, or both when the same endpoint is bound on each.
    pub family: String,
    pub process: String,
    /// Full command line, empty when it could not be read.
    #[serde(default)]
    pub command: String,
    pub user: String,
    /// False when the port belongs to another user, so the UI can explain why
    /// killing it will not work rather than failing on click.
    pub is_owned: bool,
}

#[cfg(unix)]
fn current_user() -> String {
    std::env::var("USER").unwrap_or_default()
}

#[cfg(not(unix))]
fn current_user() -> String {
    std::env::var("USERNAME").unwrap_or_default()
}

/// Splits `127.0.0.1:8080` / `*:7000` / `[::1]:3000` into address and port.
fn split_endpoint(name: &str) -> Option<(String, u16)> {
    let (addr, port) = name.rsplit_once(':')?;
    let port = port.parse().ok()?;
    let addr = addr.trim_start_matches('[').trim_end_matches(']');
    Some((addr.to_string(), port))
}

// The parsers and helpers below are compiled on every platform so their tests
// run everywhere; each is only called by its own platform's collector, hence
// the `dead_code` allowances.

/// The full command line of a process, empty when it cannot be read.
#[allow(dead_code)]
fn command_line(pid: i32) -> String {
    let out = Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

/// Parses `lsof -nP -iTCP -sTCP:LISTEN -F` field output. The machine-readable
/// form is used rather than the columns because a process name may contain
/// spaces, which makes the human output ambiguous.
#[allow(dead_code)]
fn parse_lsof(out: &str) -> Vec<ListeningPort> {
    let me = current_user();
    let mut ports: Vec<ListeningPort> = Vec::new();
    let mut pid = 0i32;
    let mut process = String::new();
    let mut user = String::new();
    let mut family = String::new();

    for line in out.lines() {
        let (tag, value) = match line.split_at_checked(1) {
            Some(v) => v,
            None => continue,
        };
        match tag {
            "p" => {
                pid = value.parse().unwrap_or(0);
                process.clear();
                user.clear();
            }
            "c" => process = value.to_string(),
            "L" => user = value.to_string(),
            "t" => family = value.to_string(),
            "n" => {
                let Some((address, port)) = split_endpoint(value) else { continue };
                // A process usually binds the same port on IPv4 and IPv6.
                // Listing it twice is noise, so the families merge into one row.
                if let Some(existing) = ports
                    .iter_mut()
                    .find(|p| p.pid == pid && p.port == port && p.address == address)
                {
                    if !existing.family.contains(family.as_str()) {
                        existing.family = format!("{}/{}", existing.family, family);
                    }
                    continue;
                }
                ports.push(ListeningPort {
                    id: format!("{pid}:{port}:{address}"),
                    pid,
                    port,
                    address,
                    family: family.clone(),
                    process: process.clone(),
                    command: String::new(),
                    user: user.clone(),
                    is_owned: user == me,
                });
            }
            _ => {}
        }
    }

    ports.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    ports
}

/// Maps `tasklist /fo csv` rows to `pid -> image name`. Windows sockets carry
/// only a pid, so the process name has to be looked up separately.
#[allow(dead_code)]
fn parse_tasklist(out: &str) -> std::collections::HashMap<i32, String> {
    let mut names = std::collections::HashMap::new();
    for line in out.lines() {
        let fields: Vec<&str> = line.split("\",\"").collect();
        if fields.len() < 2 {
            continue;
        }
        let name = fields[0].trim_matches('"').to_string();
        if let Ok(pid) = fields[1].trim_matches('"').trim().parse::<i32>() {
            names.insert(pid, name);
        }
    }
    names
}

/// Parses `netstat -ano`, keeping only the LISTENING rows. Columns are
/// whitespace separated: proto, local address, foreign address, state, pid.
#[allow(dead_code)]
fn parse_netstat(out: &str, names: &std::collections::HashMap<i32, String>) -> Vec<ListeningPort> {
    let me = current_user();
    let mut ports: Vec<ListeningPort> = Vec::new();

    for line in out.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[0].eq_ignore_ascii_case("TCP") || cols[3] != "LISTENING" {
            continue;
        }
        let Some((raw_address, port)) = split_endpoint(cols[1]) else { continue };
        let Ok(pid) = cols[4].parse::<i32>() else { continue };
        let family = if raw_address.contains(':') { "IPv6" } else { "IPv4" };
        // netstat spells the wildcard `0.0.0.0` on IPv4 and `::` on IPv6, where
        // lsof writes `*` for both. Normalising lets the two rows of the same
        // listener collapse, and keeps the display consistent across platforms.
        let address = match raw_address.as_str() {
            "0.0.0.0" | "::" => "*".to_string(),
            _ => raw_address,
        };

        if let Some(existing) = ports
            .iter_mut()
            .find(|p| p.pid == pid && p.port == port && p.address == address)
        {
            if !existing.family.contains(family) {
                existing.family = format!("{}/{}", existing.family, family);
            }
            continue;
        }
        ports.push(ListeningPort {
            id: format!("{pid}:{port}:{address}"),
            pid,
            port,
            address,
            family: family.to_string(),
            process: names.get(&pid).cloned().unwrap_or_default(),
            command: String::new(),
            user: me.clone(),
            // netstat reports every listener regardless of owner, but taskkill
            // still refuses another user's process. Assuming ownership here
            // would promise a kill that fails; the error surfaces on click.
            is_owned: true,
        });
    }

    ports.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    ports
}

#[cfg(unix)]
#[tauri::command]
pub async fn list_listening_ports() -> Result<Vec<ListeningPort>, String> {
    let out = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLtn"])
        .output()
        .map_err(|e| format!("lsof failed: {e}"))?;

    // lsof exits non-zero when some sockets could not be read, which is the
    // normal case for another user's processes. Only an empty result is fatal.
    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() && !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut ports = parse_lsof(&text);
    for p in ports.iter_mut() {
        p.command = command_line(p.pid);
    }
    Ok(ports)
}

#[cfg(windows)]
#[tauri::command]
pub async fn list_listening_ports() -> Result<Vec<ListeningPort>, String> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .map_err(|e| format!("netstat failed: {e}"))?;

    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() && !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let names = Command::new("tasklist")
        .args(["/fo", "csv", "/nh"])
        .output()
        .map(|o| parse_tasklist(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    Ok(parse_netstat(&text, &names))
}

/// Sends SIGTERM, or SIGKILL when `force` is set.
#[cfg(unix)]
#[tauri::command]
pub async fn kill_process(pid: i32, force: bool) -> Result<(), String> {
    if pid <= 1 {
        return Err(format!("refusing to kill pid {pid}"));
    }
    let signal = if force { "-9" } else { "-15" };
    let out = Command::new("kill")
        .args([signal, &pid.to_string()])
        .output()
        .map_err(|e| format!("kill failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// `taskkill` asks the process to close; `/f` is the forced equivalent of a
/// SIGKILL. The system pids are refused the same way as on unix.
#[cfg(windows)]
#[tauri::command]
pub async fn kill_process(pid: i32, force: bool) -> Result<(), String> {
    if pid <= 4 {
        return Err(format!("refusing to kill pid {pid}"));
    }
    let mut cmd = Command::new("taskkill");
    cmd.args(["/pid", &pid.to_string()]);
    if force {
        cmd.arg("/f");
    }
    let out = cmd.output().map_err(|e| format!("taskkill failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err.trim().to_string()
        };
        return Err(msg);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_field_output() {
        let out = "p1711\ncnode\nLada\ntIPv4\nn127.0.0.1:7357\np683\ncControlCe\nLada\ntIPv4\nn*:7000\ntIPv6\nn*:7000\n";
        let ports = parse_lsof(out);
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 7000);
        assert_eq!(ports[0].address, "*");
        assert_eq!(ports[0].process, "ControlCe");
        assert_eq!(ports[0].family, "IPv4/IPv6");
        assert_eq!(ports[1].port, 7357);
        assert_eq!(ports[1].address, "127.0.0.1");
        assert_eq!(ports[1].pid, 1711);
    }

    #[test]
    fn splits_ipv6_endpoint() {
        assert_eq!(split_endpoint("[::1]:3000"), Some(("::1".into(), 3000)));
        assert_eq!(split_endpoint("*:80"), Some(("*".into(), 80)));
        assert_eq!(split_endpoint("nonsense"), None);
    }

    #[test]
    fn parses_netstat_output() {
        let out = concat!(
            "\r\nActive Connections\r\n\r\n",
            "  Proto  Local Address          Foreign Address        State           PID\r\n",
            "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       996\r\n",
            "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       7412\r\n",
            "  TCP    [::]:135               [::]:0                 LISTENING       996\r\n",
            "  TCP    127.0.0.1:5173         127.0.0.1:60122        ESTABLISHED     7412\r\n",
        );
        let mut names = std::collections::HashMap::new();
        names.insert(7412, "node.exe".to_string());
        let ports = parse_netstat(out, &names);

        // The ESTABLISHED row is dropped, and 135 collapses its two families.
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 135);
        assert_eq!(ports[0].address, "*");
        assert_eq!(ports[0].family, "IPv4/IPv6");
        assert_eq!(ports[1].port, 5173);
        assert_eq!(ports[1].pid, 7412);
        assert_eq!(ports[1].process, "node.exe");
    }
}
