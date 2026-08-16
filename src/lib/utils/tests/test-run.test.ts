import { describe, expect, it } from "vitest";
import type { TestCase, TestStatus, TestSuite } from "$lib/types/tests";
import {
	buildTree,
	isObserved,
	observeCase,
	observeSuiteError,
	pendingFiles,
	startRun,
} from "./test-run";
import type { RunScope } from "./test-scope";

function makeCase(
	file: string,
	name: string,
	status: TestStatus = "pass",
	durationMs: number | null = null,
): TestCase {
	return {
		id: `${file}::::${name}`,
		name,
		ancestors: [],
		file,
		line: null,
		status,
		durationMs,
		failure: null,
	};
}

function makeSuite(
	file: string,
	cases: TestCase[],
	error: string | null = null,
): TestSuite {
	return { file, cases, error, status: "pass", durationMs: null };
}

/** The tree as it stands after a previous full run: two files, five tests. */
const PREVIOUS: TestSuite[] = [
	makeSuite("cart.test.js", [
		makeCase("cart.test.js", "sums"),
		makeCase("cart.test.js", "rounds", "fail"),
		makeCase("cart.test.js", "clamps"),
	]),
	makeSuite("totp.test.js", [
		makeCase("totp.test.js", "generates"),
		makeCase("totp.test.js", "verifies"),
	]),
];

function namesOf(tree: TestSuite[], file: string): string[] {
	return (tree.find((suite) => suite.file === file)?.cases ?? [])
		.map((entry) => entry.name)
		.sort();
}

describe("a full run", () => {
	const scope: RunScope = { kind: "all" };

	it("keeps the previous tree until a file reports", () => {
		const run = startRun(scope);
		const tree = buildTree(PREVIOUS, run);
		expect(namesOf(tree, "cart.test.js")).toEqual(["clamps", "rounds", "sums"]);
		expect(namesOf(tree, "totp.test.js")).toEqual(["generates", "verifies"]);
	});

	it("replaces a file wholesale once it reports", () => {
		const run = observeCase(startRun(scope), makeCase("cart.test.js", "sums"));
		const tree = buildTree(PREVIOUS, run);
		// A test deleted since the last run must not survive.
		expect(namesOf(tree, "cart.test.js")).toEqual(["sums"]);
		// The file that has not reported yet is untouched.
		expect(namesOf(tree, "totp.test.js")).toEqual(["generates", "verifies"]);
	});

	it("drops a file that never reported, but only once the run ends", () => {
		const run = observeCase(startRun(scope), makeCase("cart.test.js", "sums"));
		expect(buildTree(PREVIOUS, run, false)).toHaveLength(2);
		expect(buildTree(PREVIOUS, run, true).map((s) => s.file)).toEqual([
			"cart.test.js",
		]);
	});

	it("adds a file the previous tree never had", () => {
		const run = observeCase(startRun(scope), makeCase("new.test.js", "fresh"));
		expect(namesOf(buildTree(PREVIOUS, run), "new.test.js")).toEqual(["fresh"]);
	});

	it("marks the files it has not reached as pending", () => {
		const run = observeCase(startRun(scope), makeCase("cart.test.js", "sums"));
		expect(pendingFiles(buildTree(PREVIOUS, run), run)).toEqual(
			new Set(["totp.test.js"]),
		);
	});
});

describe("a single-test rerun", () => {
	const scope: RunScope = {
		kind: "case",
		file: "cart.test.js",
		name: "rounds",
	};

	it("updates its target and keeps every sibling", () => {
		const run = observeCase(
			startRun(scope),
			makeCase("cart.test.js", "rounds", "pass"),
		);
		const tree = buildTree(PREVIOUS, run);

		expect(namesOf(tree, "cart.test.js")).toEqual(["clamps", "rounds", "sums"]);
		const rounds = tree[0].cases.find((entry) => entry.name === "rounds");
		expect(rounds?.status).toBe("pass");
	});

	it("ignores the skipped bystanders the runner reports", () => {
		let run = startRun(scope);
		run = observeCase(run, makeCase("cart.test.js", "rounds", "pass"));
		// The runner loaded the file and stepped over the others.
		run = observeCase(run, makeCase("cart.test.js", "sums", "skip"));

		const tree = buildTree(PREVIOUS, run);
		expect(tree[0].cases.find((entry) => entry.name === "sums")?.status).toBe(
			"pass",
		);
	});

	it("leaves the other files alone, even at the end of the run", () => {
		const run = observeCase(
			startRun(scope),
			makeCase("cart.test.js", "rounds"),
		);
		const tree = buildTree(PREVIOUS, run, true);
		expect(namesOf(tree, "totp.test.js")).toEqual(["generates", "verifies"]);
	});

	it("marks only its own file as pending, and only until it reports", () => {
		const run = startRun(scope);
		expect(pendingFiles(buildTree(PREVIOUS, run), run)).toEqual(
			new Set(["cart.test.js"]),
		);
		observeCase(run, makeCase("cart.test.js", "rounds"));
		expect(pendingFiles(buildTree(PREVIOUS, run), run).size).toBe(0);
	});
});

describe("a file rerun", () => {
	const scope: RunScope = { kind: "file", file: "cart.test.js" };

	it("keeps tests of that file the run did not report", () => {
		const run = observeCase(
			startRun(scope),
			makeCase("cart.test.js", "sums", "fail"),
		);
		const tree = buildTree(PREVIOUS, run);
		expect(namesOf(tree, "cart.test.js")).toEqual(["clamps", "rounds", "sums"]);
		expect(tree[0].cases.find((e) => e.name === "sums")?.status).toBe("fail");
	});

	it("never touches another file", () => {
		const run = observeCase(startRun(scope), makeCase("cart.test.js", "sums"));
		expect(namesOf(buildTree(PREVIOUS, run, true), "totp.test.js")).toEqual([
			"generates",
			"verifies",
		]);
	});

	it("keeps a skipped test of the file it targets", () => {
		// Inside the scope, a skip is a genuine result.
		const run = observeCase(
			startRun(scope),
			makeCase("cart.test.js", "sums", "skip"),
		);
		expect(
			buildTree(PREVIOUS, run)[0].cases.find((e) => e.name === "sums")?.status,
		).toBe("skip");
	});
});

describe("suite load failures", () => {
	it("records a file that could not be loaded", () => {
		const run = observeSuiteError(
			startRun({ kind: "all" }),
			"broken.test.js",
			"Cannot find module",
		);
		const tree = buildTree(PREVIOUS, run);
		const broken = tree.find((suite) => suite.file === "broken.test.js");
		expect(broken?.error).toBe("Cannot find module");
		expect(broken?.status).toBe("fail");
	});

	it("clears a previous error when the file loads again", () => {
		const withError = [makeSuite("cart.test.js", [], "boom")];
		const run = observeCase(
			startRun({ kind: "all" }),
			makeCase("cart.test.js", "sums"),
		);
		expect(buildTree(withError, run)[0].error).toBeNull();
	});
});

describe("isObserved", () => {
	it("keeps every result of a full run", () => {
		const scope: RunScope = { kind: "all" };
		expect(isObserved(makeCase("a.js", "x", "skip"), scope)).toBe(true);
	});

	it("keeps a real result whatever the scope", () => {
		const scope: RunScope = { kind: "case", file: "a.js", name: "target" };
		expect(isObserved(makeCase("a.js", "other", "pass"), scope)).toBe(true);
		expect(isObserved(makeCase("a.js", "other", "fail"), scope)).toBe(true);
	});

	it("drops a skipped bystander of a scoped run", () => {
		const scope: RunScope = { kind: "case", file: "a.js", name: "target" };
		expect(isObserved(makeCase("a.js", "other", "skip"), scope)).toBe(false);
		expect(isObserved(makeCase("a.js", "target", "skip"), scope)).toBe(true);
	});

	it("drops a skipped test of another file during a file run", () => {
		const scope: RunScope = { kind: "file", file: "a.js" };
		expect(isObserved(makeCase("b.js", "x", "skip"), scope)).toBe(false);
		expect(isObserved(makeCase("a.js", "x", "skip"), scope)).toBe(true);
	});
});

describe("the tree it produces", () => {
	it("derives a suite status from its cases", () => {
		let run = startRun({ kind: "all" });
		run = observeCase(run, makeCase("a.js", "ok", "pass"));
		run = observeCase(run, makeCase("a.js", "ko", "fail"));
		expect(buildTree([], run)[0].status).toBe("fail");
	});

	it("sums the durations of a file", () => {
		let run = startRun({ kind: "all" });
		run = observeCase(run, makeCase("a.js", "one", "pass", 10));
		run = observeCase(run, makeCase("a.js", "two", "pass", 32));
		expect(buildTree([], run)[0].durationMs).toBe(42);
	});

	it("does not mutate the previous tree", () => {
		const run = observeCase(
			startRun({ kind: "all" }),
			makeCase("cart.test.js", "sums"),
		);
		buildTree(PREVIOUS, run, true);
		expect(PREVIOUS[0].cases).toHaveLength(3);
		expect(PREVIOUS).toHaveLength(2);
	});

	it("lets a later result replace an earlier one for the same test", () => {
		let run = startRun({ kind: "all" });
		run = observeCase(run, makeCase("a.js", "x", "pass"));
		run = observeCase(run, makeCase("a.js", "x", "fail"));
		const tree = buildTree([], run);
		expect(tree[0].cases).toHaveLength(1);
		expect(tree[0].cases[0].status).toBe("fail");
	});
});
