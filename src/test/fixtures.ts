import type { ConversationMeta } from "$lib/services/conversation-service";
import type { Instance, InstanceStatus } from "$lib/types/instance";
import type { Project } from "$lib/types/project";

/**
 * A project whose id doubles as its name and path, so a test reads as
 * "project a" rather than carrying a fixture object around.
 */
export function project(id: string, overrides: Partial<Project> = {}): Project {
	return {
		id,
		name: id,
		path: `/repos/${id}`,
		color: "#fff",
		activeInstanceId: null,
		...overrides,
	};
}

/** An idle instance on its own worktree, branched off main. */
export function instance(
	id: string,
	projectId: string,
	overrides: Partial<Instance> = {},
): Instance {
	return {
		id,
		projectId,
		ticket: { id, title: id },
		branch: id,
		worktreePath: `/worktrees/${projectId}/${id}`,
		status: "idle" as InstanceStatus,
		createdAt: 0,
		baseBranch: "main",
		...overrides,
	};
}

/** A plain, unpinned, unarchived conversation whose id doubles as its title. */
export function conversation(
	id: string,
	overrides: Partial<ConversationMeta> = {},
): ConversationMeta {
	return {
		id,
		title: id,
		createdAt: 0,
		updatedAt: 0,
		lastMessageAt: 0,
		providerId: "claude",
		pinned: false,
		archived: false,
		sessions: {},
		lastProviderId: "claude",
		messageCount: 2,
		preview: "",
		...overrides,
	};
}
