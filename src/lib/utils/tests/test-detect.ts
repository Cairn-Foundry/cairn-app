// Finding how a worktree runs its tests. Extends the package.json scan of
// command-import.ts to Cargo, pytest and go, since a repository can hold more
// than one ecosystem and each one gets its own runner.
import { listDirNames, readFile } from "$lib/services/file-service";
import type { TestRunner, TestRunnerId } from "$lib/types/tests";
import {
	detectPackageManager,
	type PackageManager,
	parseScripts,
	runScriptCommand,
} from "$lib/utils/commands/command-import";

/** The scripts whose name reads as "this runs the tests", best first. */
const TEST_SCRIPTS = ["test", "tests", "test:unit", "unit", "spec"];

/** Which framework a package.json depends on, and so which reporter to ask for. */
function detectJsFramework(packageJson: string): "vitest" | "jest" | null {
	try {
		const parsed = JSON.parse(packageJson) as Record<string, unknown>;
		const deps = {
			...((parsed.dependencies as Record<string, string>) ?? {}),
			...((parsed.devDependencies as Record<string, string>) ?? {}),
		};
		if ("vitest" in deps) return "vitest";
		if ("jest" in deps) return "jest";
		return null;
	} catch {
		return null;
	}
}

/**
 * The reporter flags that make a runner machine-readable. They are appended to
 * the user's own script, so a project keeping its flags in package.json keeps
 * them.
 */
function reporterFlags(id: TestRunnerId): string {
	switch (id) {
		case "vitest":
			// `verbose` is the only text reporter that prints a test as soon as
			// it finishes; `default` withholds a file until the whole file is
			// done, which reads as "nothing streams".
			return "--reporter=json --reporter=verbose";
		case "jest":
			return "--json --testLocationInResults";
		case "nextest":
			return "--message-format libtest-json";
		case "go":
			return "-json";
		default:
			return "";
	}
}

/** Appends the reporter flags after `--` when the command goes through a package manager. */
function withReporter(
	command: string,
	id: TestRunnerId,
	manager: PackageManager | null,
): string {
	const flags = reporterFlags(id);
	if (!flags) return command;
	return manager ? `${command} -- ${flags}` : `${command} ${flags}`;
}

/** The JS runner of a directory, or null when it has no usable test script. */
async function detectJs(
	dir: string,
	names: string[],
	subdir: string,
): Promise<TestRunner | null> {
	if (!names.includes("package.json")) return null;
	const content = await readFile(`${dir}/package.json`).catch(() => null);
	if (!content) return null;

	const framework = detectJsFramework(content);
	if (!framework) return null;

	const scripts = parseScripts(content);
	const manager = detectPackageManager(names);
	const script = TEST_SCRIPTS.find((name) => name in scripts);

	const base = script
		? runScriptCommand(manager, script)
		: `${manager === "npm" ? "npx" : manager} ${framework} run`;

	return {
		id: framework,
		label: framework === "vitest" ? "Vitest" : "Jest",
		command: withReporter(base, framework, script ? manager : null),
		subdir,
		detectedFrom: script ? `package.json#scripts.${script}` : "package.json",
	};
}

/**
 * Cargo, preferring nextest: its libtest-json output is stable, where
 * `cargo test --format json` needs nightly. Falls back to plain `cargo test`,
 * whose text output the Rust side parses instead.
 */
function detectCargo(
	names: string[],
	subdir: string,
	hasNextest: boolean,
): TestRunner | null {
	if (!names.includes("Cargo.toml")) return null;
	return hasNextest
		? {
				id: "nextest",
				label: "cargo-nextest",
				command: withReporter("cargo nextest run", "nextest", null),
				subdir,
				detectedFrom: "Cargo.toml (nextest)",
			}
		: {
				id: "cargo",
				label: "cargo test",
				command: "cargo test",
				subdir,
				detectedFrom: "Cargo.toml",
			};
}

const PYTEST_MARKERS = ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini"];

function detectPytest(names: string[], subdir: string): TestRunner | null {
	const marker = PYTEST_MARKERS.find((name) => names.includes(name));
	if (!marker) return null;
	return {
		id: "pytest",
		label: "pytest",
		command: "pytest -v",
		subdir,
		detectedFrom: marker,
	};
}

function detectGo(names: string[], subdir: string): TestRunner | null {
	if (!names.includes("go.mod")) return null;
	return {
		id: "go",
		label: "go test",
		command: withReporter("go test ./...", "go", null),
		subdir,
		detectedFrom: "go.mod",
	};
}

/** The sub-directories a monorepo commonly puts a second ecosystem in. */
const NESTED_DIRS = ["src-tauri", "backend", "server", "api"];

/** Every runner found in one directory, in the order they should be offered. */
async function detectIn(
	root: string,
	subdir: string,
	hasNextest: boolean,
): Promise<TestRunner[]> {
	const dir = subdir ? `${root}/${subdir}` : root;
	const names = await listDirNames(dir).catch(() => [] as string[]);
	if (names.length === 0) return [];

	const js = await detectJs(dir, names, subdir);
	return [
		js,
		detectCargo(names, subdir, hasNextest),
		detectPytest(names, subdir),
		detectGo(names, subdir),
	].filter((runner): runner is TestRunner => runner !== null);
}

/**
 * Every runner a worktree exposes, root first then the usual nested folders.
 * `hasNextest` comes from the backend, which alone can look for the binary.
 */
export async function detectTestRunners(
	worktreePath: string,
	hasNextest: boolean,
): Promise<TestRunner[]> {
	const found = await Promise.all([
		detectIn(worktreePath, "", hasNextest),
		...NESTED_DIRS.map((dir) => detectIn(worktreePath, dir, hasNextest)),
	]);
	return found.flat();
}
