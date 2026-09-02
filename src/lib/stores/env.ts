// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Environment variables in three scopes - global, project, instance - and the .env file generated from them. */
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
import { onProjectRemoved } from "$lib/stores/project-teardown";
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
import { persist } from "$lib/utils/persist-error";
import {
	belongsToProject,
	dropProjectKeys,
	purgeProjectEntries,
} from "$lib/utils/project-scope";
import { activeInstance } from "./instance";
import { activeProject } from "./project";

const PERSIST_DEBOUNCE_MS = 250;

/** Variables applying everywhere. Lowest precedence of the three scopes. */
export const globalEnv = writable<EnvFile>(emptyEnvFile());

/** Variables of each project, keyed by project id; they override the global ones. */
export const projectEnvs = writable<Record<string, EnvFile>>({});

/** Variables of each instance, keyed by envKey(), plus its overrides of perInstance variables. Highest precedence. */
export const instanceEnvs = writable<Record<string, EnvFile>>({});

/** Instances whose target file exists but was not written by Cairn. */
export const envFileConflicts = writable<Record<string, boolean>>({});

/** Token values used to interpolate `{{ ... }}` inside variable values. */
export const envInterpolationValues = writable<Record<string, string>>({});

/** The key the instance-scoped maps are indexed by. */
export function envKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}

const loadedProjects = new Set<string>();
const loadedInstances = new Set<string>();
let loadedGlobal = false;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounces a write per key: editing a value fires on every keystroke. */
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

/** Non-reactive read of a project's file, empty when it has none. */
export function projectEnvFile(projectId: string | null): EnvFile {
	if (!projectId) return emptyEnvFile();
	return get(projectEnvs)[projectId] ?? emptyEnvFile();
}

/** Non-reactive read of an instance's file, empty when it has none. */
export function instanceEnvFile(
	projectId: string | null,
	instanceId: string | null,
): EnvFile {
	if (!projectId || !instanceId) return emptyEnvFile();
	return get(instanceEnvs)[envKey(projectId, instanceId)] ?? emptyEnvFile();
}

/** Reads the three scopes, each at most once; the global and project files are shared. */
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

/** Changes the global file and schedules its write. */
function updateGlobal(fn: (file: EnvFile) => EnvFile): void {
	globalEnv.update(fn);
	schedule("global", () => {
		persist("the global environment", saveGlobalEnv(get(globalEnv)));
	});
}

/** Changes a project file and schedules its write. */
function updateProject(
	projectId: string,
	fn: (file: EnvFile) => EnvFile,
): void {
	projectEnvs.update((m) => ({
		...m,
		[projectId]: fn(m[projectId] ?? emptyEnvFile()),
	}));
	schedule(`project:${projectId}`, () => {
		persist(
			"the project environment",
			saveProjectEnv(projectId, projectEnvFile(projectId)),
		);
	});
}

/** Changes an instance file and schedules its write. */
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
		persist(
			"the instance environment",
			saveInstanceEnv(
				projectId,
				instanceId,
				instanceEnvFile(projectId, instanceId),
			),
		);
	});
}

/** Routes a change to the right scope; an instance change with no instance id is dropped. */
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

/** Lifts a list transform into a file transform, leaving the overrides alone. */
function mapVariables(
	fn: (list: EnvVariable[]) => EnvVariable[],
): (file: EnvFile) => EnvFile {
	return (file) => ({ ...file, variables: fn(file.variables) });
}

/** A blank variable with a fresh id, enabled and not secret. */
export function newVariable(key = "", value = ""): EnvVariable {
	return {
		id: crypto.randomUUID(),
		key,
		value,
		perInstance: false,
		defaultValue: "",
		secret: false,
		enabled: true,
	};
}

/**
 * The value an instance shows for a `perInstance` variable: its own override
 * when it set one, the variable's default value otherwise. Only an explicit
 * override is persisted, so changing the default still reaches every instance
 * that never typed a value of its own.
 */
export function overrideValue(
	variable: EnvVariable,
	overrides: Record<string, string>,
): string {
	return overrides[variable.id] ?? variable.defaultValue;
}

/** Appends variables to a scope. */
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

/** Replaces a variable by id, keeping its position. */
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

/** Deletes a variable from its scope. */
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

/** A disabled variable stays declared but is left out of the resolved environment. */
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

/** Sets an instance's value for a perInstance variable; null removes the override and restores the default. */
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

/** Non-reactive read of one scope's variables. */
export function scopeVariables(
	scope: EnvScope,
	projectId: string | null,
	instanceId: string | null,
): EnvVariable[] {
	if (scope === "global") return get(globalEnv).variables;
	if (scope === "project") return projectEnvFile(projectId).variables;
	return instanceEnvFile(projectId, instanceId).variables;
}

/** Moves a single variable; the one-item case of moveVariables(). */
export function moveVariable(
	from: EnvScope,
	to: EnvScope,
	projectId: string,
	instanceId: string | null,
	id: string,
	insertIndex: number,
): void {
	moveVariables(from, to, projectId, instanceId, [id], insertIndex);
}

/**
 * Moves a selection inside a scope, or from one scope to another. The
 * variables keep the order they had in the source scope, and the insertion
 * point is corrected for the ones removed above it so the batch lands where
 * the indicator was drawn. A variable landing on the instance carries the
 * value that instance had given it, since "one value per instance" no longer
 * means anything down there.
 */
export function moveVariables(
	from: EnvScope,
	to: EnvScope,
	projectId: string,
	instanceId: string | null,
	ids: string[],
	insertIndex: number,
): void {
	if (to === "instance" && !instanceId) return;
	const source = scopeVariables(from, projectId, instanceId);
	const moving = source.filter((v) => ids.includes(v.id));
	if (moving.length === 0) return;

	if (from === to) {
		const removedBefore = source.filter(
			(v, i) => ids.includes(v.id) && i < insertIndex,
		).length;
		const rest = source.filter((v) => !ids.includes(v.id));
		const at = insertIndex - removedBefore;
		updateScope(
			from,
			projectId,
			instanceId,
			mapVariables(() => [...rest.slice(0, at), ...moving, ...rest.slice(at)]),
		);
		return;
	}

	const overrides = instanceEnvFile(projectId, instanceId).overrides;
	const moved = moving.map((variable) =>
		to === "instance"
			? {
					...variable,
					perInstance: false,
					value: overrideValue(variable, overrides),
				}
			: variable,
	);

	updateScope(
		from,
		projectId,
		instanceId,
		mapVariables((list) => list.filter((v) => !ids.includes(v.id))),
	);
	if (instanceId) {
		for (const variable of moving) {
			if (variable.perInstance) {
				setOverride(projectId, instanceId, variable.id, null);
			}
		}
	}
	updateScope(
		to,
		projectId,
		instanceId,
		mapVariables((list) => [
			...list.slice(0, insertIndex),
			...moved,
			...list.slice(insertIndex),
		]),
	);
}

/** Sets whether the generated file is written, and under which name. */
export function setProjectEnvOptions(
	projectId: string,
	patch: Partial<Pick<EnvFile, "writeEnvFile" | "envFileName">>,
): void {
	updateProject(projectId, (file) => ({ ...file, ...patch }));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Flattens the three scopes into the final entries, applying overrides and interpolation. */
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

/** The resolved environment of the active instance, for the Env view. */
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

// The login name never changes during a session, so it is fetched once.
let systemUser: Promise<string> | null = null;

/** Recomputes the interpolation tokens for an instance: its branch, worktree, ticket, and the git identity. */
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
			ticketKey: instance.ticket.key ?? "",
			ticketUrl: instance.ticket.url ?? "",
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

/** Body last written per instance: rewriting the same bytes would only wake the file watcher. */
const lastWrittenEnv = new Map<string, string>();

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
	if (!force && lastWrittenEnv.get(key) === body) return;

	const written = await writeEnvFile(
		instance.worktreePath,
		settings.envFileName,
		body,
		force,
	).catch(() => false);

	envFileConflicts.update((m) => ({ ...m, [key]: !written }));
	if (written) {
		lastWrittenEnv.set(key, body);
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

/**
 * Forgets the variables cached for a removed project and cancels its queued
 * writes. The debounce map mixes two key shapes - `project:<id>` for the
 * project file and `<id>:<instanceId>` for each instance - so both are matched
 * here rather than through the shared prefix rule alone.
 *
 * `envInterpolationValues` is left alone: it holds the tokens of whichever
 * instance is active, keyed by token name, not by project.
 */
export function forgetProject(projectId: string): void {
	for (const key of [...timers.keys()]) {
		if (key !== `project:${projectId}` && !belongsToProject(key, projectId)) {
			continue;
		}
		clearTimeout(timers.get(key));
		timers.delete(key);
	}
	loadedProjects.delete(projectId);
	purgeProjectEntries(loadedInstances, projectId);
	projectEnvs.update((m) => dropProjectKeys(m, projectId));
	instanceEnvs.update((m) => dropProjectKeys(m, projectId));
	envFileConflicts.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
