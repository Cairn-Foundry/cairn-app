// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Lifecycle of an instance, mirrored by the status dot in the instance list. */
export type InstanceStatus = "idle" | "running" | "paused" | "done";

/** The workspace tabs, in sidebar order. */
export type WorkflowStep =
	| "files"
	| "agent"
	| "review"
	| "tests"
	| "git"
	| "cicd";

/** The ticket fields kept on the instance itself, denormalized from the full Ticket. */
export interface InstanceTicket {
	id: string;
	title: string;
	/** Tracker key ("CAIRN-42", "#123") when the ticket came from an integration. */
	key?: string;
	url?: string;
	/** The integration kind, informative only. */
	source?: string;
	connectionId?: string;
}

/** A unit of work backed by its own git worktree; `parentInstanceId` is set when it was branched off another instance. */
export interface Instance {
	id: string;
	projectId: string;
	ticket: InstanceTicket;
	branch: string;
	worktreePath: string;
	status: InstanceStatus;
	createdAt: number;
	baseBranch: string;
	parentInstanceId?: string;
}
