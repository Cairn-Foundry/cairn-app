/**
 * Removing a project must leave nothing of it behind in memory, and - because
 * `write_json_atomic` recreates missing parent directories - must cancel every
 * queued write before the backend deletes the project directory. A timer that
 * survives writes the directory back moments after it was removed.
 */
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const closeTerminal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("$lib/services/terminal-service", async (importOriginal) => ({
	...(await importOriginal<object>()),
	closeTerminal,
	closeAllTerminals: vi.fn().mockResolvedValue(undefined),
}));

const dispose = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/terminal/terminal-manager", async (importOriginal) => ({
	...(await importOriginal<object>()),
	dispose,
}));

const saveAgentActivity = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/agent-activity-service", () => ({
	getAgentActivity: vi.fn().mockResolvedValue({}),
	saveAgentActivity,
}));

const { unregisterProject } = await import("$lib/stores/project");
const { projects } = await import("$lib/stores/project");
const { agentRuns, agentPermissionRequests } = await import(
	"$lib/stores/agent-runs"
);
const { agentBusyConversations, agentDoneConversation } = await import(
	"$lib/stores/agent-activity"
);
const { projectCommands } = await import("$lib/stores/custom-command");
const { projectEnvs, instanceEnvs, envFileConflicts } = await import(
	"$lib/stores/env"
);
const { commandRuns } = await import("$lib/stores/command-run");
const { instanceConversations, projectConversations, activeConversationId } =
	await import("$lib/stores/conversation");
const { terminalSessions, projectTerminals, activeTerminalId } = await import(
	"$lib/stores/terminal"
);
const { projectInbox } = await import("$lib/stores/project-inbox");
const { viewStates } = await import("$lib/stores/view-state");

const DOOMED = "p1";
const KEPT = "p2";
// Shares the doomed project's id as a prefix; a naive startsWith would drop it.
const LOOKALIKE = "p10";

/** Fills one record store with an entry for each project, under `keySuffix`. */
function seed<T>(
	store: { set: (v: Record<string, T>) => void },
	value: T,
	keySuffix = "",
): void {
	store.set({
		[`${DOOMED}${keySuffix}`]: value,
		[`${KEPT}${keySuffix}`]: value,
		[`${LOOKALIKE}${keySuffix}`]: value,
	});
}

const keysOf = (store: { subscribe: unknown }) =>
	Object.keys(get(store as Parameters<typeof get>[0]) as object).sort();

describe("unregisterProject tears down every per-project cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		removeProject.mockResolvedValue([]);
		projects.set([]);
	});

	it("drops the removed project from every store and keeps the others", async () => {
		seed(agentRuns, []);
		seed(agentBusyConversations, []);
		seed(agentDoneConversation, "c1");
		seed(projectCommands, []);
		seed(projectEnvs, { variables: [] } as never);
		seed(instanceEnvs, { variables: [] } as never, ":i1");
		seed(envFileConflicts, true, ":i1");
		commandRuns.set({
			[`${DOOMED}:i1:c1`]: { terminalId: "cr-doomed" } as never,
			[`${KEPT}:i1:c1`]: { terminalId: "cr-kept" } as never,
			[`${LOOKALIKE}:i1:c1`]: { terminalId: "cr-lookalike" } as never,
		});
		terminalSessions.set({
			[`${DOOMED}:i1`]: [{ id: "cr-doomed" }] as never,
			[`${KEPT}:i1`]: [{ id: "cr-kept" }] as never,
			[`${LOOKALIKE}:i1`]: [{ id: "cr-lookalike" }] as never,
		});
		seed(instanceConversations, [], ":i1");
		seed(projectConversations, []);
		seed(activeConversationId, "c1", ":i1");
		seed(projectInbox, { tickets: 1, hasMore: false });

		await unregisterProject(DOOMED);

		for (const [label, store] of [
			["agentRuns", agentRuns],
			["agentBusyConversations", agentBusyConversations],
			["agentDoneConversation", agentDoneConversation],
			["projectCommands", projectCommands],
			["projectEnvs", projectEnvs],
			["instanceEnvs", instanceEnvs],
			["envFileConflicts", envFileConflicts],
			["commandRuns", commandRuns],
			["instanceConversations", instanceConversations],
			["projectConversations", projectConversations],
			["activeConversationId", activeConversationId],
			["projectInbox", projectInbox],
		] as const) {
			const remaining = keysOf(store);
			expect(
				remaining.some((k) => k === DOOMED || k.startsWith(`${DOOMED}:`)),
				label,
			).toBe(false);
			expect(remaining.length, label).toBe(2);
		}
	});

	it("keeps a project whose id merely starts with the removed one", async () => {
		seed(projectCommands, []);
		await unregisterProject(DOOMED);
		expect(keysOf(projectCommands)).toEqual([KEPT, LOOKALIKE].sort());
	});

	it("closes the PTYs of the removed project, and only those", async () => {
		terminalSessions.set({
			[`${DOOMED}:i1`]: [{ id: "t-doomed" }] as never,
			[`${KEPT}:i1`]: [{ id: "t-kept" }] as never,
		});
		projectTerminals.set({
			[DOOMED]: [{ id: "t-shared" }] as never,
			[LOOKALIKE]: [{ id: "t-lookalike" }] as never,
		});
		activeTerminalId.set({ [`${DOOMED}:i1`]: "t-doomed" });

		await unregisterProject(DOOMED);

		const closed = closeTerminal.mock.calls.map(([id]) => id).sort();
		expect(closed).toEqual(["t-doomed", "t-shared"]);
		expect(dispose.mock.calls.map(([id]) => id).sort()).toEqual([
			"t-doomed",
			"t-shared",
		]);
		expect(keysOf(terminalSessions)).toEqual([`${KEPT}:i1`]);
		expect(keysOf(projectTerminals)).toEqual([LOOKALIKE]);
		expect(keysOf(activeTerminalId)).toEqual([]);
	});

	it("drops the permission requests raised by the removed project's runs", async () => {
		agentRuns.set({
			[DOOMED]: [{ id: "r-doomed" }] as never,
			[KEPT]: [{ id: "r-kept" }] as never,
		});
		agentPermissionRequests.set({
			"r-doomed": {} as never,
			"r-kept": {} as never,
		});

		await unregisterProject(DOOMED);

		expect(keysOf(agentPermissionRequests)).toEqual(["r-kept"]);
	});

	it("rewrites the persisted done markers without the removed project", async () => {
		agentDoneConversation.set({ [`${DOOMED}:i1`]: "c1", [`${KEPT}:i1`]: "c2" });

		await unregisterProject(DOOMED);

		expect(saveAgentActivity).toHaveBeenCalledWith({ [`${KEPT}:i1`]: "c2" });
	});

	it("leaves the persisted markers alone when the project had none", async () => {
		agentDoneConversation.set({ [`${KEPT}:i1`]: "c2" });

		await unregisterProject(DOOMED);

		expect(saveAgentActivity).not.toHaveBeenCalled();
	});

	it("forgets the view state of the removed project", async () => {
		const { initViewStates } = await import("$lib/stores/view-state");
		initViewStates({
			[DOOMED]: { activeStep: "git" } as never,
			[KEPT]: { activeStep: "git" } as never,
		});

		await unregisterProject(DOOMED);

		expect(keysOf(viewStates)).toEqual([KEPT]);
	});
});
