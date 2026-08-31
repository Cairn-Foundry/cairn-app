// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Thin binary entry point: everything lives in the `cairn_lib` crate so the
/// mobile entry point can share it.
fn main() {
    cairn_lib::run()
}
