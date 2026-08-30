/**
 * The teardown must cancel the writes a removed project still has queued.
 *
 * `write_json_atomic` recreates missing parent directories, and `remove_project`
 * deletes the project directory, so a debounced write firing after the removal
 * writes that directory back - leaving a deleted project half-present on disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const removeProject = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/project-service", () => ({
	listProjects: vi.fn(),
	addProject: vi.fn(),
	removeProject,
	updateProject: vi.fn(),
	duplicateProject: vi.fn(),
	saveProjectOrder: vi.fn(),
	setActiveInstance: vi.fn(),
	getListing: vi.fn(),
}));

vi.mock("$lib/stores/project-folders", () => ({
	projectFolders: { purgeProject: vi.fn(), init: vi.fn() },
}));

const saveAgentRuns = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const saveProjectEnv = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("$lib/services/env-service", async (importOriginal) => ({
	...(await importOriginal<object>()),
	saveProjectEnv,
	saveGlobalEnv: vi.fn().mockResolvedValue(undefined),
	saveInstanceEnv: vi.fn().mockResolvedValue(undefined),
}));

const { unregisterProject, projects } = await import("$lib/stores/project");
const { addVariables, newVariable } = await import("$lib/stores/env");

const DOOMED = "p1";
const KEPT = "p2";

describe("queued writes of a removed project", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		removeProject.mockResolvedValue([]);
		projects.set([]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("never writes the environment of a project removed before the debounce fired", async () => {
		addVariables("project", DOOMED, null, [newVariable("A", "1")]);
		addVariables("project", KEPT, null, [newVariable("B", "2")]);

		await unregisterProject(DOOMED);
		await vi.runAllTimersAsync();

		const written = saveProjectEnv.mock.calls.map(([projectId]) => projectId);
		expect(written).not.toContain(DOOMED);
		expect(written).toContain(KEPT);
	});
});
