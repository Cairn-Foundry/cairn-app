// Folding streamed cases into the suite tree. Pure, so the reducer can be
// tested without a runner or a Tauri event in sight.
import type {
	TestCase,
	TestRunSummary,
	TestStatus,
	TestSuite,
} from "$lib/types/tests";

/** A suite is red if anything failed, running while a case still runs, green otherwise. */
export function aggregateStatus(cases: TestCase[]): TestStatus {
	if (cases.length === 0) return "pending";
	if (cases.some((entry) => entry.status === "fail")) return "fail";
	if (cases.some((entry) => entry.status === "running")) return "running";
	if (
		cases.every((entry) => entry.status === "skip" || entry.status === "todo")
	) {
		return "skip";
	}
	return "pass";
}

/** The counters shown above the tree, recomputed from the tree itself. */
export function countCases(suites: TestSuite[]): TestRunSummary["counts"] {
	const counts = { pass: 0, fail: 0, skip: 0, todo: 0, total: 0 };
	for (const suite of suites) {
		for (const entry of suite.cases) {
			counts.total += 1;
			if (entry.status === "pass") counts.pass += 1;
			else if (entry.status === "fail") counts.fail += 1;
			else if (entry.status === "skip") counts.skip += 1;
			else if (entry.status === "todo") counts.todo += 1;
		}
	}
	return counts;
}

/**
 * How a finished run reads. A failing case outranks the exit code: a runner can
 * exit non-zero for its own reasons, and the tree is what the user is looking
 * at.
 */
export function resolveRunStatus(
	counts: TestRunSummary["counts"],
	exitCode: number | null,
	cancelled: boolean,
	suiteCount: number,
): TestRunSummary["status"] {
	if (cancelled) return "cancelled";
	if (counts.fail > 0) return "failed";
	if (exitCode === 0) return "passed";
	if (suiteCount === 0) return "error";
	return "failed";
}
