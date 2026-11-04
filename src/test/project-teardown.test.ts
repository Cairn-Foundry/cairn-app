// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Removing a project must leave nothing of it behind in memory, and - because
 * `write_json_atomic` recreates missing parent directories - must cancel every
 * queued write before the backend deletes the project directory. A timer that
 * survives writes the directory back moments after it was removed.
 */
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeProject = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/project-service", () => ({
	listProjects: vi.fn(),
	addProject: vi.fn(),
	removeProject,
	updateProject: vi.fn(),
	duplicateProject: vi.fn(),
	saveProjectOrder: vi.fn(),
	setActiveInstance: vi.fn(),
	getListing: vi.fn(),
}));

vi.mock("#lib/stores/project-folders", () => ({
	projectFolders: { purgeProject: vi.fn(), init: vi.fn() },
}));

const closeTerminal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getTerminalState = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const getProjectTerminalState = vi.hoisted(() =>
	vi.fn().mockResolvedValue(null),
);
vi.mock("#lib/services/terminal-service", async (importOriginal) => ({
	...(await importOriginal<object>()),
	closeTerminal,
	getTerminalState,
	getProjectTerminalState,
	closeAllTerminals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#lib/services/formatting-service", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getProjectFormatting: vi.fn().mockResolvedValue({}),
}));

const dispose = vi.hoisted(() => vi.fn());
vi.mock("#lib/utils/terminal/terminal-manager", async (importOriginal) => ({
	...(await importOriginal<object>()),
	dispose,
}));

const { unregisterProject } = await import("#lib/stores/project");
const { projects } = await import("#lib/stores/project");
const { projectCommands } = await import("#lib/stores/custom-command");
const { projectEnvs, instanceEnvs, envFileConflicts } = await import(
	"#lib/stores/env"
);
const { commandRuns } = await import("#lib/stores/command-run");
const { instanceConversations, projectConversations, activeConversationId } =
	await import("#lib/stores/conversation");
const {
	terminalSessions,
	projectTerminals,
	activeTerminalId,
	splitTerminalId,
	splitTerminalRatio,
	restoreTerminals,
	restoreProjectTerminals,
} = await import("#lib/stores/terminal");
const { projectInbox } = await import("#lib/stores/project-inbox");
const { viewStates } = await import("#lib/stores/view-state");
const { applyUpdate, pipelines } = await import("#lib/stores/pipelines");
const { formatting } = await import("#lib/stores/formatting");
const { integrationKey } = await import("#lib/utils/integrations/instance-key");

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

	it("forgets the split pane and its ratio of the removed project", async () => {
		seed(splitTerminalId, "t1", ":i1");
		seed(splitTerminalRatio, 0.4, ":i1");

		await unregisterProject(DOOMED);

		const remainingKeys = [`${KEPT}:i1`, `${LOOKALIKE}:i1`].sort();
		expect(keysOf(splitTerminalId)).toEqual(remainingKeys);
		expect(keysOf(splitTerminalRatio)).toEqual(remainingKeys);
	});

	it("lets the instance terminals of a re-added project be restored again", async () => {
		await restoreTerminals("p1-readd", "i1", null);
		await unregisterProject("p1-readd");
		getTerminalState.mockClear();

		await restoreTerminals("p1-readd", "i1", null);

		expect(getTerminalState).toHaveBeenCalledTimes(1);
	});

	it("lets the shared terminals of a re-added project be restored again", async () => {
		await restoreProjectTerminals("p1-readd");
		await unregisterProject("p1-readd");
		getProjectTerminalState.mockClear();

		await restoreProjectTerminals("p1-readd");

		expect(getProjectTerminalState).toHaveBeenCalledTimes(1);
	});

	it("forgets the view state of the removed project", async () => {
		const { initViewStates } = await import("#lib/stores/view-state");
		initViewStates({
			[DOOMED]: { activeStep: "git" } as never,
			[KEPT]: { activeStep: "git" } as never,
		});

		await unregisterProject(DOOMED);

		expect(keysOf(viewStates)).toEqual([KEPT]);
	});

	it("forgets the pipelines of the removed project", async () => {
		for (const id of [DOOMED, KEPT, LOOKALIKE])
			applyUpdate(integrationKey(id, "i1"), { id: "1" } as never);

		await unregisterProject(DOOMED);

		expect(Object.keys(get(pipelines)).sort()).toEqual(
			[integrationKey(KEPT, "i1"), integrationKey(LOOKALIKE, "i1")].sort(),
		);
	});

	it("forgets the formatting config of the removed project", async () => {
		await formatting.loadProject(DOOMED);
		await formatting.loadProject(KEPT);

		await unregisterProject(DOOMED);

		expect(keysOf(formatting.projects)).toEqual([KEPT]);
	});
});
