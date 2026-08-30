// Agent conversations on disk: one metadata index per scope. A null `instanceId`
// addresses the project scope rather than an instance.
//
// There is no transcript here. A conversation *is* the CLI running in a PTY, and
// whatever it said lives in that CLI's own store; Cairn only remembers which CLI,
// where, and how to resume it.

import { invoke } from "@tauri-apps/api/core";
import type { CliProviderId } from "$lib/services/cli-provider-service";

/** Which of the two conversation lists a conversation belongs to. */
export type ConversationScope = "instance" | "project";

/**
 * A conversation as the index knows it. `sessionId` is only set for a CLI that
 * accepts an id imposed at launch; for the others resume means "the last session
 * in this cwd", which the worktree per instance makes unambiguous.
 */
export interface ConversationMeta {
	id: string;
	title: string;
	/** Id from the CLI registry. A conversation belongs to one CLI for its whole life. */
	cli: CliProviderId;
	sessionId: string | null;
	/** Directory the CLI runs in, so a resume lands in the same worktree. */
	cwd: string;
	createdAt: number;
	/** Orders the list under the pinned ones. */
	lastOpenedAt: number;
	pinned: boolean;
	archived: boolean;
}

/** Contents of one scope's `index.json`. */
export interface ConversationIndex {
	conversations: ConversationMeta[];
	activeId: string | null;
}

/** Null when the scope has no conversations yet, which is not an error. */
export async function getConversationIndex(
	projectId: string,
	instanceId: string | null,
): Promise<ConversationIndex | null> {
	return await invoke("get_conversation_index", { projectId, instanceId });
}

/** Rewrites the whole index of the scope. */
export async function saveConversationIndex(
	projectId: string,
	instanceId: string | null,
	index: ConversationIndex,
): Promise<void> {
	await invoke("save_conversation_index", { projectId, instanceId, index });
}
