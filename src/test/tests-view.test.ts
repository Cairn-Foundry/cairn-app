import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceTestState } from "$lib/stores/tests";
import type { TestCase, TestSuite } from "$lib/types/tests";

const testsState = writable<Record<string, InstanceTestState>>({});
const loadTests = vi.fn(async (..._a: unknown[]) => {});
const runTests = vi.fn(async (..._a: unknown[]) => {});
const stopTests = vi.fn(async (..._a: unknown[]) => {});
const selectCase = vi.fn((..._a: unknown[]) => undefined);
const selectRunner = vi.fn((..._a: unknown[]) => undefined);
const setFilter = vi.fn((..._a: unknown[]) => undefined);
const setSearch = vi.fn((..._a: unknown[]) => undefined);
vi.mock("$lib/stores/tests", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	tests: { subscribe: testsState.subscribe },
	loadTests: (...a: unknown[]) => loadTests(...a),
	runTests: (...a: unknown[]) => runTests(...a),
	stopTests: (...a: unknown[]) => stopTests(...a),
	selectCase: (...a: unknown[]) => selectCase(...a),
	selectRunner: (...a: unknown[]) => selectRunner(...a),
	setFilter: (...a: unknown[]) => setFilter(...a),
	setSearch: (...a: unknown[]) => setSearch(...a),
}));

const requestAgentDraft = vi.fn((..._a: unknown[]) => undefined);
vi.mock("$lib/stores/agent-draft", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestAgentDraft: (...a: unknown[]) => requestAgentDraft(...a),
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const { activeProjectId } = await import("$lib/stores/project");
const { activeStep } = await import("$lib/stores/ui");
const { default: TestsView } = await import(
	"$lib/components/tests/TestsView.svelte"
);

function testCase(overrides: Partial<TestCase> = {}): TestCase {
	return {
		id: "src/a.test.ts::adds",
		name: "adds",
		ancestors: [],
		file: "src/a.test.ts",
		line: 3,
		status: "pass",
		durationMs: 12,
		failure: null,
		...overrides,
	};
}

function suite(overrides: Partial<TestSuite> = {}): TestSuite {
	return {
		file: "src/a.test.ts",
		status: "pass",
		durationMs: 20,
		cases: [testCase()],
		error: null,
		...overrides,
	};
}

const RUNNER = {
	id: "vitest" as const,
	label: "Vitest",
	command: "bun run test",
	subdir: "",
	detectedFrom: "package.json",
};

function state(overrides: Partial<InstanceTestState> = {}): InstanceTestState {
	return {
		runners: [RUNNER],
		selectedRunnerId: "vitest",
		detecting: false,
		suites: [suite()],
		summary: null,
		activeRunId: "",
		selectedCaseId: "",
		filter: "all",
		search: "",
		pending: [],
		rawOutput: [],
		error: "",
		...overrides,
	};
}

function setState(overrides: Partial<InstanceTestState> = {}) {
	testsState.set({ "p1:i1": state(overrides) });
}

function mount() {
	const onOpenFile = vi.fn((..._a: unknown[]) => undefined);
	render(TestsView, {
		props: {},
		events: { openFile: (e: CustomEvent) => onOpenFile(e.detail) },
	});
	return { onOpenFile };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".test-row"));
const rowNames = () =>
	rows().map((r) => r.querySelector(".name")?.textContent?.trim());
const groupHeads = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".group-head"));
const chips = () => Array.from(document.querySelectorAll<HTMLElement>(".chip"));
const kpis = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".kpi")).map(
		(k) => k.querySelector(".k-num")?.textContent,
	);
const searchField = () =>
	document.querySelector(".list-search input") as HTMLInputElement;
const runButton = () =>
	document.querySelector(".btn.primary") as HTMLButtonElement;
const stopButton = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".btn")).find((b) =>
		/stop|arr/i.test(b.textContent ?? ""),
	);
const frames = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".frame"));
const detail = () => document.querySelector(".test-output")?.textContent ?? "";
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".btn")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;

async function settle() {
	await tick();
	await tick();
}

beforeEach(() => {
	loadTests.mockClear();
	runTests.mockClear();
	stopTests.mockClear();
	selectCase.mockClear();
	selectRunner.mockClear();
	setFilter.mockClear();
	setSearch.mockClear();
	requestAgentDraft.mockClear();
	activeProjectId.set("p1");
	activeInstance.set({ id: "i1", worktreePath: "/wt" });
	activeStep.set("tests");
	setState();
});

describe("TestsView", () => {
	describe("detecting the runner", () => {
		it("detects the runner of the open worktree", async () => {
			mount();
			await settle();
			expect(loadTests).toHaveBeenCalledWith("p1", "i1", "/wt");
		});

		/** Detection is per worktree, and must not run again on every render. */
		it("detects it once for the same worktree", async () => {
			mount();
			await settle();
			activeInstance.set({ id: "i1", worktreePath: "/wt" });
			await settle();
			expect(loadTests).toHaveBeenCalledTimes(1);
		});

		it("detects again when the worktree changes", async () => {
			mount();
			await settle();
			activeInstance.set({ id: "i2", worktreePath: "/other" });
			await settle();
			expect(loadTests).toHaveBeenCalledTimes(2);
		});

		it("detects nothing with no instance", async () => {
			activeInstance.set(null);
			mount();
			await settle();
			expect(loadTests).not.toHaveBeenCalled();
		});

		it("says so when the worktree has no runner", () => {
			setState({ runners: [], suites: [] });
			mount();
			expect(document.querySelector(".empty-state")).not.toBeNull();
			expect(runButton().disabled).toBe(true);
		});

		it("shows the runner's own failure", () => {
			setState({ error: "vitest exited 127", suites: [] });
			mount();
			expect(detail()).toContain("vitest exited 127");
		});
	});

	describe("the tree", () => {
		it("lists every case of every suite", () => {
			setState({
				suites: [
					suite({
						file: "a.test.ts",
						cases: [testCase({ id: "1", name: "one" })],
					}),
					suite({
						file: "b.test.ts",
						cases: [testCase({ id: "2", name: "two" })],
					}),
				],
			});
			mount();
			expect(rowNames()).toEqual(["one", "two"]);
		});

		it("names the suite by its file, not its path", () => {
			setState({ suites: [suite({ file: "src/deep/a.test.ts" })] });
			mount();
			expect(groupHeads()[0].querySelector(".file-name")?.textContent).toBe(
				"a.test.ts",
			);
		});

		it("folds a suite away when its heading is used", async () => {
			mount();
			await userEvent.click(groupHeads()[0]);
			expect(rows()).toHaveLength(0);
		});

		it("unfolds it again", async () => {
			mount();
			await userEvent.click(groupHeads()[0]);
			await userEvent.click(groupHeads()[0]);
			expect(rows()).toHaveLength(1);
		});

		it("folds every suite at once", async () => {
			setState({
				suites: [
					suite({ file: "a.test.ts" }),
					suite({ file: "b.test.ts", cases: [testCase({ id: "2" })] }),
				],
			});
			mount();
			await userEvent.click(
				document.querySelector(".collapse-toggle") as HTMLElement,
			);
			expect(rows()).toHaveLength(0);
		});

		/** Once everything is folded the same button unfolds it. */
		it("unfolds every suite with the same control", async () => {
			mount();
			const toggle = () =>
				document.querySelector(".collapse-toggle") as HTMLElement;
			await userEvent.click(toggle());
			await userEvent.click(toggle());
			expect(rows()).toHaveLength(1);
		});

		it("shows a suite's collect error", () => {
			setState({ suites: [suite({ error: "cannot import x" })] });
			mount();
			expect(document.querySelector(".suite-error")?.textContent).toContain(
				"cannot import x",
			);
		});

		/** A file the run has not reported yet is still working. */
		it("marks a file the run has not reported yet", () => {
			setState({ activeRunId: "r1", pending: ["src/a.test.ts"] });
			mount();
			expect(groupHeads()[0].querySelector(".working")).not.toBeNull();
		});

		it("leaves a reported file unmarked", () => {
			setState({ activeRunId: "r1", pending: [] });
			mount();
			expect(document.querySelector(".working")).toBeNull();
		});
	});

	describe("searching and filtering", () => {
		it("hands the search to the store", async () => {
			mount();
			await userEvent.type(searchField(), "add");
			expect(setSearch).toHaveBeenCalledWith("p1", "i1", "a");
		});

		it("clears the search on Escape", async () => {
			setState({ search: "add" });
			mount();
			searchField().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(setSearch).toHaveBeenCalledWith("p1", "i1", "");
		});

		it("clears the search with the clear button", async () => {
			setState({ search: "add" });
			mount();
			await userEvent.click(
				document.querySelector(".list-search-clear") as HTMLElement,
			);
			expect(setSearch).toHaveBeenCalledWith("p1", "i1", "");
		});

		it("offers no clear button with no search", () => {
			mount();
			expect(document.querySelector(".list-search-clear")).toBeNull();
		});

		it("keeps only the cases the search matched", () => {
			setState({
				search: "two",
				suites: [
					suite({
						cases: [
							testCase({ id: "1", name: "one" }),
							testCase({ id: "2", name: "two" }),
						],
					}),
				],
			});
			mount();
			expect(rowNames()).toEqual(["two"]);
		});

		/** A folded suite cannot hide a search hit. */
		it("reveals a folded suite that matched", async () => {
			setState({
				suites: [suite({ cases: [testCase({ id: "1", name: "one" })] })],
			});
			mount();
			await userEvent.click(groupHeads()[0]);
			expect(rows()).toHaveLength(0);
			setState({
				search: "one",
				suites: [suite({ cases: [testCase({ id: "1", name: "one" })] })],
			});
			await settle();
			expect(rows()).toHaveLength(1);
		});

		it("highlights what the search matched", () => {
			setState({
				search: "one",
				suites: [suite({ cases: [testCase({ id: "1", name: "one two" })] })],
			});
			mount();
			expect(document.querySelector("mark")?.textContent).toBe("one");
		});

		it("counts the results while searching", () => {
			setState({ search: "adds" });
			mount();
			expect(document.querySelector(".result-count")).not.toBeNull();
		});

		it("counts nothing when not searching", () => {
			mount();
			expect(document.querySelector(".result-count")).toBeNull();
		});

		it("hands the chosen filter to the store", async () => {
			mount();
			await userEvent.click(chips()[1]);
			expect(setFilter).toHaveBeenCalledWith("p1", "i1", "failed");
		});

		/** Each chip says how many tests it would show. */
		it("counts what each filter would show", () => {
			setState({
				suites: [
					suite({
						cases: [
							testCase({ id: "1", status: "pass" }),
							testCase({ id: "2", status: "fail" }),
							testCase({ id: "3", status: "fail" }),
							testCase({ id: "4", status: "skip" }),
						],
					}),
				],
			});
			mount();
			expect(
				chips().map((c) => c.querySelector(".chip-count")?.textContent),
			).toEqual(["4", "2", "1", "1"]);
		});

		it("offers a way back when nothing matched", async () => {
			setState({ search: "nothing-matches-this" });
			mount();
			await userEvent.click(
				document.querySelector(".list-empty button") as HTMLElement,
			);
			expect(setSearch).toHaveBeenCalledWith("p1", "i1", "");
			expect(setFilter).toHaveBeenCalledWith("p1", "i1", "all");
		});
	});

	describe("the counters", () => {
		it("counts the passing, failing and skipped tests apart", () => {
			setState({
				suites: [
					suite({
						cases: [
							testCase({ id: "1", status: "pass" }),
							testCase({ id: "2", status: "fail" }),
							testCase({ id: "3", status: "skip" }),
							testCase({ id: "4", status: "todo" }),
						],
					}),
				],
			});
			mount();
			expect(kpis().slice(0, 3)).toEqual(["1", "1", "2"]);
		});

		it("shows a dash for a duration nothing reported", () => {
			mount();
			expect(kpis()[3]).toBe("-");
		});

		it("shows a sub-second duration in milliseconds", () => {
			setState({
				summary: { durationMs: 420 } as InstanceTestState["summary"],
			});
			mount();
			expect(kpis()[3]).toBe("420ms");
		});

		it("shows a longer duration in seconds", () => {
			setState({
				summary: { durationMs: 4200 } as InstanceTestState["summary"],
			});
			mount();
			expect(kpis()[3]).toBe("4.20s");
		});
	});

	describe("running", () => {
		it("runs the whole suite", async () => {
			mount();
			await userEvent.click(runButton());
			expect(runTests).toHaveBeenCalledWith("p1", "i1", "/wt");
		});

		it("offers to stop while a run is in flight", async () => {
			setState({ activeRunId: "r1" });
			mount();
			expect(runButton()).toBeNull();
			await userEvent.click(stopButton() as HTMLElement);
			expect(stopTests).toHaveBeenCalledWith("p1", "i1");
		});

		it("re-runs a single file from its heading", async () => {
			setState({ selectedCaseId: "" });
			mount();
			await userEvent.click(document.querySelector(".run-file") as HTMLElement);
			expect(runTests).toHaveBeenCalledWith("p1", "i1", "/wt", {
				kind: "file",
				file: "src/a.test.ts",
			});
		});

		/** Only the runners that can be told to run one file offer it. */
		it("offers no file re-run for a runner that cannot scope one", () => {
			setState({
				runners: [{ ...RUNNER, id: "cargo", label: "cargo" }],
				selectedRunnerId: "cargo",
			});
			mount();
			expect(document.querySelector(".run-file")).toBeNull();
		});

		it("re-runs only the selected test", async () => {
			setState({ selectedCaseId: "src/a.test.ts::adds" });
			mount();
			await userEvent.click(buttonBy(/re-run this test/i));
			expect(runTests).toHaveBeenCalledWith("p1", "i1", "/wt", {
				kind: "case",
				file: "src/a.test.ts",
				name: "adds",
			});
		});

		it("switches the runner on request", async () => {
			setState({
				runners: [RUNNER, { ...RUNNER, id: "jest", label: "Jest" }],
			});
			mount();
			await userEvent.selectOptions(
				document.querySelector(".runner-select") as HTMLSelectElement,
				"jest",
			);
			expect(selectRunner).toHaveBeenCalledWith("p1", "i1", "jest");
		});

		it("offers no runner choice when there is only one", () => {
			mount();
			expect(document.querySelector(".runner-select")).toBeNull();
		});
	});

	describe("the selected test", () => {
		const failing = testCase({
			id: "src/a.test.ts::adds",
			status: "fail",
			failure: {
				message: "expected 1 to be 2",
				expected: "2",
				received: "1",
				stack: [
					{ file: "src/a.test.ts", line: 3, column: 5, inProject: true },
					{ file: "node_modules/x.js", line: 9, column: 1, inProject: false },
				],
				location: { file: "src/a.test.ts", line: 3, column: 5 },
			},
		});

		it("selects the test that was clicked", async () => {
			mount();
			await userEvent.click(rows()[0]);
			expect(selectCase).toHaveBeenCalledWith(
				"p1",
				"i1",
				"src/a.test.ts::adds",
			);
		});

		it("asks for a selection while there is none", () => {
			mount();
			expect(document.querySelector(".empty-state")).not.toBeNull();
		});

		it("shows the failure of the selected test", () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			mount();
			expect(detail()).toContain("expected 1 to be 2");
			expect(detail()).toContain("Expected:");
		});

		it("omits the expected line when the runner gave neither value", () => {
			setState({
				suites: [
					suite({
						cases: [
							{
								...failing,
								failure: {
									...failing.failure!,
									expected: null,
									received: null,
								},
							},
						],
					}),
				],
				selectedCaseId: failing.id,
			});
			mount();
			expect(detail()).not.toContain("Expected:");
		});

		/** Frames outside the project are noise until asked for. */
		it("shows only the project's own frames", () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			mount();
			expect(frames()).toHaveLength(1);
			expect(frames()[0].textContent).toContain("src/a.test.ts");
		});

		it("shows the other frames on request", async () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			mount();
			await userEvent.click(document.querySelector(".more") as HTMLElement);
			expect(frames()).toHaveLength(2);
		});

		it("offers no such request when every frame is the project's", () => {
			setState({
				suites: [
					suite({
						cases: [
							{
								...failing,
								failure: {
									...failing.failure!,
									stack: [failing.failure!.stack[0]],
								},
							},
						],
					}),
				],
				selectedCaseId: failing.id,
			});
			mount();
			expect(document.querySelector(".more")).toBeNull();
		});

		it("opens the file at the failing line", async () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			const { onOpenFile } = mount();
			await userEvent.click(
				document.querySelector(".test-file") as HTMLElement,
			);
			expect(onOpenFile).toHaveBeenCalledWith({
				path: "/wt/src/a.test.ts",
				line: 3,
			});
		});

		/** An absolute path from the runner is already resolved. */
		it("opens an absolute path as it stands", async () => {
			const absolute = { ...failing, file: "/elsewhere/a.test.ts" };
			setState({
				suites: [suite({ cases: [absolute] })],
				selectedCaseId: absolute.id,
			});
			const { onOpenFile } = mount();
			await userEvent.click(
				document.querySelector(".test-file") as HTMLElement,
			);
			expect(onOpenFile).toHaveBeenCalledWith({
				path: "/elsewhere/a.test.ts",
				line: 3,
			});
		});

		it("opens the file a stack frame points at", async () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			const { onOpenFile } = mount();
			await userEvent.click(frames()[0]);
			expect(onOpenFile).toHaveBeenCalledWith({
				path: "/wt/src/a.test.ts",
				line: 3,
			});
		});

		it("reports how long a passing test took", () => {
			setState({ selectedCaseId: "src/a.test.ts::adds" });
			mount();
			expect(detail()).toContain("12ms");
		});
	});

	describe("handing a failure to the agent", () => {
		const failing = testCase({
			id: "src/a.test.ts::adds",
			status: "fail",
			failure: {
				message: "boom",
				expected: null,
				received: null,
				stack: [],
				location: null,
			},
		});

		it("drafts a prompt about the failure and opens the agent", async () => {
			setState({
				suites: [suite({ cases: [failing] })],
				selectedCaseId: failing.id,
			});
			mount();
			await userEvent.click(document.querySelector(".ai-btn") as HTMLElement);
			expect(requestAgentDraft).toHaveBeenCalledTimes(1);
			expect(requestAgentDraft.mock.calls[0][0]).toBe("i1");
			expect(requestAgentDraft.mock.calls[0][1]).toContain("adds");
			expect(get(activeStep)).toBe("agent");
		});

		/** Nothing to fix about a test that passed. */
		it("offers nothing for a passing test", () => {
			setState({ selectedCaseId: "src/a.test.ts::adds" });
			mount();
			expect(document.querySelector(".ai-btn")).toBeNull();
		});
	});
});
