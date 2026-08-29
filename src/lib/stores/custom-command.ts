/** User-defined commands, in two scopes: per project and global. */
import { get, writable } from "svelte/store";
import {
	type CommandScope,
	type CustomCommand,
	getGlobalCommands,
	getProjectCommands,
	saveGlobalCommands,
	saveProjectCommands,
} from "$lib/services/custom-command-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { DEFAULT_COMMAND_ICON } from "$lib/utils/icons";
import { persist as persistToDisk } from "$lib/utils/persist-error";
import { dropProjectKeys } from "$lib/utils/project-scope";
import { moveItem } from "$lib/utils/terminal/terminal-order";

/** Commands defined by a project, keyed by project id; only loaded projects appear. */
export const projectCommands = writable<Record<string, CustomCommand[]>>({});

/** Commands available in every project. */
export const globalCommands = writable<CustomCommand[]>([]);

const loadedProjects = new Set<string>();
let loadedGlobal = false;

/** A blank command with the defaults the editor starts from; not added to any scope. */
export function newCommand(name: string): CustomCommand {
	return {
		id: crypto.randomUUID(),
		name,
		icon: DEFAULT_COMMAND_ICON,
		steps: [""],
		stopOnError: true,
		cwd: "worktree",
		pinned: true,
		autoClose: false,
		confirm: false,
		source: "manual",
	};
}

/** Writes the whole scope back to disk, fire and forget. */
function persist(scope: CommandScope, projectId: string): void {
	if (scope === "global") {
		persistToDisk(
			"the global commands",
			saveGlobalCommands({ commands: get(globalCommands) }),
		);
		return;
	}
	const commands = get(projectCommands)[projectId] ?? [];
	persistToDisk(
		"the project commands",
		saveProjectCommands(projectId, { commands }),
	);
}

/** Applies a change to one scope and persists it; the single write path for both stores. */
function updateScope(
	scope: CommandScope,
	projectId: string,
	fn: (list: CustomCommand[]) => CustomCommand[],
): void {
	if (scope === "global") globalCommands.update(fn);
	else
		projectCommands.update((m) => ({
			...m,
			[projectId]: fn(m[projectId] ?? []),
		}));
	persist(scope, projectId);
}

/** Loads the global commands once and this project's commands once; later calls are no-ops. */
export async function loadCommands(projectId: string): Promise<void> {
	if (!loadedGlobal) {
		loadedGlobal = true;
		const global = await getGlobalCommands().catch(() => null);
		globalCommands.set(global?.commands ?? []);
	}
	if (loadedProjects.has(projectId)) return;
	loadedProjects.add(projectId);
	const file = await getProjectCommands(projectId).catch(() => null);
	projectCommands.update((m) => ({ ...m, [projectId]: file?.commands ?? [] }));
}

/** Appends one command to a scope. */
export function addCommand(
	scope: CommandScope,
	projectId: string,
	command: CustomCommand,
): void {
	updateScope(scope, projectId, (list) => [...list, command]);
}

/** Appends several commands at once, for an import. */
export function addCommands(
	scope: CommandScope,
	projectId: string,
	commands: CustomCommand[],
): void {
	updateScope(scope, projectId, (list) => [...list, ...commands]);
}

/** Replaces a command by id, keeping its position. */
export function updateCommand(
	scope: CommandScope,
	projectId: string,
	command: CustomCommand,
): void {
	updateScope(scope, projectId, (list) =>
		list.map((c) => (c.id === command.id ? command : c)),
	);
}

/** Deletes a command. */
export function removeCommand(
	scope: CommandScope,
	projectId: string,
	id: string,
): void {
	updateScope(scope, projectId, (list) => list.filter((c) => c.id !== id));
}

/** Copies a command under a new id and name, appended at the end. */
export function duplicateCommand(
	scope: CommandScope,
	projectId: string,
	id: string,
	name: string,
): void {
	updateScope(scope, projectId, (list) => {
		const source = list.find((c) => c.id === id);
		if (!source) return list;
		return [...list, { ...source, id: crypto.randomUUID(), name }];
	});
}

/** Pinned commands are the ones shown as buttons rather than only in the list. */
export function toggleCommandPinned(
	scope: CommandScope,
	projectId: string,
	id: string,
): void {
	updateScope(scope, projectId, (list) =>
		list.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
	);
}

/** Moves a command between the project and global scopes, at a chosen index; both scopes are rewritten. */
export function moveCommandToScope(
	from: CommandScope,
	to: CommandScope,
	projectId: string,
	id: string,
	insertIndex: number,
): void {
	if (from === to) return;
	const source = (
		from === "global"
			? get(globalCommands)
			: (get(projectCommands)[projectId] ?? [])
	).find((c) => c.id === id);
	if (!source) return;
	updateScope(from, projectId, (list) => list.filter((c) => c.id !== id));
	updateScope(to, projectId, (list) => {
		const index = Math.max(0, Math.min(insertIndex, list.length));
		return [...list.slice(0, index), source, ...list.slice(index)];
	});
}

/** Reorders a command within its scope after a drag. */
export function reorderCommand(
	scope: CommandScope,
	projectId: string,
	fromIndex: number,
	insertIndex: number,
): void {
	updateScope(scope, projectId, (list) =>
		moveItem(list, fromIndex, insertIndex),
	);
}

/** Forgets the commands cached for a removed project. */
export function forgetProject(projectId: string): void {
	projectCommands.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
