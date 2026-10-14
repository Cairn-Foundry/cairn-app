// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Detached editor windows: a tab taken out of the editor lives in a window of
//! its own (`editor-<n>`), which can hold tabs of several projects.
//!
//! This side keeps no editor state. It creates the windows, relays the tabs
//! moving between them (the tab travels whole, unsaved buffer included, as an
//! opaque JSON value), and remembers which window holds which file and whether
//! it is dirty, so a file is never open twice and closing the app can ask once
//! about every unsaved buffer.
//!
//! Dropping a tab on another window: the source window keeps receiving the
//! pointer outside its bounds while the button is held, and
//! `editor_window_at_cursor` finds the window under it. Wayland exposes neither
//! the global cursor position nor window positions, so there the drag is handed
//! to GTK (`editor_drag_start`) and the target window receives it as an ordinary
//! `onDragDropEvent`. The dragged item is a `cairn-tab:<token>` URI, never the
//! real file: a file manager refuses it instead of copying the file, and wry
//! hands it to our windows untouched. GTK's own "dropped" flag cannot be trusted
//! (a desktop accepts any URI), so a move only happens when a Cairn window
//! claims the token.
//!
//! Nothing here may panic: a panic on the main thread aborts the app with its
//! unsaved buffers.

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

pub const MAIN_WINDOW: &str = "main";
const EDITOR_PREFIX: &str = "editor-";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    pub path: String,
    pub is_dirty: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowFile {
    pub label: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TabsReceived {
    tabs: Vec<Value>,
    from: String,
}

struct DragSession {
    source: String,
    tab: Value,
    is_claimed: bool,
}

#[derive(Default)]
pub struct EditorWindows {
    next_id: Mutex<u64>,
    pending: Mutex<HashMap<String, Vec<Value>>>,
    files: Mutex<HashMap<String, Vec<OpenFile>>>,
    drags: Mutex<HashMap<String, DragSession>>,
}

impl EditorWindows {
    fn owner_of(&self, path: &str) -> Option<String> {
        let files = self.files.lock().ok()?;
        owner_in(&files, path)
    }

    /// Forgets everything about a window that closed.
    pub fn release(&self, label: &str) {
        if let Ok(mut files) = self.files.lock() {
            files.remove(label);
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(label);
        }
        if let Ok(mut drags) = self.drags.lock() {
            drags.retain(|_, d| d.source != label);
        }
    }
}

fn owner_in(files: &HashMap<String, Vec<OpenFile>>, path: &str) -> Option<String> {
    let mut owners: Vec<&String> = files
        .iter()
        .filter(|(_, list)| list.iter().any(|f| f.path == path))
        .map(|(label, _)| label)
        .collect();
    owners.sort();
    owners.first().map(|l| l.to_string())
}

fn dirty_in(files: &HashMap<String, Vec<OpenFile>>, except: &str) -> Vec<WindowFile> {
    let mut dirty: Vec<WindowFile> = files
        .iter()
        .filter(|(label, _)| label.as_str() != except)
        .flat_map(|(label, list)| {
            list.iter()
                .filter(|f| f.is_dirty)
                .map(|f| WindowFile { label: label.clone(), path: f.path.clone() })
        })
        .collect();
    dirty.sort_by(|a, b| (&a.label, &a.path).cmp(&(&b.label, &b.path)));
    dirty
}

pub fn is_editor_window(label: &str) -> bool {
    label.starts_with(EDITOR_PREFIX)
}

/// Opens a detached editor window holding `tabs`. `x`/`y` are logical screen
/// coordinates for its top-left corner, ignored where the compositor places
/// windows itself (Wayland).
#[tauri::command]
pub async fn editor_window_open(
    app: AppHandle,
    tabs: Vec<Value>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let state = app.state::<EditorWindows>();
    let label = {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        *next += 1;
        format!("{EDITOR_PREFIX}{}", *next)
    };
    state.pending.lock().map_err(|e| e.to_string())?.insert(label.clone(), tabs);
    let url = tauri::WebviewUrl::App(format!("editor?id={label}").into());
    let mut builder = crate::window_builder(&app, &label, url).inner_size(1000.0, 720.0);
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }
    if let Err(e) = builder.build().and_then(|w| w.show()) {
        state.pending.lock().map_err(|e| e.to_string())?.remove(&label);
        return Err(e.to_string());
    }
    Ok(label)
}

/// The tabs a new window was opened with, handed over once.
#[tauri::command]
pub fn editor_window_take_tabs(app: AppHandle, window: tauri::WebviewWindow) -> Vec<Value> {
    app.state::<EditorWindows>()
        .pending
        .lock()
        .ok()
        .and_then(|mut p| p.remove(window.label()))
        .unwrap_or_default()
}

/// Hands tabs over to another window, which adopts them on `editor-tabs-received`.
#[tauri::command]
pub fn editor_window_transfer(
    app: AppHandle,
    window: tauri::WebviewWindow,
    target: String,
    tabs: Vec<Value>,
) -> Result<(), String> {
    let Some(target_window) = app.get_webview_window(&target) else {
        return Err(format!("no window {target}"));
    };
    app.emit_to(target.as_str(), "editor-tabs-received", TabsReceived { tabs, from: window.label().to_string() })
        .map_err(|e| e.to_string())?;
    let _ = target_window.set_focus();
    Ok(())
}

/// What a window holds, re-sent by the window whenever a tab opens, closes or
/// changes its dirty state.
#[tauri::command]
pub fn editor_window_sync(app: AppHandle, window: tauri::WebviewWindow, files: Vec<OpenFile>) {
    if let Ok(mut map) = app.state::<EditorWindows>().files.lock() {
        map.insert(window.label().to_string(), files);
    }
}

/// The window holding a file other than the caller, focused so the user lands
/// on it, or `None` when the caller may open the file itself.
#[tauri::command]
pub fn editor_window_focus_owner(app: AppHandle, window: tauri::WebviewWindow, path: String) -> Option<String> {
    let owner = app.state::<EditorWindows>().owner_of(&path)?;
    if owner == window.label() {
        return None;
    }
    let target = app.get_webview_window(&owner)?;
    let _ = target.unminimize();
    let _ = target.set_focus();
    let _ = app.emit_to(owner.as_str(), "editor-reveal-file", path);
    Some(owner)
}

/// Unsaved buffers of every window but the caller.
#[tauri::command]
pub fn editor_windows_dirty(app: AppHandle, window: tauri::WebviewWindow) -> Vec<WindowFile> {
    app.state::<EditorWindows>()
        .files
        .lock()
        .map(|f| dirty_in(&f, window.label()))
        .unwrap_or_default()
}

/// Asks every detached window to save its dirty tabs; each answers by syncing
/// its files again, which `editor_windows_dirty` then reflects.
#[tauri::command]
pub fn editor_windows_save_all(app: AppHandle) {
    for (label, _) in app.webview_windows().into_iter().filter(|(l, _)| is_editor_window(l)) {
        let _ = app.emit_to(label.as_str(), "editor-save-all", ());
    }
}

/// Closes every detached window without asking them: the main window already did.
#[tauri::command]
pub fn editor_windows_close_all(app: AppHandle) {
    for (label, w) in app.webview_windows() {
        if is_editor_window(&label) {
            let _ = w.destroy();
        }
    }
}

/// Registers the tab a native drag carries, so the window it lands on can claim it.
#[tauri::command]
pub fn editor_drag_begin(app: AppHandle, window: tauri::WebviewWindow, token: String, tab: Value) -> Result<(), String> {
    app.state::<EditorWindows>().drags.lock().map_err(|e| e.to_string())?.insert(
        token,
        DragSession { source: window.label().to_string(), tab, is_claimed: false },
    );
    Ok(())
}

/// Called by the window a `cairn-tab:` URI was dropped on; returns the tab once.
#[tauri::command]
pub fn editor_drag_claim(app: AppHandle, window: tauri::WebviewWindow, token: String) -> Option<Value> {
    let state = app.state::<EditorWindows>();
    let mut drags = state.drags.lock().ok()?;
    let session = drags.get_mut(&token)?;
    if session.is_claimed || session.source == window.label() {
        return None;
    }
    session.is_claimed = true;
    Some(session.tab.clone())
}

/// Ends a native drag for its source: true when another window took the tab.
#[tauri::command]
pub fn editor_drag_finish(app: AppHandle, token: String) -> bool {
    app.state::<EditorWindows>()
        .drags
        .lock()
        .ok()
        .and_then(|mut d| d.remove(&token))
        .is_some_and(|d| d.is_claimed)
}


#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowAtCursor {
    pub supported: bool,
    pub cursor: Option<(f64, f64)>,
    pub label: Option<String>,
}

#[derive(Clone, Debug)]
struct WindowRect {
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    is_focused: bool,
}

/// Overlapping windows have no z-order in the API: the focused one wins, which
/// is the one on top in practice, otherwise the first hit.
fn pick_window(rects: &[WindowRect], x: f64, y: f64) -> Option<String> {
    let hits: Vec<&WindowRect> = rects
        .iter()
        .filter(|r| x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)
        .collect();
    hits.iter()
        .find(|r| r.is_focused)
        .or_else(|| hits.first())
        .map(|r| r.label.clone())
}

fn is_wayland() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[tauri::command]
pub fn editor_window_at_cursor(app: AppHandle) -> WindowAtCursor {
    let unsupported = WindowAtCursor { supported: false, cursor: None, label: None };
    if is_wayland() {
        return unsupported;
    }
    let Ok(cursor) = app.cursor_position() else {
        return unsupported;
    };
    let rects: Vec<WindowRect> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, w)| {
            let pos = w.outer_position().ok()?;
            let size = w.outer_size().ok()?;
            Some(WindowRect {
                label,
                x: pos.x as f64,
                y: pos.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                is_focused: w.is_focused().unwrap_or(false),
            })
        })
        .collect();
    WindowAtCursor {
        supported: true,
        cursor: Some((cursor.x, cursor.y)),
        label: pick_window(&rects, cursor.x, cursor.y),
    }
}

/// Outcome of a native drag, sent to the source window as `editor-drag-end`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EditorDragEnd {
    pub is_dropped: bool,
    /// Escape, as opposed to a drop nowhere: the tab stays where it was.
    pub is_cancelled: bool,
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn editor_drag_start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let source = window.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(gtk_drag::start(&source, &token));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn editor_drag_start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<(), String> {
    let _ = (app, window, token);
    Err("native drag is only used on Linux".into())
}

#[cfg(target_os = "linux")]
mod gtk_drag {
    use super::EditorDragEnd;
    use gtk::gdk;
    use gtk::glib;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    use tauri::{Emitter, Manager};

    pub fn start(window: &tauri::WebviewWindow, token: &str) -> Result<(), String> {
        let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
        let targets = gtk::TargetList::new(&[]);
        targets.add_uri_targets(0);

        let handlers: Rc<RefCell<Vec<glib::SignalHandlerId>>> = Rc::default();
        let uri = format!("cairn-tab:{token}");
        handlers.borrow_mut().push(gtk_window.connect_drag_data_get(move |_, _, data, _, _| {
            data.set_uris(&[uri.as_str()]);
        }));

        let failure: Rc<RefCell<Option<gtk::DragResult>>> = Rc::default();
        let failure_slot = failure.clone();
        handlers.borrow_mut().push(gtk_window.connect_drag_failed(move |_, _, result| {
            *failure_slot.borrow_mut() = Some(result);
            glib::Propagation::Stop
        }));

        let label = window.label().to_string();
        let app = window.app_handle().clone();
        let end_handlers = handlers.clone();
        handlers.borrow_mut().push(gtk_window.connect_drag_end(move |w, _| {
            let failed = *failure.borrow();
            let payload = EditorDragEnd {
                is_dropped: failed.is_none(),
                is_cancelled: failed == Some(gtk::DragResult::UserCancelled),
            };
            let _ = app.emit_to(label.as_str(), "editor-drag-end", payload);
            for id in end_handlers.borrow_mut().drain(..) {
                w.disconnect(id);
            }
        }));

        gtk_window
            .drag_begin_with_coordinates(&targets, gdk::DragAction::COPY, 1, None, -1, -1)
            .map(|_| ())
            .ok_or_else(|| "gtk refused to start the drag".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, is_dirty: bool) -> OpenFile {
        OpenFile { path: path.into(), is_dirty }
    }

    #[test]
    fn a_file_is_owned_by_the_window_holding_it() {
        let files = HashMap::from([
            ("main".to_string(), vec![file("/w/a.ts", false)]),
            ("editor-1".to_string(), vec![file("/w/b.ts", true)]),
        ]);
        assert_eq!(owner_in(&files, "/w/b.ts"), Some("editor-1".into()));
        assert_eq!(owner_in(&files, "/w/c.ts"), None);
    }

    #[test]
    fn dirty_files_leave_out_the_asking_window() {
        let files = HashMap::from([
            ("main".to_string(), vec![file("/w/a.ts", true)]),
            ("editor-1".to_string(), vec![file("/w/b.ts", true), file("/w/c.ts", false)]),
        ]);
        assert_eq!(dirty_in(&files, "main"), vec![WindowFile { label: "editor-1".into(), path: "/w/b.ts".into() }]);
    }

    #[test]
    fn only_editor_labels_are_detached_windows() {
        assert!(is_editor_window("editor-3"));
        assert!(!is_editor_window("main"));
    }

    fn rect(label: &str, x: f64, y: f64, is_focused: bool) -> WindowRect {
        WindowRect { label: label.into(), x, y, width: 100.0, height: 100.0, is_focused }
    }

    #[test]
    fn misses_when_no_window_contains_the_cursor() {
        assert_eq!(pick_window(&[rect("main", 0.0, 0.0, false)], 150.0, 50.0), None);
    }

    #[test]
    fn right_and_bottom_edges_are_exclusive() {
        assert_eq!(pick_window(&[rect("main", 0.0, 0.0, false)], 100.0, 50.0), None);
        assert_eq!(pick_window(&[rect("main", 0.0, 0.0, false)], 99.0, 99.0), Some("main".into()));
    }

    #[test]
    fn focused_window_wins_an_overlap() {
        let rects = [rect("a", 0.0, 0.0, false), rect("b", 50.0, 50.0, true)];
        assert_eq!(pick_window(&rects, 75.0, 75.0), Some("b".into()));
    }

    #[test]
    fn first_hit_wins_without_focus() {
        let rects = [rect("a", 0.0, 0.0, false), rect("b", 50.0, 50.0, false)];
        assert_eq!(pick_window(&rects, 75.0, 75.0), Some("a".into()));
    }

    #[test]
    fn handles_negative_coordinates_of_a_left_monitor() {
        assert_eq!(pick_window(&[rect("left", -200.0, 0.0, false)], -150.0, 10.0), Some("left".into()));
    }
}
