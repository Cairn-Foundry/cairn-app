// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export function openUrl(url: string): Promise<void> {
	return invoke<void>("open_external", { target: url });
}

export function openPath(path: string): Promise<void> {
	return invoke<void>("open_external", { target: path });
}
