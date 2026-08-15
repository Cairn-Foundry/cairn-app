use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

pub mod client;
pub mod registry;
pub mod server;

use registry::{
    catalog, detect_version, find_def, manager_options, owning_manager, resolve_command,
    resolve_root, shares_removal_with, BinaryCache, LanguageServerDef, ManagerCommands,
};
use server::{emit_status, path_to_uri, uri_to_path, ServerHandle, ServerStatus};

/// A server that failed to start three times in a row stays down: retrying
/// forever would spawn a process on every keystroke that reopens the file.
const MAX_START_ATTEMPTS: u32 = 3;

/// Enough of the tail to explain a failure, bounded so a chatty manager cannot
/// grow the buffer without end.
const MANAGER_LOG_MAX: usize = 200;

/// What a cancelled command answers with, so the frontend can tell it apart
/// from a real failure and stay quiet about it.
pub const CANCELLED: &str = "cancelled";

struct RunningCommand {
    child:     Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

/// stdout and stderr are different types but read the same way.
enum Either {
    Out(ChildStdout),
    Err(ChildStderr),
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ServerKey {
    server_id: String,
    root:      PathBuf,
}

#[derive(Default)]
pub struct LspState {
    servers:  Mutex<HashMap<ServerKey, Arc<ServerHandle>>>,
    attempts: Mutex<HashMap<ServerKey, u32>>,
    /// One lock per server and root, held across the whole spawn. Opening two
    /// files of the same language at once - a split view, or a session being
    /// restored - otherwise has both calls find nothing running and start their
    /// own process, and the second insert drops the first handle on the floor.
    /// The global map is never held while a server starts: that takes seconds.
    starting: Mutex<HashMap<ServerKey, Arc<Mutex<()>>>>,
    running_commands: Mutex<HashMap<CommandKey, Arc<RunningCommand>>>,
}

impl LspState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Installing and removing the same server are two different jobs, and a cancel
/// must reach exactly the one it was asked for.
#[derive(Clone, PartialEq, Eq, Hash)]
struct CommandKey {
    server_id: String,
    kind:      &'static str,
}

/// Runs a blocking body off the async runtime. Every language server call can
/// wait on a process that is thinking - `initialize` for a minute, a request
/// for ten seconds - and a Tokio worker parked on one is a worker no other
/// command can use.
async fn blocking<T, F>(body: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(body)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInfo {
    pub id:                String,
    pub name:              String,
    pub binary:            String,
    pub args:              Vec<String>,
    pub extensions:        Vec<String>,
    pub language_ids:      Vec<String>,
    pub root_markers:      Vec<String>,
    /// A server the user declared: Cairn runs it but never installs or removes it.
    pub custom:            bool,
    pub install_options:   Vec<registry::ManagerOption>,
    pub uninstall_options: Vec<registry::ManagerOption>,
    pub update_options:    Vec<registry::ManagerOption>,
    /// Other servers the removal command would take down with this one.
    pub also_removes:      Vec<String>,
    pub doc_url:           String,
    pub binary_path:       Option<String>,
    pub version:           Option<String>,
    pub status:            ServerStatus,
    pub running_root:      Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerEvent {
    server_id: String,
    line:      String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspLocation {
    pub path:          String,
    pub line:          u32,
    pub character:     u32,
    pub end_line:      u32,
    pub end_character: u32,
    /// The source line the hit sits on. A list of line numbers tells nobody
    /// which usage is which, so the panel shows the code alongside them.
    pub text:          Option<String>,
}

/// The longest source line worth carrying back: a minified bundle can hold a
/// whole file on one line, and the panel only shows a fragment of it anyway.
const SOURCE_LINE_MAX: usize = 400;

/// Fills in the source line of every hit, reading each file once however many
/// hits it holds.
fn with_source_lines(mut locations: Vec<LspLocation>) -> Vec<LspLocation> {
    let mut files: HashMap<String, Option<Vec<String>>> = HashMap::new();
    for location in &mut locations {
        let lines = files.entry(location.path.clone()).or_insert_with(|| {
            std::fs::read_to_string(&location.path)
                .ok()
                .map(|text| text.lines().map(str::to_string).collect())
        });
        location.text = lines
            .as_ref()
            .and_then(|lines| lines.get(location.line as usize))
            .map(|line| {
                let trimmed = line.trim();
                match trimmed.char_indices().nth(SOURCE_LINE_MAX) {
                    Some((cut, _)) => trimmed[..cut].to_string(),
                    None => trimmed.to_string(),
                }
            });
    }
    locations
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspFileEdit {
    pub path:  String,
    pub edits: Value,
}

fn state(app: &tauri::AppHandle) -> tauri::State<'_, LspState> {
    app.state::<LspState>()
}

fn running(app: &tauri::AppHandle, server_id: &str, root: &Path) -> Option<Arc<ServerHandle>> {
    let key = ServerKey { server_id: server_id.to_string(), root: root.to_path_buf() };
    let handle = state(app).servers.lock().ok()?.get(&key).cloned()?;
    handle.is_alive().then_some(handle)
}

fn require(app: &tauri::AppHandle, server_id: &str, root: &str) -> Result<Arc<ServerHandle>, String> {
    running(app, server_id, Path::new(root))
        .ok_or_else(|| format!("{server_id} is not running on {root}"))
}

fn position_params(path: &str, line: u32, character: u32) -> Value {
    json!({
        "textDocument": { "uri": path_to_uri(Path::new(path)) },
        "position": { "line": line, "character": character },
    })
}

fn range_of(value: &Value) -> Option<(u32, u32, u32, u32)> {
    let start = value.get("start")?;
    let end = value.get("end")?;
    Some((
        start.get("line")?.as_u64()? as u32,
        start.get("character")?.as_u64()? as u32,
        end.get("line")?.as_u64()? as u32,
        end.get("character")?.as_u64()? as u32,
    ))
}

/// Definition, references and implementation each answer with `Location`,
/// `Location[]` or `LocationLink[]`. They are flattened here so the panel never
/// has to know which one it got.
fn to_locations(value: &Value) -> Vec<LspLocation> {
    fn push_one(out: &mut Vec<LspLocation>, item: &Value) {
        let uri = item
            .get("uri")
            .or_else(|| item.get("targetUri"))
            .and_then(Value::as_str);
        let range = item
            .get("range")
            .or_else(|| item.get("targetSelectionRange"))
            .or_else(|| item.get("targetRange"));
        let (Some(uri), Some(range)) = (uri, range) else { return };
        let (Some(path), Some((line, character, end_line, end_character))) =
            (uri_to_path(uri), range_of(range))
        else {
            return;
        };
        out.push(LspLocation {
            path: path.to_string_lossy().to_string(),
            line,
            character,
            end_line,
            end_character,
            text: None,
        });
    }

    let mut out = Vec::new();
    match value {
        Value::Array(items) => {
            for item in items {
                push_one(&mut out, item);
            }
        }
        Value::Object(_) => push_one(&mut out, value),
        _ => {}
    }
    out
}

#[tauri::command]
pub async fn list_language_servers(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<Vec<LanguageServerInfo>, String> {
    blocking(move || {
        let lookup_root = root.as_deref().map(Path::new);
        let mut cache = BinaryCache::default();
        let catalog = catalog();

        let binaries: Vec<Option<PathBuf>> = catalog
            .iter()
            .map(|def| cache.resolve(&def.binary, lookup_root))
            .collect();

        // Each `--version` is a process spawn, so ten servers asked one after
        // the other are ten waits stacked on the scan the user is looking at.
        let versions: Vec<Option<String>> = std::thread::scope(|scope| {
            let probes: Vec<_> = binaries
                .iter()
                .map(|path| scope.spawn(move || path.as_deref().and_then(detect_version)))
                .collect();
            probes.into_iter().map(|probe| probe.join().unwrap_or(None)).collect()
        });

        let live_servers: HashMap<String, (ServerStatus, String)> = state(&app)
            .servers
            .lock()
            .map(|servers| {
                catalog
                    .iter()
                    .filter_map(|def| {
                        let (key, handle) = servers
                            .iter()
                            .find(|(key, handle)| key.server_id == def.id && handle.is_alive())?;
                        let status = handle.status.lock().map(|s| *s).unwrap_or(ServerStatus::Stopped);
                        Some((def.id.clone(), (status, key.root.to_string_lossy().to_string())))
                    })
                    .collect()
            })
            .unwrap_or_default();

        let out = catalog
            .iter()
            .zip(binaries)
            .zip(versions)
            .map(|((def, binary_path), version)| {
                let live = live_servers.get(&def.id);
                LanguageServerInfo {
                    id:                def.id.clone(),
                    name:              def.name.clone(),
                    binary:            def.binary.clone(),
                    args:              def.args.clone(),
                    extensions:        def.extensions.clone(),
                    language_ids:      def.language_ids.clone(),
                    root_markers:      def.root_markers.clone(),
                    custom:            def.custom,
                    install_options:   manager_options(&def.install, &mut cache),
                    uninstall_options: manager_options(&def.uninstall, &mut cache),
                    update_options:    manager_options(&def.update, &mut cache),
                    also_removes:      shares_removal_with(def, &catalog),
                    doc_url:           def.doc_url.clone(),
                    binary_path:       binary_path.map(|p| p.to_string_lossy().to_string()),
                    version,
                    status:            live.map(|(s, _)| *s).unwrap_or(ServerStatus::Stopped),
                    running_root:      live.map(|(_, r)| r.clone()),
                }
            })
            .collect();

        Ok(out)
    })
    .await
}

/// Package managers redraw their progress in place with a carriage return and
/// paint it with escape codes. Both are stripped so the line can be shown as
/// plain text. Colours arrive as CSI (`ESC [ ... letter`), and the title a
/// manager sets on the terminal as OSC (`ESC ] ... BEL` or `ESC \`) - whose
/// payload is words, so leaving it in would read as output.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            Some(']') => {
                let mut previous = '\0';
                for c in chars.by_ref() {
                    if c == '\u{7}' || (c == '\\' && previous == '\u{1b}') {
                        break;
                    }
                    previous = c;
                }
            }
            _ => {}
        }
    }
    out
}

/// Reads a pipe and hands back one line at a time. Splits on carriage returns
/// too, so a manager that rewrites a single status line still reports progress
/// instead of staying silent until it ends.
fn pump_lines(stream: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = std::io::BufReader::new(stream);
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];
    let flush = |pending: &mut Vec<u8>, on_line: &mut dyn FnMut(String)| {
        let line = strip_ansi(String::from_utf8_lossy(pending).trim());
        pending.clear();
        if !line.is_empty() {
            on_line(line);
        }
    };
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                for byte in &chunk[..read] {
                    match byte {
                        b'\n' | b'\r' => flush(&mut pending, &mut on_line),
                        _ => pending.push(*byte),
                    }
                }
            }
        }
    }
    flush(&mut pending, &mut on_line);
}

/// Installs a server with one of the package managers the catalogue lists for
/// it. Always user-triggered, and always cancellable: on a slow network the
/// output is the only sign of life, so every line is emitted as it arrives.
#[tauri::command]
pub async fn install_language_server(
    app: tauri::AppHandle,
    server_id: String,
    manager: String,
) -> Result<String, String> {
    let output = run_manager_command(app.clone(), server_id.clone(), manager, "install", |def| {
        &def.install
    })
    .await?;
    // The binary that was missing is the reason the server failed to start, so
    // installing it has to lift the ban those failures put on it.
    if let Ok(mut attempts) = state(&app).attempts.lock() {
        attempts.retain(|key, _| key.server_id != server_id);
    }
    Ok(output)
}

/// A registry can be slow, and a manager waiting on a network that will never
/// answer must not hold the check open for ever.
const CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub server_id: String,
    /// `true` outdated, `false` up to date, `None` when nothing could be
    /// established - no manager to ask, no answer, or a version neither side
    /// could parse. An unknown state is reported as unknown, never as up to date.
    pub outdated:  Option<bool>,
    /// The version the manager would install, when it names one. Homebrew only
    /// says whether a formula is outdated, so this stays empty for it.
    pub latest:    Option<String>,
    pub manager:   Option<String>,
}

/// Runs a check command and hands back what it printed on stdout, plus whether
/// it succeeded. `None` when it could not be run at all or outran the timeout.
fn run_check(command: &str) -> Option<(bool, String)> {
    let mut child = registry::spawn_shell(command).ok()?;
    let deadline = std::time::Instant::now() + CHECK_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(_) => return None,
        }
    };

    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut out);
    }
    Some((status.success(), out))
}

/// Asks every installed server's manager whether a newer version exists. Never
/// runs on its own: it is one process and one network round-trip per server, so
/// it happens when the user asks for it and the answer holds until they ask again.
#[tauri::command]
pub async fn check_language_server_updates(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<Vec<UpdateCheck>, String> {
    let _ = app;
    blocking(move || {
        let lookup_root = root.as_deref().map(Path::new);
        let mut cache = BinaryCache::default();
        let catalog = catalog();

        // Everything the check needs is gathered first, on one thread: probing
        // binaries and reading versions is filesystem work, and the network
        // calls are what deserve to run in parallel.
        type Job = (String, Option<(String, &'static str)>, Option<String>);
        let jobs: Vec<Job> = catalog
            .iter()
            .filter(|def| !def.custom)
            .filter_map(|def| {
                // An entry is made for every installed server, even one nothing
                // can be asked about: the page has to tell "checked, and it
                // could not be established" apart from "never checked".
                let binary = cache.resolve(&def.binary, lookup_root)?;
                let options = manager_options(&def.check, &mut cache);
                // Only the manager that put the binary there can speak for it.
                // A rust-analyzer installed by rustup is not a Homebrew formula,
                // and asking Homebrew about it answers about something else.
                let chosen = match owning_manager(&binary) {
                    Some(owner) => options.iter().find(|o| o.manager == owner && o.available),
                    None => options.iter().find(|o| o.available),
                };
                Some((
                    def.id.clone(),
                    chosen.map(|o| (o.manager.to_string(), o.command)),
                    detect_version(&binary),
                ))
            })
            .collect();

        let checks = std::thread::scope(|scope| {
            let probes: Vec<_> = jobs
                .iter()
                .map(|(id, chosen, installed)| {
                    scope.spawn(move || {
                        let answer = chosen.as_ref().and_then(|(_, command)| run_check(command));
                        let manager = chosen.as_ref().map(|(manager, _)| manager.clone());
                        decide(id.clone(), manager, installed.as_deref(), answer)
                    })
                })
                .collect();
            probes
                .into_iter()
                .filter_map(|probe| probe.join().ok())
                .collect::<Vec<UpdateCheck>>()
        });

        Ok(checks)
    })
    .await
}

/// Turns what a manager printed into a verdict. Kept apart from the process
/// handling so every branch of it can be tested without spawning anything.
fn decide(
    server_id: String,
    manager: Option<String>,
    installed: Option<&str>,
    answer: Option<(bool, String)>,
) -> UpdateCheck {
    let unknown = |manager: Option<String>| UpdateCheck {
        server_id: server_id.clone(),
        outdated: None,
        latest: None,
        manager,
    };

    // Nothing to ask: the manager that installed this binary publishes no
    // version to compare against - rustup hands out whatever the toolchain
    // carries - or none of its managers is on this machine.
    let Some(manager) = manager else { return unknown(None) };
    let Some((succeeded, output)) = answer else { return unknown(Some(manager)) };

    if registry::answers_with_a_flag(&manager) {
        // The formula name on stdout means there is something to upgrade;
        // nothing on stdout and a clean exit means there is not. Nothing on
        // stdout after a failure is an error, not an answer.
        let outdated = match (output.trim().is_empty(), succeeded) {
            (false, _) => Some(true),
            (true, true) => Some(false),
            (true, false) => None,
        };
        return UpdateCheck { server_id, outdated, latest: None, manager: Some(manager) };
    }

    if !succeeded {
        return unknown(Some(manager));
    }
    let Some(latest) = registry::parse_version(&output) else { return unknown(Some(manager)) };
    let latest = latest.iter().map(u64::to_string).collect::<Vec<_>>().join(".");
    let outdated = installed.and_then(|installed| registry::is_newer(installed, &latest));
    UpdateCheck { server_id, outdated, latest: Some(latest), manager: Some(manager) }
}

/// Brings an installed server up to date with one of its managers. The server
/// is stopped first: the update replaces the binary a running process is
/// executing, and what it goes on serving afterwards is anyone's guess. The
/// next file to be opened starts the new one.
#[tauri::command]
pub async fn update_language_server(
    app: tauri::AppHandle,
    server_id: String,
    manager: String,
) -> Result<String, String> {
    {
        let app = app.clone();
        let server_id = server_id.clone();
        blocking(move || stop_servers_with_id(&app, &server_id)).await?;
    }
    let output =
        run_manager_command(app.clone(), server_id.clone(), manager, "update", |def| &def.update)
            .await?;
    if let Ok(mut attempts) = state(&app).attempts.lock() {
        attempts.retain(|key, _| key.server_id != server_id);
    }
    Ok(output)
}

/// Removes a server with the package manager that put it there. Any instance
/// still running is stopped first, so nothing keeps talking to a binary that is
/// about to disappear.
#[tauri::command]
pub async fn uninstall_language_server(
    app: tauri::AppHandle,
    server_id: String,
    manager: String,
) -> Result<String, String> {
    {
        let app = app.clone();
        let server_id = server_id.clone();
        blocking(move || stop_servers_with_id(&app, &server_id)).await?;
    }
    run_manager_command(app, server_id, manager, "uninstall", |def| &def.uninstall).await
}

async fn run_manager_command(
    app: tauri::AppHandle,
    server_id: String,
    manager: String,
    kind: &'static str,
    pick: fn(&LanguageServerDef) -> &ManagerCommands,
) -> Result<String, String> {
    let def = find_def(&server_id).ok_or_else(|| format!("unknown language server: {server_id}"))?;
    let command = resolve_command(pick(&def), &manager)
        .ok_or_else(|| format!("{} has no {manager} command", def.name))?;

    let key = CommandKey { server_id: server_id.clone(), kind };
    blocking(move || run_shell(app, server_id, key, command)).await
}

/// The manager a removal should go through: the one whose fingerprint the
/// installed binary carries, or failing that the first one available.
#[tauri::command]
pub async fn uninstall_manager_for(server_id: String) -> Result<Option<String>, String> {
    blocking(move || manager_for(&server_id, |def| &def.uninstall)).await
}

/// The manager an update should go through, chosen the same way: a server put
/// there by Homebrew is updated by Homebrew, not by whichever manager happens
/// to be installed alongside it.
#[tauri::command]
pub async fn update_manager_for(server_id: String) -> Result<Option<String>, String> {
    blocking(move || manager_for(&server_id, |def| &def.update)).await
}

fn manager_for(
    server_id: &str,
    pick: fn(&LanguageServerDef) -> &ManagerCommands,
) -> Result<Option<String>, String> {
    let def = find_def(server_id).ok_or_else(|| format!("unknown language server: {server_id}"))?;
    let mut cache = BinaryCache::default();
    let options = manager_options(pick(&def), &mut cache);
    let owner = cache
        .resolve(&def.binary, None)
        .as_deref()
        .and_then(owning_manager);

    let chosen = owner
        .and_then(|owner| options.iter().find(|o| o.manager == owner && o.available))
        .or_else(|| options.iter().find(|o| o.available));
    Ok(chosen.map(|o| o.manager.to_string()))
}

fn stop_servers_with_id(app: &tauri::AppHandle, server_id: &str) -> Result<(), String> {
    stop_matching(app, |key| key.server_id == server_id)
}

fn run_shell(
    app: tauri::AppHandle,
    server_id: String,
    key: CommandKey,
    command: &str,
) -> Result<String, String> {
    let mut child = registry::spawn_shell(command)
        .map_err(|e| format!("failed to run the command: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let running = Arc::new(RunningCommand {
        child:     Mutex::new(Some(child)),
        cancelled: AtomicBool::new(false),
    });
    state(&app)
        .running_commands
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.clone(), Arc::clone(&running));

    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let readers: Vec<_> = [stdout.map(Either::Out), stderr.map(Either::Err)]
        .into_iter()
        .flatten()
        .map(|stream| {
            let app = app.clone();
            let id = server_id.clone();
            let log = Arc::clone(&log);
            std::thread::spawn(move || {
                let emit = |line: String| {
                    if let Ok(mut log) = log.lock() {
                        if log.len() == MANAGER_LOG_MAX {
                            log.remove(0);
                        }
                        log.push(line.clone());
                    }
                    let _ = app.emit("lsp-manager", ManagerEvent { server_id: id.clone(), line });
                };
                match stream {
                    Either::Out(out) => pump_lines(out, emit),
                    Either::Err(err) => pump_lines(err, emit),
                }
            })
        })
        .collect();

    for reader in readers {
        let _ = reader.join();
    }

    let status = running
        .child
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .map(|mut child| child.wait());
    state(&app).running_commands.lock().map_err(|e| e.to_string())?.remove(&key);

    if running.cancelled.load(Ordering::SeqCst) {
        return Err(CANCELLED.to_string());
    }

    let output = log.lock().map(|log| log.join("\n")).unwrap_or_default();
    match status {
        Some(Ok(status)) if status.success() => Ok(output),
        Some(Ok(_)) => Err(if output.is_empty() { "the command failed".into() } else { output }),
        Some(Err(e)) => Err(e.to_string()),
        None => Err("the command vanished".to_string()),
    }
}

/// Takes every language server down. Called when the window closes: a server
/// is a child process, and a child process is not killed by its parent ending.
/// Well-behaved ones watch the `processId` they were handed at `initialize` and
/// leave on their own, but that is a courtesy, not a guarantee - and an orphan
/// rust-analyzer indexing a repository is not one to leave to chance.
pub fn shutdown(app: &tauri::AppHandle) {
    let _ = stop_matching(app, |_| true);
}

/// Stops an install in flight. A download that turned out to be too slow has to
/// be abandonable without waiting it out.
#[tauri::command]
pub async fn cancel_language_server_command(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    let running: Vec<Arc<RunningCommand>> = state(&app)
        .running_commands
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|(key, _)| key.server_id == server_id)
        .map(|(_, command)| Arc::clone(command))
        .collect();

    for running in running {
        running.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = running.child.lock() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
            }
        }
    }
    Ok(())
}

/// Starts the server covering `file_path` if it is not already running on that
/// file's workspace root, and answers with the root every later call must use.
#[tauri::command]
pub async fn start_language_server(
    app: tauri::AppHandle,
    server_id: String,
    worktree: String,
    file_path: String,
    command: String,
    args: Vec<String>,
) -> Result<String, String> {
    blocking(move || {
        let def = find_def(&server_id).ok_or_else(|| format!("unknown language server: {server_id}"))?;
        let root = resolve_root(&def, Path::new(&worktree), Path::new(&file_path));
        let key = ServerKey { server_id: server_id.clone(), root: root.clone() };
        let lsp = state(&app);

        let gate = {
            let mut starting = lsp.starting.lock().map_err(|e| e.to_string())?;
            Arc::clone(starting.entry(key.clone()).or_default())
        };
        let _guard = gate.lock().map_err(|e| e.to_string())?;

        // Re-checked under the gate: whoever went first may have started it.
        if running(&app, &server_id, &root).is_some() {
            return Ok(root.to_string_lossy().to_string());
        }

        {
            let attempts = lsp.attempts.lock().map_err(|e| e.to_string())?;
            if attempts.get(&key).copied().unwrap_or(0) >= MAX_START_ATTEMPTS {
                return Err(format!("{server_id} failed to start too many times"));
            }
        }

        emit_status(&app, &server_id, &root, ServerStatus::Starting, None);

        match server::start(&app, &def, &root, &command, &args) {
            Ok(handle) => {
                lsp.servers.lock().map_err(|e| e.to_string())?.insert(key.clone(), handle);
                lsp.attempts.lock().map_err(|e| e.to_string())?.remove(&key);
                emit_status(&app, &server_id, &root, ServerStatus::Ready, None);
                Ok(root.to_string_lossy().to_string())
            }
            Err(e) => {
                let mut attempts = lsp.attempts.lock().map_err(|e| e.to_string())?;
                *attempts.entry(key).or_insert(0) += 1;
                drop(attempts);
                emit_status(&app, &server_id, &root, ServerStatus::Failed, Some(e.clone()));
                Err(e)
            }
        }
    })
    .await
}

/// Every server of an id goes down, whatever root it runs on. What the switch
/// on the Language servers page calls for: turning a server off has to stop the
/// process, not only stop the next file from waking it.
#[tauri::command]
pub async fn stop_language_servers_with_id(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    blocking(move || stop_servers_with_id(&app, &server_id)).await
}

/// Every server started for a worktree goes down with it: closing a project
/// must not leave a process per language behind.
#[tauri::command]
pub async fn stop_language_servers_for(app: tauri::AppHandle, worktree: String) -> Result<(), String> {
    blocking(move || {
        let worktree = PathBuf::from(worktree);
        stop_matching(&app, |key| key.root.starts_with(&worktree))
    })
    .await
}

/// Takes down every server whose key the predicate accepts. The map is never
/// held while a server shuts down - that waits on the process.
fn stop_matching(
    app: &tauri::AppHandle,
    accept: impl Fn(&ServerKey) -> bool,
) -> Result<(), String> {
    let lsp = state(app);
    let stopped: Vec<(ServerKey, Arc<ServerHandle>)> = {
        let mut servers = lsp.servers.lock().map_err(|e| e.to_string())?;
        let keys: Vec<ServerKey> = servers.keys().filter(|key| accept(key)).cloned().collect();
        keys.into_iter()
            .filter_map(|key| servers.remove(&key).map(|handle| (key, handle)))
            .collect()
    };
    if let Ok(mut starting) = lsp.starting.lock() {
        starting.retain(|key, _| !accept(key));
    }
    // A stop is the user's own signal to try again: a server that hit
    // MAX_START_ATTEMPTS and was banned for the session gets a clean slate
    // rather than requiring a full app restart to be usable again.
    if let Ok(mut attempts) = lsp.attempts.lock() {
        attempts.retain(|key, _| !accept(key));
    }

    for (key, handle) in stopped {
        server::stop(&handle);
        emit_status(app, &key.server_id, &key.root, ServerStatus::Stopped, None);
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_open(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    language_id: String,
    text: String,
) -> Result<(), String> {
    blocking(move || {
        let handle = require(&app, &server_id, &root)?;
        // Claimed in one turn of the lock: two panes opening the same file at
        // once would otherwise both find it absent and announce it twice.
        let claimed = match handle.open_docs.lock().map_err(|e| e.to_string())?.entry(PathBuf::from(&path)) {
            std::collections::hash_map::Entry::Occupied(_) => false,
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(1);
                true
            }
        };
        if !claimed {
            return Ok(());
        }

        handle.notify("textDocument/didOpen", json!({
            "textDocument": {
                "uri": path_to_uri(Path::new(&path)),
                "languageId": language_id,
                "version": 1,
                "text": text,
            }
        }))
    })
    .await
}

#[tauri::command]
pub async fn lsp_did_change(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    blocking(move || {
        let handle = require(&app, &server_id, &root)?;
        let file = PathBuf::from(&path);
        let version = {
            let mut docs = handle.open_docs.lock().map_err(|e| e.to_string())?;
            let Some(version) = docs.get_mut(&file) else { return Ok(()) };
            *version += 1;
            *version
        };

        handle.notify("textDocument/didChange", json!({
            "textDocument": { "uri": path_to_uri(Path::new(&path)), "version": version },
            "contentChanges": [{ "text": text }],
        }))
    })
    .await
}

#[tauri::command]
pub async fn lsp_did_save(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    blocking(move || {
        require(&app, &server_id, &root)?.notify("textDocument/didSave", json!({
            "textDocument": { "uri": path_to_uri(Path::new(&path)) },
            "text": text,
        }))
    })
    .await
}

#[tauri::command]
pub async fn lsp_did_close(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
) -> Result<(), String> {
    blocking(move || {
        let handle = require(&app, &server_id, &root)?;
        let removed = handle
            .open_docs
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&PathBuf::from(&path))
            .is_some();
        if !removed {
            return Ok(());
        }
        handle.notify("textDocument/didClose", json!({
            "textDocument": { "uri": path_to_uri(Path::new(&path)) }
        }))
    })
    .await
}

#[tauri::command]
pub async fn lsp_completion(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    blocking(move || {
        require(&app, &server_id, &root)?
            .request("textDocument/completion", position_params(&path, line, character))
    })
    .await
}

#[tauri::command]
pub async fn lsp_hover(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    blocking(move || {
        require(&app, &server_id, &root)?
            .request("textDocument/hover", position_params(&path, line, character))
    })
    .await
}

#[tauri::command]
pub async fn lsp_signature_help(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    blocking(move || {
        require(&app, &server_id, &root)?
            .request("textDocument/signatureHelp", position_params(&path, line, character))
    })
    .await
}

#[tauri::command]
pub async fn lsp_definition(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspLocation>, String> {
    blocking(move || {
        let result = require(&app, &server_id, &root)?
            .request("textDocument/definition", position_params(&path, line, character))?;
        Ok(with_source_lines(to_locations(&result)))
    })
    .await
}

#[tauri::command]
pub async fn lsp_implementation(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspLocation>, String> {
    blocking(move || {
        let result = require(&app, &server_id, &root)?
            .request("textDocument/implementation", position_params(&path, line, character))?;
        Ok(with_source_lines(to_locations(&result)))
    })
    .await
}

#[tauri::command]
pub async fn lsp_references(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<Vec<LspLocation>, String> {
    blocking(move || {
        let mut params = position_params(&path, line, character);
        params["context"] = json!({ "includeDeclaration": include_declaration });
        let result = require(&app, &server_id, &root)?.request("textDocument/references", params)?;
        Ok(with_source_lines(to_locations(&result)))
    })
    .await
}

#[tauri::command]
pub async fn lsp_rename(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    line: u32,
    character: u32,
    new_name: String,
) -> Result<Vec<LspFileEdit>, String> {
    blocking(move || {
        let mut params = position_params(&path, line, character);
        params["newName"] = Value::String(new_name);
        let result = require(&app, &server_id, &root)?.request("textDocument/rename", params)?;

        let mut out = Vec::new();
        if let Some(changes) = result.get("changes").and_then(Value::as_object) {
            for (uri, edits) in changes {
                if let Some(path) = uri_to_path(uri) {
                    out.push(LspFileEdit { path: path.to_string_lossy().to_string(), edits: edits.clone() });
                }
            }
        }
        if let Some(document_changes) = result.get("documentChanges").and_then(Value::as_array) {
            for change in document_changes {
                let uri = change
                    .get("textDocument")
                    .and_then(|d| d.get("uri"))
                    .and_then(Value::as_str);
                let (Some(uri), Some(edits)) = (uri, change.get("edits")) else { continue };
                if let Some(path) = uri_to_path(uri) {
                    out.push(LspFileEdit { path: path.to_string_lossy().to_string(), edits: edits.clone() });
                }
            }
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn lsp_format(
    app: tauri::AppHandle,
    server_id: String,
    root: String,
    path: String,
    tab_size: u32,
    insert_spaces: bool,
) -> Result<Value, String> {
    blocking(move || {
        require(&app, &server_id, &root)?.request("textDocument/formatting", json!({
            "textDocument": { "uri": path_to_uri(Path::new(&path)) },
            "options": {
                "tabSize": tab_size,
                "insertSpaces": insert_spaces,
                "trimTrailingWhitespace": true,
                "insertFinalNewline": true,
            },
        }))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(l1: u32, c1: u32, l2: u32, c2: u32) -> Value {
        json!({ "start": { "line": l1, "character": c1 }, "end": { "line": l2, "character": c2 } })
    }

    #[test]
    fn flattens_a_single_location() {
        let value = json!({ "uri": "file:///a/b.rs", "range": range(2, 4, 2, 9) });
        let locations = to_locations(&value);
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].path, "/a/b.rs");
        assert_eq!((locations[0].line, locations[0].character), (2, 4));
        assert_eq!((locations[0].end_line, locations[0].end_character), (2, 9));
    }

    #[test]
    fn flattens_a_location_array() {
        let value = json!([
            { "uri": "file:///a/b.rs", "range": range(0, 0, 0, 1) },
            { "uri": "file:///a/c.rs", "range": range(5, 1, 5, 2) },
        ]);
        assert_eq!(to_locations(&value).len(), 2);
    }

    #[test]
    fn prefers_the_selection_range_of_a_location_link() {
        let value = json!([{
            "targetUri": "file:///a/b.rs",
            "targetRange": range(0, 0, 9, 0),
            "targetSelectionRange": range(3, 7, 3, 11),
        }]);
        let locations = to_locations(&value);
        assert_eq!((locations[0].line, locations[0].character), (3, 7));
    }

    #[test]
    fn drops_entries_it_cannot_read() {
        let value = json!([
            { "uri": "file:///a/b.rs" },
            { "range": range(0, 0, 0, 1) },
            { "uri": "untitled:x", "range": range(0, 0, 0, 1) },
            { "uri": "file:///a/ok.rs", "range": range(1, 0, 1, 1) },
        ]);
        let locations = to_locations(&value);
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].path, "/a/ok.rs");
    }

    #[test]
    fn treats_a_null_answer_as_no_result() {
        assert!(to_locations(&Value::Null).is_empty());
    }

    #[test]
    fn strips_the_colours_a_manager_paints_with() {
        assert_eq!(strip_ansi("\u{1b}[32madded 1 package\u{1b}[0m"), "added 1 package");
        assert_eq!(strip_ansi("\u{1b}[1;31mERR!\u{1b}[0m network"), "ERR! network");
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn strips_the_title_a_manager_sets_on_the_terminal() {
        assert_eq!(strip_ansi("\u{1b}]0;npm install\u{7}added 1 package"), "added 1 package");
        assert_eq!(strip_ansi("\u{1b}]2;title\u{1b}\\done"), "done");
    }

    #[test]
    fn reads_the_source_line_of_every_hit() {
        let file = std::env::temp_dir().join(format!("cairn-lsp-lines-{}.rs", std::process::id()));
        std::fs::write(&file, "fn main() {\n    let value = compute();\n}\n").unwrap();
        let path = file.to_string_lossy().to_string();

        let located = with_source_lines(vec![
            LspLocation { path: path.clone(), line: 1, character: 8, end_line: 1, end_character: 13, text: None },
            LspLocation { path: path.clone(), line: 0, character: 3, end_line: 0, end_character: 7, text: None },
            LspLocation { path: "/nowhere/gone.rs".into(), line: 0, character: 0, end_line: 0, end_character: 1, text: None },
        ]);

        assert_eq!(located[0].text.as_deref(), Some("let value = compute();"));
        assert_eq!(located[1].text.as_deref(), Some("fn main() {"));
        assert_eq!(located[2].text, None, "a file that cannot be read is not an error");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn leaves_a_line_past_the_end_of_the_file_without_text() {
        let file = std::env::temp_dir().join(format!("cairn-lsp-short-{}.rs", std::process::id()));
        std::fs::write(&file, "one\n").unwrap();
        let located = with_source_lines(vec![LspLocation {
            path: file.to_string_lossy().to_string(),
            line: 99, character: 0, end_line: 99, end_character: 1, text: None,
        }]);
        assert_eq!(located[0].text, None);
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn cuts_a_source_line_that_holds_a_whole_minified_file() {
        let file = std::env::temp_dir().join(format!("cairn-lsp-long-{}.js", std::process::id()));
        std::fs::write(&file, "x".repeat(SOURCE_LINE_MAX * 3)).unwrap();
        let located = with_source_lines(vec![LspLocation {
            path: file.to_string_lossy().to_string(),
            line: 0, character: 0, end_line: 0, end_character: 1, text: None,
        }]);
        assert_eq!(located[0].text.as_deref().map(str::len), Some(SOURCE_LINE_MAX));
        let _ = std::fs::remove_file(&file);
    }

    fn verdict(manager: &str, installed: Option<&str>, answer: Option<(bool, &str)>) -> UpdateCheck {
        decide(
            "test".into(),
            Some(manager.to_string()),
            installed,
            answer.map(|(ok, out)| (ok, out.to_string())),
        )
    }

    #[test]
    fn reads_the_version_a_registry_printed() {
        let check = verdict("npm", Some("pyright 1.1.403"), Some((true, "1.1.444\n")));
        assert_eq!(check.latest.as_deref(), Some("1.1.444"));
        assert_eq!(check.outdated, Some(true));
    }

    #[test]
    fn calls_the_same_version_up_to_date() {
        let check = verdict("npm", Some("4.3.3"), Some((true, "4.3.3\n")));
        assert_eq!(check.outdated, Some(false));
    }

    #[test]
    fn pulls_the_version_out_of_what_a_registry_pads_it_with() {
        // `gem list -r -e` and `cargo search` both answer with the package name.
        assert_eq!(verdict("gem", Some("0.50.0"), Some((true, "solargraph (0.53.4)"))).latest.as_deref(), Some("0.53.4"));
        assert_eq!(
            verdict("cargo", Some("0.9.0"), Some((true, "taplo-cli = \"0.9.3\"    # A TOML toolkit"))).latest.as_deref(),
            Some("0.9.3"),
        );
    }

    #[test]
    fn homebrew_naming_the_formula_means_it_is_outdated() {
        assert_eq!(verdict("brew", Some("1.78.0"), Some((false, "rust-analyzer\n"))).outdated, Some(true));
        assert_eq!(verdict("brew", Some("1.78.0"), Some((true, ""))).outdated, Some(false));
    }

    #[test]
    fn a_server_nothing_can_be_asked_about_is_still_answered_for() {
        // rust-analyzer handed out by rustup: no registry publishes a version to
        // compare it against. The check must say so rather than stay silent, or
        // the page cannot tell it apart from a server nobody has checked.
        let check = decide("rust".into(), None, Some("1.78.0"), None);
        assert_eq!(check.outdated, None);
        assert_eq!(check.manager, None);
        assert_eq!(check.latest, None);
    }

    #[test]
    fn an_unknown_state_is_never_reported_as_up_to_date() {
        // A manager that failed with nothing on stdout - an unknown formula,
        // a network that did not answer - knows nothing about this server.
        assert_eq!(verdict("brew", Some("1.0"), Some((false, ""))).outdated, None);
        assert_eq!(verdict("npm", Some("1.0"), None).outdated, None);
        assert_eq!(verdict("npm", Some("1.0"), Some((false, "1.2.0"))).outdated, None);
        assert_eq!(verdict("npm", Some("1.0"), Some((true, "not a version"))).outdated, None);
        // The registry answered, but the binary never said which version it is.
        let unreadable = verdict("npm", None, Some((true, "1.2.0")));
        assert_eq!(unreadable.outdated, None);
        assert_eq!(unreadable.latest.as_deref(), Some("1.2.0"), "the answer is still worth showing");
    }

    fn pump(input: &str) -> Vec<String> {
        let mut lines = Vec::new();
        pump_lines(input.as_bytes(), |line| lines.push(line));
        lines
    }

    #[test]
    fn reads_one_line_per_newline() {
        assert_eq!(pump("first\nsecond\n"), ["first", "second"]);
    }

    #[test]
    fn treats_a_rewritten_status_line_as_progress() {
        assert_eq!(pump("30%\r60%\r100%\r"), ["30%", "60%", "100%"]);
    }

    #[test]
    fn reports_a_last_line_that_was_never_terminated() {
        assert_eq!(pump("downloading"), ["downloading"]);
    }

    #[test]
    fn drops_the_blank_lines_a_carriage_return_leaves_behind() {
        assert_eq!(pump("a\r\n\r\nb\n"), ["a", "b"]);
    }
}
