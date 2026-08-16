// How a run replaces what is on screen.
//
// This is the one place that answers "given the previous tree, a scope, and the
// results seen so far, what should the list show". Splitting that question
// across several call sites is what produced the earlier crop of bugs: each fix
// taught one rule to one function, and the rules disagreed at the seams.
//
// The model is deliberately simple:
//
//   - A run accumulates the cases it observes, keyed by their stable id.
//   - The tree shown is derived from the previous tree plus that accumulation.
//   - Nothing is deleted while the run is in flight; pruning happens once, at
//     the end, when silence is finally meaningful.
import type { TestCase, TestSuite } from "$lib/types/tests";
import type { RunScope } from "./test-scope";
import { aggregateStatus } from "./test-tree";

/** Everything one run has observed so far. */
export interface RunProgress {
	scope: RunScope;
	/** Cases observed this run, by case id. */
	cases: Map<string, TestCase>;
	/** Files that have reported at least once this run. */
	files: Set<string>;
	/** Load failures reported this run, by file. */
	errors: Map<string, string>;
}

export function startRun(scope: RunScope): RunProgress {
	return { scope, cases: new Map(), files: new Set(), errors: new Map() };
}

/**
 * Whether a result belongs to what the run actually covered.
 *
 * A scoped run still reports the tests it stepped over, marked `skip`, because
 * the runner loaded their file. Those are bystanders, not results: recording
 * them would overwrite outcomes the user is looking at. A real pass or fail is
 * always a fact worth keeping, whatever the scope.
 */
export function isObserved(entry: TestCase, scope: RunScope): boolean {
	if (scope.kind === "all" || entry.status !== "skip") return true;
	if (scope.kind === "file") return entry.file === scope.file;
	return entry.name === scope.name;
}

/** Records one case. Later results for the same id replace earlier ones. */
export function observeCase(run: RunProgress, entry: TestCase): RunProgress {
	if (!isObserved(entry, run.scope)) return run;
	run.cases.set(entry.id, entry);
	run.files.add(entry.file);
	return run;
}

/** Records a file that could not be loaded at all. */
export function observeSuiteError(
	run: RunProgress,
	file: string,
	message: string,
): RunProgress {
	run.errors.set(file, message);
	run.files.add(file);
	return run;
}

/** The files this run is expected to cover, given its scope. */
function coversFile(scope: RunScope, file: string): boolean {
	if (scope.kind === "all") return true;
	return scope.file === file;
}

/**
 * The tree to display.
 *
 * A file the run has already reported shows only this run's results, so a test
 * deleted since last time disappears. A file it covers but has not reached yet
 * keeps its previous rows, which is what lets the UI mark it as still working.
 * A file outside the scope is untouched.
 *
 * `final` is set once the run has ended: only then does a covered file that
 * never reported get dropped, because only then does its silence mean it is
 * gone.
 */
export function buildTree(
	previous: TestSuite[],
	run: RunProgress,
	final = false,
): TestSuite[] {
	const byFile = new Map<string, TestCase[]>();
	for (const entry of run.cases.values()) {
		const list = byFile.get(entry.file);
		if (list) list.push(entry);
		else byFile.set(entry.file, [entry]);
	}

	const result: TestSuite[] = [];
	const seen = new Set<string>();

	for (const suite of previous) {
		seen.add(suite.file);
		const reported = run.files.has(suite.file);

		if (!reported) {
			// Covered but silent: keep it while the run goes, drop it at the end.
			if (final && coversFile(run.scope, suite.file)) continue;
			result.push(suite);
			continue;
		}

		const fresh = byFile.get(suite.file) ?? [];
		const error = run.errors.get(suite.file) ?? null;
		// A scoped rerun updates its targets and leaves the rest of the file
		// standing; a full run replaces the file outright.
		const cases =
			run.scope.kind === "all" ? fresh : mergeCases(suite.cases, fresh);
		result.push(makeSuite(suite.file, cases, error));
	}

	// Files this run discovered that the previous tree never had.
	for (const [file, cases] of byFile) {
		if (seen.has(file)) continue;
		result.push(makeSuite(file, cases, run.errors.get(file) ?? null));
	}
	for (const [file, message] of run.errors) {
		if (seen.has(file) || byFile.has(file)) continue;
		result.push(makeSuite(file, [], message));
	}

	return result;
}

/** Fresh results win; untouched ones keep their previous outcome. */
function mergeCases(previous: TestCase[], fresh: TestCase[]): TestCase[] {
	const byId = new Map(previous.map((entry) => [entry.id, entry]));
	for (const entry of fresh) byId.set(entry.id, entry);
	return [...byId.values()];
}

function makeSuite(
	file: string,
	cases: TestCase[],
	error: string | null,
): TestSuite {
	return {
		file,
		cases,
		error,
		status: error ? "fail" : aggregateStatus(cases),
		durationMs: cases.reduce(
			(total, entry) => total + (entry.durationMs ?? 0),
			0,
		),
	};
}

/**
 * The files still working: covered by the run, present in the tree, and not
 * heard from yet. This is the only live signal available, since no runner
 * announces a test before it finishes.
 */
export function pendingFiles(
	tree: TestSuite[],
	run: RunProgress | null,
): Set<string> {
	const pending = new Set<string>();
	if (!run) return pending;
	for (const suite of tree) {
		if (!run.files.has(suite.file) && coversFile(run.scope, suite.file)) {
			pending.add(suite.file);
		}
	}
	return pending;
}
