import { get, writable } from "svelte/store";
import {
	allocatePort,
	type CustomCommand,
	getCommandState,
	getSystemUser,
	saveCommandState,
} from "$lib/services/custom-command-service";
import { getIdentity } from "$lib/services/git-service";
import type { Instance } from "$lib/types/instance";
import type { Project } from "$lib/types/project";
import {
	type AllocatedPort,
	buildEnv,
	buildScript,
	buildValues,
	collectPortBases,
	collectPrompts,
	type Resolution,
} from "$lib/utils/commands/command-variables";
import { onTerminalExit } from "$lib/utils/terminal/terminal-manager";
import { prepareInstanceEnv } from "./env";
import {
	addCommandTerminal,
	removeTerminal,
	terminalSessions,
} from "./terminal";
import { showTool } from "./ui";

/**
 * A run only exists while the command is actually running. It is dropped as soon
 * as the process ends or its terminal is closed, so a command that is over goes
 * back to being idle instead of keeping a stale badge.
 */
export interface CommandRun {
	projectId: string;
	instanceId: string;
	commandId: string;
	terminalId: string;
	ports: AllocatedPort[];
	autoClose: boolean;
}

export const commandRuns = writable<Record<string, CommandRun>>({});

export function commandRunKey(
	projectId: string,
	instanceId: string,
	commandId: string,
): string {
	return `${projectId}:${instanceId}:${commandId}`;
}

function findRunByTerminal(terminalId: string): [string, CommandRun] | null {
	for (const entry of Object.entries(get(commandRuns))) {
		if (entry[1].terminalId === terminalId) return entry;
	}
	return null;
}

function dropRun(key: string): void {
	commandRuns.update((m) => {
		const next = { ...m };
		delete next[key];
		return next;
	});
}

onTerminalExit(({ id, exitCode }) => {
	const found = findRunByTerminal(id);
	if (!found) return;
	const [key, run] = found;
	if (run.autoClose && exitCode === 0) void stopCommand(key);
	else dropRun(key);
});

terminalSessions.subscribe((sessions) => {
	const alive = new Set(
		Object.values(sessions).flatMap((list) => list.map((s) => s.id)),
	);
	for (const [key, run] of Object.entries(get(commandRuns))) {
		if (!alive.has(run.terminalId)) dropRun(key);
	}
});

async function resolvePorts(
	command: CustomCommand,
	projectId: string,
	instanceId: string,
): Promise<AllocatedPort[]> {
	const bases = collectPortBases(command.steps);
	if (bases.length === 0) return [];

	const state = await getCommandState(projectId, instanceId).catch(() => ({
		ports: {} as Record<string, number>,
	}));
	const allocated: AllocatedPort[] = [];
	for (const base of bases) {
		const slot = `${command.id}:${base}`;
		const port = await allocatePort(
			base,
			state.ports[slot] ?? null,
			allocated.map((a) => a.port),
		);
		state.ports[slot] = port;
		allocated.push({ base, port });
	}
	await saveCommandState(projectId, instanceId, state).catch(() => {});
	return allocated;
}

async function buildResolution(
	command: CustomCommand,
	project: Project,
	instance: Instance,
	prompts: Record<string, string>,
): Promise<Resolution> {
	const [identity, login, ports] = await Promise.all([
		getIdentity(instance.worktreePath).catch(() => ({ name: "", email: "" })),
		getSystemUser().catch(() => ""),
		resolvePorts(command, project.id, instance.id),
	]);

	return {
		values: buildValues({
			instance: {
				id: instance.id,
				branch: instance.branch,
				worktreePath: instance.worktreePath,
				ticketId: instance.ticket.id,
				ticketTitle: instance.ticket.title,
				baseBranch: instance.baseBranch,
			},
			project: { id: project.id, name: project.name, path: project.path },
			user: { name: identity.name, email: identity.email, login },
			now: new Date(),
		}),
		prompts,
		ports,
	};
}

export async function launchCommand(
	command: CustomCommand,
	project: Project,
	instance: Instance,
	prompts: Record<string, string> = {},
): Promise<void> {
	const key = commandRunKey(project.id, instance.id, command.id);
	const previous = get(commandRuns)[key];
	if (previous) await stopCommand(key);

	const [resolution, userEnv] = await Promise.all([
		buildResolution(command, project, instance, prompts),
		prepareInstanceEnv(project, instance),
	]);
	const script = buildScript(command.steps, command.stopOnError, resolution);
	if (!script) return;

	const cwd =
		command.cwd === "projectRoot" ? project.path : instance.worktreePath;
	const port = resolution.ports[0]?.port;

	const terminalId = await addCommandTerminal(
		project.id,
		instance.id,
		cwd,
		{
			title: port ? `${command.name} :${port}` : command.name,
			commandId: command.id,
			icon: command.icon,
			port,
		},
		script,
		buildEnv(resolution, userEnv),
	);

	commandRuns.update((m) => ({
		...m,
		[key]: {
			projectId: project.id,
			instanceId: instance.id,
			commandId: command.id,
			terminalId,
			ports: resolution.ports,
			autoClose: command.autoClose,
		},
	}));

	showTool("terminal");
}

export interface PendingLaunch {
	command: CustomCommand;
	project: Project;
	instance: Instance;
	prompts: string[];
}

/** A launch waiting on a confirmation or on the answers to its prompts. */
export const pendingLaunch = writable<PendingLaunch | null>(null);

export async function requestCommandLaunch(
	command: CustomCommand,
	project: Project,
	instance: Instance,
): Promise<void> {
	const prompts = collectPrompts(command.steps);
	if (command.confirm || prompts.length > 0) {
		pendingLaunch.set({ command, project, instance, prompts });
		return;
	}
	await launchCommand(command, project, instance);
}

export function cancelPendingLaunch(): void {
	pendingLaunch.set(null);
}

export async function confirmPendingLaunch(
	prompts: Record<string, string> = {},
): Promise<void> {
	const pending = get(pendingLaunch);
	if (!pending) return;
	pendingLaunch.set(null);
	await launchCommand(
		pending.command,
		pending.project,
		pending.instance,
		prompts,
	);
}

export async function stopCommand(key: string): Promise<void> {
	const run = get(commandRuns)[key];
	if (!run) return;
	await removeTerminal(run.projectId, run.instanceId, run.terminalId);
}
