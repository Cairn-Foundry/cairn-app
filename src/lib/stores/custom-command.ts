import { get, writable } from "svelte/store";
import {
	type CommandScope,
	type CustomCommand,
	getGlobalCommands,
	getProjectCommands,
	saveGlobalCommands,
	saveProjectCommands,
} from "$lib/services/custom-command-service";
import { DEFAULT_COMMAND_ICON } from "$lib/utils/icons";
import { moveItem } from "$lib/utils/terminal/terminal-order";

export const projectCommands = writable<Record<string, CustomCommand[]>>({});
export const globalCommands = writable<CustomCommand[]>([]);

const loadedProjects = new Set<string>();
let loadedGlobal = false;

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

function persist(scope: CommandScope, projectId: string): void {
	if (scope === "global") {
		void saveGlobalCommands({ commands: get(globalCommands) }).catch(() => {});
		return;
	}
	const commands = get(projectCommands)[projectId] ?? [];
	void saveProjectCommands(projectId, { commands }).catch(() => {});
}

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

export function addCommand(
	scope: CommandScope,
	projectId: string,
	command: CustomCommand,
): void {
	updateScope(scope, projectId, (list) => [...list, command]);
}

export function addCommands(
	scope: CommandScope,
	projectId: string,
	commands: CustomCommand[],
): void {
	updateScope(scope, projectId, (list) => [...list, ...commands]);
}

export function updateCommand(
	scope: CommandScope,
	projectId: string,
	command: CustomCommand,
): void {
	updateScope(scope, projectId, (list) =>
		list.map((c) => (c.id === command.id ? command : c)),
	);
}

export function removeCommand(
	scope: CommandScope,
	projectId: string,
	id: string,
): void {
	updateScope(scope, projectId, (list) => list.filter((c) => c.id !== id));
}

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

export function toggleCommandPinned(
	scope: CommandScope,
	projectId: string,
	id: string,
): void {
	updateScope(scope, projectId, (list) =>
		list.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
	);
}

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
