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
 * Identifies the hover the pending prefetch belongs to. The timer alone is not
 * enough: once it has fired, the reads it starts are async and leaving the tab
 * cannot call them back, so sweeping across three project tabs warmed all three
 * worktrees - three trees and three full snapshots for two projects the pointer
 * only passed over. Every read checks the token first, so only the last hover
 * reaches the backend.
 */
let token = 0;

function schedule(run: (mine: number) => void): void {
	cancelPrefetch();
	const mine = ++token;
	timer = setTimeout(() => {
		timer = null;
		if (mine === token) run(mine);
	}, HOVER_DELAY_MS);
}

/**
 * Warms what a project switch reads first - its tree and its git snapshot -
 * while the pointer still sits on the tab. The reads share their in-flight
 * promise with the real call through dedupeInflight, so a click that comes
 * before they land waits on work already started instead of starting its own.
 */
export function schedulePrefetch(projectId: string): void {
	schedule((mine) => void prefetchProject(projectId, mine));
}

export function cancelPrefetch(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	token++;
}

/**
 * Same idea for an instance row of the switcher: its worktree is known, so the
 * tree and the snapshot are read straight away while the pointer is still on
 * the row.
 */
export function scheduleWorktreePrefetch(worktreePath: string): void {
	schedule(() => warm(worktreePath));
}

function warm(worktreePath: string): void {
	void readDirTree(worktreePath).catch(() => {});
	void getSnapshot(worktreePath, "").catch(() => {});
}

async function prefetchProject(projectId: string, mine: number): Promise<void> {
	const project = get(projects).find((p) => p.id === projectId);
	if (!project) return;
	const instances = await listInstances(projectId).catch(() => []);
	const instance =
		instances.find((i) => i.id === project.activeInstanceId) ?? instances[0];
	if (!instance || mine !== token) return;
	warm(instance.worktreePath);
}
