import type { CustomCommand } from "$lib/services/custom-command-service";
import { listDirNames, readFile } from "$lib/services/file-service";
import { DEFAULT_COMMAND_ICON } from "$lib/utils/icons";

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

export function detectPackageManager(fileNames: string[]): PackageManager {
	for (const [lockfile, manager] of LOCKFILES) {
		if (fileNames.includes(lockfile)) return manager;
	}
	return "npm";
}

export function runScriptCommand(
	manager: PackageManager,
	script: string,
): string {
	return manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`;
}

export function iconForScript(script: string): string {
	const name = script.toLowerCase();
	for (const [pattern, icon] of ICON_RULES) {
		if (pattern.test(name)) return icon;
	}
	return DEFAULT_COMMAND_ICON;
}

export interface ImportCandidate {
	name: string;
	script: string;
	icon: string;
}

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

export interface ImportScan {
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
