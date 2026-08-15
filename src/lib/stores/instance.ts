/** Instances of every loaded project, plus the base pseudo-instance standing for the repository itself. */
import { derived, get, writable } from "svelte/store";
import { t } from "$lib/i18n";
import type { CreateInstanceArgs } from "$lib/services/instance-service";
import {
	createInstance,
	deleteInstance,
	duplicateInstance as duplicateInstanceService,
	listInstances,
	updateInstanceStatus,
} from "$lib/services/instance-service";
import type { Instance, InstanceStatus } from "$lib/types/instance";
import type { Project } from "$lib/types/project";
import { clearProjectAgentActivity } from "./agent-activity";
import { activateInstance, activeProject } from "./project";
import { removeInstanceTerminals } from "./terminal";

/**
 * Instances are held per project rather than for the active project alone: a
 * missing key means "not loaded yet", which is what lets `activeInstance` stay
 * silent instead of falling back to the base instance while a switch is in
 * flight - a fallback every view would follow with a full reload.
 */
const instancesByProject = writable<Record<string, Instance[]>>({});

/** Applies a change to one project's instance list, leaving the other projects alone. */
function patchProject(
	projectId: string,
	patch: (list: Instance[]) => Instance[],
): void {
	instancesByProject.update((byProject) => ({
		...byProject,
		[projectId]: patch(byProject[projectId] ?? []),
	}));
}

/** Id of the pseudo-instance standing for the repository itself, outside any worktree. */
export const BASE_INSTANCE_ID = "__base__";

/** Whether an id refers to the repository itself rather than a real worktree. */
export function isBaseInstance(id: string | null | undefined): boolean {
	return id === BASE_INSTANCE_ID;
}

/**
 * A finalized instance is archived: it leaves the instance selector and only
 * shows up in the manager, from where it can be reopened.
 */
export function isArchivedInstance(instance: Instance): boolean {
	return instance.status === "done";
}

/**
 * Kept per project rather than rebuilt on demand: a fresh object on every read
 * would make `activeInstance` look changed each time anything else moved, and
 * every view watching it would reload for nothing.
 */
const baseInstances = new Map<string, Instance>();

/** The project's base pseudo-instance, rebuilt only when the project path changed. */
export function baseInstance(project: Project): Instance {
	const known = baseInstances.get(project.id);
	if (known && known.worktreePath === project.path) return known;
	const built: Instance = {
		id: BASE_INSTANCE_ID,
		projectId: project.id,
		ticket: {
			id: "base",
			title: t("workspace.baseFolder.title") as string,
		},
		branch: "",
		worktreePath: project.path,
		status: "idle",
		createdAt: 0,
		baseBranch: "",
	};
	baseInstances.set(project.id, built);
	return built;
}

/** Real instances of the active project, base instance excluded. */
export const instances = derived(
	[instancesByProject, activeProject],
	([$byProject, $activeProject]) =>
		$activeProject ? ($byProject[$activeProject.id] ?? []) : [],
);

/** Resolves the active instance, falling back to the base one; null while the project is not loaded. */
function resolveActive(
	byProject: Record<string, Instance[]>,
	project: Project | null,
): Instance | null {
	if (!project) return null;
	const loaded = byProject[project.id];
	if (!loaded) return null;
	const id = project.activeInstanceId;
	if (!id || id === BASE_INSTANCE_ID) return baseInstance(project);
	return loaded.find((i) => i.id === id) ?? baseInstance(project);
}

let lastActive: Instance | null = null;

/**
 * A derived store republishes an object even when it is the very same one, so
 * the resolved instance is compared before being handed out: the views below
 * treat every emission as a worktree change.
 */
export const activeInstance = derived<
	[typeof instancesByProject, typeof activeProject],
	Instance | null
>(
	[instancesByProject, activeProject],
	([$byProject, $activeProject], set) => {
		const next = resolveActive($byProject, $activeProject);
		if (next === lastActive) return;
		lastActive = next;
		set(next);
	},
	null,
);

/** What the instance selector lists: the base instance first, then the real ones. */
export const instancesWithBase = derived(
	[instances, activeProject],
	([$instances, $activeProject]) =>
		$activeProject ? [baseInstance($activeProject), ...$instances] : $instances,
);

/** Reads a project's instances; until this resolves the project has no key, and activeInstance stays null. */
export async function loadInstances(projectId: string): Promise<void> {
	const data = await listInstances(projectId);
	instancesByProject.update((byProject) => ({
		...byProject,
		[projectId]: data,
	}));
}

/** Creates an instance with its worktree and switches to it. */
export async function spawnInstance(
	args: CreateInstanceArgs,
): Promise<Instance> {
	const instance = await createInstance(args);
	patchProject(args.projectId, (list) => [...list, instance]);
	await activateInstance(args.projectId, instance.id);
	return instance;
}

/** Branches a new instance off an existing one, numbering its ticket after the siblings already made from it. */
export async function duplicateInstance(
	source: {
		id: string;
		projectId: string;
		ticket: { id: string; title: string };
	},
	opts: { title: string; copyWorkingChanges: boolean },
): Promise<Instance> {
	const newId = crypto.randomUUID();
	const seq =
		get(instances).filter((i) => i.parentInstanceId === source.id).length + 1;
	const ticket = {
		id: `${source.ticket.id}-${seq}`,
		title: opts.title,
	};
	const instance = await duplicateInstanceService({
		sourceId: source.id,
		projectId: source.projectId,
		newId,
		ticket,
		copyWorkingChanges: opts.copyWorkingChanges,
	});
	patchProject(source.projectId, (list) => [...list, instance]);
	return instance;
}

/** The title the duplicate dialog opens on, numbered like the ticket duplicateInstance() would create. */
export function getNextDuplicateTitle(source: {
	id: string;
	ticket: { title: string };
}): string {
	const seq =
		get(instances).filter((i) => i.parentInstanceId === source.id).length + 1;
	return `${source.ticket.title} (${seq})`;
}

/** Changes an instance status; setting it to "done" is what archives it. */
export async function setInstanceStatus(
	id: string,
	projectId: string,
	status: InstanceStatus,
): Promise<void> {
	const updated = await updateInstanceStatus(id, projectId, status);
	patchProject(projectId, (list) =>
		list.map((i) => (i.id === id ? updated : i)),
	);
}

/** Deletes an instance and everything hanging off it: terminals, agent markers, worktree. */
export async function removeInstance(
	id: string,
	projectId: string,
): Promise<void> {
	await removeInstanceTerminals(projectId, id);
	clearProjectAgentActivity(projectId, id);
	await deleteInstance(id, projectId);
	patchProject(projectId, (list) => list.filter((i) => i.id !== id));
}
