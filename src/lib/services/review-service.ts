// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The review step's backend calls: the diff the guide is built from, the hunks
// the "seen" state is keyed on, and the state on disk. Only this layer calls
// invoke().

import { invoke } from "@tauri-apps/api/core";
import type { ReviewHunk, ReviewState } from "$lib/types/review";

/** The unified diff handed to the model, and whether it had to be cut. */
export interface UnifiedDiff {
	text: string;
	truncated: boolean;
	/** The files the ceiling left out, so the prompt can name them. */
	omitted: string[];
}

/** `base...head` as one unified diff, generated files excluded. */
export async function getDiffUnified(
	worktreePath: string,
	base: string,
	head: string,
	ignoreWhitespace = false,
	maxBytes?: number,
): Promise<UnifiedDiff> {
	return invoke("get_diff_unified", {
		worktreePath,
		base,
		head,
		ignoreWhitespace,
		maxBytes: maxBytes ?? null,
	});
}

/** Every hunk of `base...head` with its content hash. */
export async function getDiffHunks(
	worktreePath: string,
	base: string,
	head: string,
): Promise<ReviewHunk[]> {
	return invoke("get_diff_hunks", { worktreePath, base, head });
}

/** Null when this instance has never been reviewed. */
export async function loadReviewState(
	projectId: string,
	instanceId: string,
): Promise<ReviewState | null> {
	try {
		return await invoke<ReviewState | null>("load_review_state", {
			projectId,
			instanceId,
		});
	} catch {
		return null;
	}
}

/** Fire and forget: losing a "seen" mark must never block the reading. */
export function saveReviewState(
	projectId: string,
	instanceId: string,
	state: ReviewState,
): void {
	invoke("save_review_state", { projectId, instanceId, state }).catch(() => {});
}
