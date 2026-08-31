// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use serde::Serialize;
use tauri::Emitter;

/// Batches events onto one emit per frame, the way the terminal output already
/// is: a streaming agent or a server publishing diagnostics file by file
/// otherwise costs one IPC crossing and one reactive update per item.
pub struct Coalescer<T> {
    event:     &'static str,
    queue:     Mutex<Vec<T>>,
    scheduled: AtomicBool,
}

const FRAME: Duration = Duration::from_millis(16);

impl<T: Serialize + Clone + Send + 'static> Coalescer<T> {
    pub const fn new(event: &'static str) -> Self {
        Self { event, queue: Mutex::new(Vec::new()), scheduled: AtomicBool::new(false) }
    }

    pub fn push(&'static self, app: &tauri::AppHandle, item: T) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.push(item);
        }
        if self.scheduled.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(FRAME);
            self.scheduled.store(false, Ordering::SeqCst);
            let batch: Vec<T> = self.queue.lock().map(|mut q| std::mem::take(&mut *q)).unwrap_or_default();
            if !batch.is_empty() {
                let _ = app.emit(self.event, batch);
            }
        });
    }
}
