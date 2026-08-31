// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { readDirTree } from "$lib/services/file-service";
import { getSnapshot } from "$lib/services/git-service";
import { listInstances } from "$lib/services/instance-service";
import { projects } from "$lib/stores/project";

const HOVER_DELAY_MS = 80;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Warms what a project switch reads first - its tree and its git snapshot -
 * while the pointer still sits on the tab. The reads share their in-flight
 * promise with the real call through dedupeInflight, so a click that comes
 * before they land waits on work already started instead of starting its own.
 */
export function schedulePrefetch(projectId: string): void {
	cancelPrefetch();
	timer = setTimeout(() => {
		timer = null;
		void prefetchProject(projectId);
	}, HOVER_DELAY_MS);
}

export function cancelPrefetch(): void {
	if (timer) clearTimeout(timer);
	timer = null;
}

/**
 * Same idea for an instance row of the switcher: its worktree is known, so the
 * tree and the snapshot are read straight away while the pointer is still on
 * the row.
 */
export function scheduleWorktreePrefetch(worktreePath: string): void {
	cancelPrefetch();
	timer = setTimeout(() => {
		timer = null;
		void readDirTree(worktreePath).catch(() => {});
		void getSnapshot(worktreePath, 0).catch(() => {});
	}, HOVER_DELAY_MS);
}

async function prefetchProject(projectId: string): Promise<void> {
	const project = get(projects).find((p) => p.id === projectId);
	if (!project) return;
	const instances = await listInstances(projectId).catch(() => []);
	const instance =
		instances.find((i) => i.id === project.activeInstanceId) ?? instances[0];
	if (!instance) return;
	void readDirTree(instance.worktreePath).catch(() => {});
	void getSnapshot(instance.worktreePath, 0).catch(() => {});
}
