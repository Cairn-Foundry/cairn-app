// Narrowing a run to one file or one test. The runner command is composed by
// the frontend, so restricting a run is a matter of appending the right
// arguments for the detected runner.
import type { TestRunnerId } from "$lib/types/tests";

/** What a run covers: the whole worktree, one file, or a single test. */
export type RunScope =
	| { kind: "all" }
	| { kind: "file"; file: string }
	| { kind: "case"; file: string; name: string };

/**
 * Quotes a value for a POSIX shell or `cmd`. Single quotes are the safe form
 * everywhere except Windows, where `cmd` does not understand them.
 */
function quote(value: string, isWindows: boolean): string {
	if (isWindows) return `"${value.replace(/"/g, '""')}"`;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A test name as a regular expression anchored on the literal name, so a test
 * whose title contains regex characters still matches only itself.
 */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The command that runs `scope` with `runner`. Returns the command unchanged
 * for a whole-worktree run, and for any runner whose filtering flags we do not
 * model.
 *
 * `isWindows` only decides the quoting style.
 */
export function scopedCommand(
	command: string,
	runnerId: TestRunnerId,
	scope: RunScope,
	isWindows = false,
): string {
	if (scope.kind === "all") return command;

	const q = (value: string) => quote(value, isWindows);

	switch (runnerId) {
		case "vitest":
		case "jest": {
			// Both take a positional path filter, and -t for the test name.
			const parts = [command, q(scope.file)];
			if (scope.kind === "case") parts.push("-t", q(escapeRegex(scope.name)));
			return parts.join(" ");
		}
		case "pytest": {
			if (scope.kind === "case") {
				return `${command} ${q(scope.file)} -k ${q(scope.name)}`;
			}
			return `${command} ${q(scope.file)}`;
		}
		case "go": {
			// go test filters by package, and -run takes a regex of test names.
			if (scope.kind === "case") {
				return `${command} -run ${q(`^${escapeRegex(scope.name)}$`)}`;
			}
			return command;
		}
		case "cargo":
		case "nextest": {
			// cargo takes a substring filter, not a path.
			if (scope.kind === "case") return `${command} ${q(scope.name)}`;
			return command;
		}
		default:
			return command;
	}
}

/** Whether narrowing to one file is meaningful for this runner. */
export function supportsFileScope(runnerId: TestRunnerId): boolean {
	return runnerId === "vitest" || runnerId === "jest" || runnerId === "pytest";
}
