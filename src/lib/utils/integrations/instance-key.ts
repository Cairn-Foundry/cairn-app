// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The key one instance's integration state is stored under, `projectId:instanceId`. */
export function integrationKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}
