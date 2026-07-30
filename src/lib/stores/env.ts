import { derived, get, writable } from "svelte/store";
import { getSystemUser } from "$lib/services/custom-command-service";
import {
	type EnvFile,
	type EnvScope,
	type EnvVariable,
	emptyEnvFile,
	ensureEnvIgnored,
	getGlobalEnv,
	getInstanceEnv,
	getProjectEnv,
	saveGlobalEnv,
	saveInstanceEnv,
	saveProjectEnv,
	writeEnvFile,
} from "$lib/services/env-service";
import { getIdentity } from "$lib/services/git-service";
import type { Instance } from "$lib/types/instance";
import type { Project } from "$lib/types/project";
import {
	buildValues,
	substituteValues,
} from "$lib/utils/commands/command-variables";
import { serializeEnvFile } from "$lib/utils/env/env-file";
import {
	type ResolvedEnvEntry,
	resolveEnv,
	toEnvRecord,
} from "$lib/utils/env/env-resolve";
import { moveItem } from "$lib/utils/terminal/terminal-order";
import { activeInstance } from "./instance";
import { activeProject } from "./project";

const PERSIST_DEBOUNCE_MS = 250;

export const globalEnv = writable<EnvFile>(emptyEnvFile());
export const projectEnvs = writable<Record<string, EnvFile>>({});
export const instanceEnvs = writable<Record<string, EnvFile>>({});

/** Instances whose target file exists but was not written by Cairn. */
export const envFileConflicts = writable<Record<string, boolean>>({});

/** Token values used to interpolate `{{ ... }}` inside variable values. */
export const envInterpolationValues = writable<Record<string, string>>({});

export function envKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}

const loadedProjects = new Set<string>();
const loadedInstances = new Set<string>();
let loadedGlobal = false;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function schedule(key: string, write: () => void): void {
	const pending = timers.get(key);
	if (pending) clearTimeout(pending);
	timers.set(
		key,
		setTimeout(() => {
			timers.delete(key);
			write();
		}, PERSIST_DEBOUNCE_MS),
	);
}

export function projectEnvFile(projectId: string | null): EnvFile {
	if (!projectId) return emptyEnvFile();
	return get(projectEnvs)[projectId] ?? emptyEnvFile();
}

export function instanceEnvFile(
	projectId: string | null,
	instanceId: string | null,
): EnvFile {
	if (!projectId || !instanceId) return emptyEnvFile();
	return get(instanceEnvs)[envKey(projectId, instanceId)] ?? emptyEnvFile();
}

export async function loadEnv(
	projectId: string,
	instanceId: string | null,
): Promise<void> {
	if (!loadedGlobal) {
		loadedGlobal = true;
		const file = await getGlobalEnv().catch(() => null);
		if (file) globalEnv.set(file);
	}
	if (!loadedProjects.has(projectId)) {
		loadedProjects.add(projectId);
		const file = await getProjectEnv(projectId).catch(() => null);
		if (file) projectEnvs.update((m) => ({ ...m, [projectId]: file }));
	}
	if (!instanceId) return;
	const key = envKey(projectId, instanceId);
	if (loadedInstances.has(key)) return;
	loadedInstances.add(key);
	const file = await getInstanceEnv(projectId, instanceId).catch(() => null);
	if (file) instanceEnvs.update((m) => ({ ...m, [key]: file }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function updateGlobal(fn: (file: EnvFile) => EnvFile): void {
	globalEnv.update(fn);
	schedule("global", () => {
		void saveGlobalEnv(get(globalEnv)).catch(() => {});
	});
}

function updateProject(
	projectId: string,
	fn: (file: EnvFile) => EnvFile,
): void {
	projectEnvs.update((m) => ({
		...m,
		[projectId]: fn(m[projectId] ?? emptyEnvFile()),
	}));
	schedule(`project:${projectId}`, () => {
		void saveProjectEnv(projectId, projectEnvFile(projectId)).catch(() => {});
	});
}

function updateInstance(
	projectId: string,
	instanceId: string,
	fn: (file: EnvFile) => EnvFile,
): void {
	const key = envKey(projectId, instanceId);
	instanceEnvs.update((m) => ({
		...m,
		[key]: fn(m[key] ?? emptyEnvFile()),
	}));
	schedule(key, () => {
		void saveInstanceEnv(
			projectId,
			instanceId,
			instanceEnvFile(projectId, instanceId),
		).catch(() => {});
	});
}

function updateScope(
	scope: EnvScope,
	projectId: string,
	instanceId: string | null,
	fn: (file: EnvFile) => EnvFile,
): void {
	if (scope === "global") updateGlobal(fn);
	else if (scope === "project") updateProject(projectId, fn);
	else if (instanceId) updateInstance(projectId, instanceId, fn);
}

function mapVariables(
	fn: (list: EnvVariable[]) => EnvVariable[],
): (file: EnvFile) => EnvFile {
	return (file) => ({ ...file, variables: fn(file.variables) });
}

export function newVariable(key = "", value = ""): EnvVariable {
	return {
		id: crypto.randomUUID(),
		key,
		value,
		perInstance: false,
		secret: false,
		enabled: true,
	};
}

export function addVariables(
	scope: EnvScope,
	projectId: string,
	instanceId: string | null,
	variables: EnvVariable[],
): void {
	updateScope(
		scope,
		projectId,
		instanceId,
		mapVariables((list) => [...list, ...variables]),
	);
}

export function updateVariable(
	scope: EnvScope,
	projectId: string,
	instanceId: string | null,
	variable: EnvVariable,
): void {
	updateScope(
		scope,
		projectId,
		instanceId,
		mapVariables((list) =>
			list.map((v) => (v.id === variable.id ? variable : v)),
		),
	);
}

export function removeVariable(
	scope: EnvScope,
	projectId: string,
	instanceId: string | null,
	id: string,
): void {
	updateScope(
		scope,
		projectId,
		instanceId,
		mapVariables((list) => list.filter((v) => v.id !== id)),
	);
}

export function toggleVariableEnabled(
	scope: EnvScope,
	projectId: string,
	instanceId: string | null,
	id: string,
): void {
	updateScope(
		scope,
		projectId,
		instanceId,
		mapVariables((list) =>
			list.map((v) => (v.id === id ? { ...v, enabled: !v.enabled } : v)),
		),
	);
}

export function setOverride(
	projectId: string,
	instanceId: string,
	variableId: string,
	value: string | null,
): void {
	updateInstance(projectId, instanceId, (file) => {
		const overrides = { ...file.overrides };
		if (value === null) delete overrides[variableId];
		else overrides[variableId] = value;
		return { ...file, overrides };
	});
}

export function scopeVariables(
	scope: EnvScope,
	projectId: string | null,
	instanceId: string | null,
): EnvVariable[] {
	if (scope === "global") return get(globalEnv).variables;
	if (scope === "project") return projectEnvFile(projectId).variables;
	return instanceEnvFile(projectId, instanceId).variables;
}

/**
 * Moves a variable inside a scope, or from one scope to another. A variable
 * landing on the instance carries the value that instance had given it, since
 * "one value per instance" no longer means anything down there.
 */
export function moveVariable(
	from: EnvScope,
	to: EnvScope,
	projectId: string,
	instanceId: string | null,
	id: string,
	insertIndex: number,
): void {
	if (to === "instance" && !instanceId) return;
	const source = scopeVariables(from, projectId, instanceId);
	const index = source.findIndex((v) => v.id === id);
	if (index === -1) return;
	const variable = source[index];

	if (from === to) {
		updateScope(
			from,
			projectId,
			instanceId,
			mapVariables((list) => moveItem(list, index, insertIndex)),
		);
		return;
	}

	const override = instanceEnvFile(projectId, instanceId).overrides[id];
	const moved =
		to === "instance"
			? { ...variable, perInstance: false, value: override ?? variable.value }
			: variable;

	updateScope(
		from,
		projectId,
		instanceId,
		mapVariables((list) => list.filter((v) => v.id !== id)),
	);
	if (variable.perInstance && instanceId) {
		setOverride(projectId, instanceId, id, null);
	}
	updateScope(
		to,
		projectId,
		instanceId,
		mapVariables((list) => [
			...list.slice(0, insertIndex),
			moved,
			...list.slice(insertIndex),
		]),
	);
}

export function setProjectEnvOptions(
	projectId: string,
	patch: Partial<Pick<EnvFile, "writeEnvFile" | "envFileName">>,
): void {
	updateProject(projectId, (file) => ({ ...file, ...patch }));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveInstanceEnv(
	projectId: string | null,
	instanceId: string | null,
	values: Record<string, string> = get(envInterpolationValues),
): ResolvedEnvEntry[] {
	const instanceFile = instanceEnvFile(projectId, instanceId);
	return resolveEnv({
		global: get(globalEnv).variables,
		project: projectEnvFile(projectId).variables,
		instance: instanceFile.variables,
		overrides: instanceFile.overrides,
		interpolate: (value) => substituteValues(value, values),
	});
}

export const resolvedEnv = derived(
	[
		globalEnv,
		projectEnvs,
		instanceEnvs,
		envInterpolationValues,
		activeProject,
		activeInstance,
	],
	([, , , $values, $project, $instance]) =>
		resolveInstanceEnv($project?.id ?? null, $instance?.id ?? null, $values),
);

let systemUser: Promise<string> | null = null;

async function refreshInterpolationValues(
	project: Project,
	instance: Instance,
): Promise<Record<string, string>> {
	if (!systemUser) systemUser = getSystemUser().catch(() => "");
	const [identity, login] = await Promise.all([
		getIdentity(instance.worktreePath).catch(() => ({ name: "", email: "" })),
		systemUser,
	]);
	const values = buildValues({
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
	});
	envInterpolationValues.set(values);
	return values;
}

/**
 * The variables to inject into any process started for this instance. Loading
 * and interpolation happen here so every caller - terminal, command, agent -
 * gets the same set without repeating the plumbing.
 */
export async function buildInstanceEnv(
	project: Project | null,
	instance: Instance | null,
): Promise<Record<string, string>> {
	if (!project || !instance) return {};
	await loadEnv(project.id, instance.id);
	const values = await refreshInterpolationValues(project, instance);
	return toEnvRecord(resolveInstanceEnv(project.id, instance.id, values));
}

/**
 * Materializes the generated file in the worktree so a program reading `.env`
 * keeps working. A foreign file is never overwritten: the conflict is reported
 * instead, and the view offers to import it.
 */
export async function syncEnvFile(
	project: Project | null,
	instance: Instance | null,
	record?: Record<string, string>,
	force = false,
): Promise<void> {
	if (!project || !instance?.worktreePath) return;

	const resolved = record ?? (await buildInstanceEnv(project, instance));
	const settings = projectEnvFile(project.id);
	const key = envKey(project.id, instance.id);
	if (!settings.writeEnvFile) {
		envFileConflicts.update((m) => ({ ...m, [key]: false }));
		return;
	}

	const body = serializeEnvFile(
		Object.entries(resolved).map(([key, value]) => ({ key, value })),
	);

	const written = await writeEnvFile(
		instance.worktreePath,
		settings.envFileName,
		body,
		force,
	).catch(() => false);

	envFileConflicts.update((m) => ({ ...m, [key]: !written }));
	if (written) {
		await ensureEnvIgnored(instance.worktreePath, settings.envFileName).catch(
			() => false,
		);
	}
}

/** Both the injected variables and the generated file, in one call. */
export async function prepareInstanceEnv(
	project: Project | null,
	instance: Instance | null,
): Promise<Record<string, string>> {
	const record = await buildInstanceEnv(project, instance);
	await syncEnvFile(project, instance, record);
	return record;
}
