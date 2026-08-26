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
