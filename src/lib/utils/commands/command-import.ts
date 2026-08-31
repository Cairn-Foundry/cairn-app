// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Turning a project's `package.json` scripts into importable custom commands,
// guessing the package manager from the lockfile and an icon from the name.
import type { CustomCommand } from "$lib/services/custom-command-service";
import { listDirNames, readFile } from "$lib/services/file-service";
import { DEFAULT_COMMAND_ICON } from "$lib/utils/icons";

/** The package managers a lockfile can identify; npm is the fallback. */
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

const LOCKFILES: Array<[string, PackageManager]> = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
];

const ICON_RULES: Array<[RegExp, string]> = [
	[/^(dev|start|serve|preview)/, "play"],
	[/^(build|compile|bundle)/, "package"],
	[/^(test|spec|e2e|vitest|jest)/, "tests"],
	[/^(lint|format|fmt|check|typecheck)/, "check"],
	[/^(deploy|publish|release)/, "upload"],
	[/^(clean|reset|prune)/, "trash"],
	[/^(db|migrate|seed|prisma|drizzle)/, "database"],
	[/^(docker|compose|container)/, "container"],
	[/^(doc|docs|storybook)/, "book"],
];

/** First lockfile found wins, in LOCKFILES order; npm when none is present. */
export function detectPackageManager(fileNames: string[]): PackageManager {
	for (const [lockfile, manager] of LOCKFILES) {
		if (fileNames.includes(lockfile)) return manager;
	}
	return "npm";
}

/** Yarn takes the script name directly, the others need `run`. */
export function runScriptCommand(
	manager: PackageManager,
	script: string,
): string {
	return manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`;
}

/** Guesses an icon from the script name, matched on its first word only. */
export function iconForScript(script: string): string {
	const name = script.toLowerCase();
	for (const [pattern, icon] of ICON_RULES) {
		if (pattern.test(name)) return icon;
	}
	return DEFAULT_COMMAND_ICON;
}

/** One script offered for import, before the user accepts it. */
export interface ImportCandidate {
	name: string;
	script: string;
	icon: string;
}

/** Malformed JSON or non-string entries yield nothing rather than throwing. */
export function parseScripts(packageJson: string): Record<string, string> {
	try {
		const parsed = JSON.parse(packageJson) as {
			scripts?: Record<string, unknown>;
		};
		const scripts = parsed.scripts;
		if (!scripts || typeof scripts !== "object") return {};
		return Object.fromEntries(
			Object.entries(scripts).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

/** Candidates keep the declaration order of the scripts object. */
export function buildCandidates(
	scripts: Record<string, string>,
	manager: PackageManager,
): ImportCandidate[] {
	return Object.keys(scripts).map((name) => ({
		name,
		script: runScriptCommand(manager, name),
		icon: iconForScript(name),
	}));
}

/**
 * An accepted candidate as a stored command: one step, run in the worktree,
 * tagged `package.json` so a later re-import can tell it apart from a hand
 * written one.
 */
/**
 * An accepted candidate as a stored command: one step, run in the worktree,
 * tagged `package.json` so a later re-import can tell it apart from a hand
 * written one.
 */
export function candidateToCommand(candidate: ImportCandidate): CustomCommand {
	return {
		id: crypto.randomUUID(),
		name: candidate.name,
		icon: candidate.icon,
		steps: [candidate.script],
		stopOnError: true,
		cwd: "worktree",
		pinned: false,
		autoClose: false,
		confirm: false,
		source: "package.json",
	};
}

/** The result of scanning one directory: the manager plus what it can offer. */
interface ImportScan {
	manager: PackageManager;
	candidates: ImportCandidate[];
}

/** Read `package.json` at `dir` and turn its scripts into import candidates. */
export async function scanPackageJson(dir: string): Promise<ImportScan> {
	const [names, content] = await Promise.all([
		listDirNames(dir).catch(() => [] as string[]),
		readFile(`${dir}/package.json`).catch(() => null),
	]);
	const manager = detectPackageManager(names);
	if (!content) return { manager, candidates: [] };
	return {
		manager,
		candidates: buildCandidates(parseScripts(content), manager),
	};
}
