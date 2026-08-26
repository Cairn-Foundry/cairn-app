// The restore half of the per-project view state. A view that does not come
// back exactly as it was left reads as "the app forgot where I was", which is
// the symptom the four-layer rule in CLAUDE.md exists to prevent.

import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectUiState } from "$lib/services/ui-state-service";
import { activeProjectId } from "$lib/stores/project";
import {
	activeStep,
	commandsActive,
	envActive,
	formattingActive,
	gitLeftTab,
	openAgentId,
	referencesPanelOpen,
	referencesQuery,
	showTool,
	terminalActive,
} from "$lib/stores/ui";
import {
	applyProjectState,
	getAllProjectStates,
	initViewStates,
	snapshotCurrentProject,
	updateProjectViewState,
	viewStates,
} from "./view-state";

/** Every ui store the snapshot covers, read as one object. */
const liveState = () => ({
	activeStep: get(activeStep),
	gitLeftTab: get(gitLeftTab),
	terminalActive: get(terminalActive),
	commandsActive: get(commandsActive),
	envActive: get(envActive),
	formattingActive: get(formattingActive),
	openAgentId: get(openAgentId),
	referencesPanelOpen: get(referencesPanelOpen),
	referencesQuery: get(referencesQuery),
});

/** Puts every ui store somewhere other than its default. */
function setEverything() {
	activeStep.set("git");
	gitLeftTab.set("log");
	openAgentId.set("agent-7");
	referencesPanelOpen.set(true);
	referencesQuery.set('{"symbol":"foo"}');
	showTool("env");
}

/** Puts every ui store back where it starts. */
function resetEverything() {
	activeStep.set("files");
	gitLeftTab.set("changes");
	openAgentId.set("");
	referencesPanelOpen.set(false);
	referencesQuery.set("");
	showTool(null);
}

beforeEach(() => {
	initViewStates({});
	activeProjectId.set("p1");
	resetEverything();
});

describe("snapshot then restore", () => {
	it("brings every view back exactly where it was left", () => {
		setEverything();
		const before = liveState();
		snapshotCurrentProject();
		resetEverything();
		applyProjectState("p1");
		expect(liveState()).toEqual(before);
	});

	it("restores each workflow step", () => {
		for (const step of ["files", "agent", "review", "tests", "git", "cicd"]) {
			activeStep.set(step as never);
			snapshotCurrentProject();
			activeStep.set("files");
			applyProjectState("p1");
			expect(get(activeStep), step).toBe(step);
		}
	});

	it("restores each git tab", () => {
		for (const tab of [
			"changes",
			"log",
			"graph",
			"stash",
			"mergerebase",
			"gitignore",
		]) {
			gitLeftTab.set(tab as never);
			snapshotCurrentProject();
			gitLeftTab.set("changes");
			applyProjectState("p1");
			expect(get(gitLeftTab), tab).toBe(tab);
		}
	});

	it("restores each tool, and only that one", () => {
		for (const tool of ["terminal", "commands", "env", "formatting"] as const) {
			showTool(tool);
			snapshotCurrentProject();
			showTool(null);
			applyProjectState("p1");
			const live = liveState();
			expect(
				[
					live.terminalActive,
					live.commandsActive,
					live.envActive,
					live.formattingActive,
				].filter(Boolean),
				tool,
			).toHaveLength(1);
		}
	});

	it("restores a workspace with no tool open", () => {
		showTool("terminal");
		snapshotCurrentProject();
		showTool(null);
		snapshotCurrentProject();
		showTool("env");
		applyProjectState("p1");
		expect(get(terminalActive)).toBe(false);
		expect(get(envActive)).toBe(false);
	});

	it("restores the references panel and the lookup it was showing", () => {
		referencesPanelOpen.set(true);
		referencesQuery.set('{"symbol":"parseUser"}');
		snapshotCurrentProject();
		referencesPanelOpen.set(false);
		referencesQuery.set("");
		applyProjectState("p1");
		expect(get(referencesPanelOpen)).toBe(true);
		expect(get(referencesQuery)).toBe('{"symbol":"parseUser"}');
	});

	it("restores the open agent thread", () => {
		openAgentId.set("agent-7");
		snapshotCurrentProject();
		openAgentId.set("");
		applyProjectState("p1");
		expect(get(openAgentId)).toBe("agent-7");
	});

	it("survives any number of round trips", () => {
		setEverything();
		const before = liveState();
		for (let i = 0; i < 3; i++) {
			snapshotCurrentProject();
			resetEverything();
			applyProjectState("p1");
		}
		expect(liveState()).toEqual(before);
	});
});

describe("switching between projects", () => {
	it("gives each project back its own view", () => {
		activeStep.set("git");
		showTool("terminal");
		snapshotCurrentProject();

		activeProjectId.set("p2");
		activeStep.set("agent");
		showTool("env");
		snapshotCurrentProject();

		applyProjectState("p1");
		expect(get(activeStep)).toBe("git");
		expect(get(terminalActive)).toBe(true);
		expect(get(envActive)).toBe(false);

		applyProjectState("p2");
		expect(get(activeStep)).toBe("agent");
		expect(get(envActive)).toBe(true);
		expect(get(terminalActive)).toBe(false);
	});

	it("opens a project nobody ever visited on the defaults", () => {
		setEverything();
		applyProjectState("never-opened");
		expect(liveState()).toEqual({
			activeStep: "files",
			gitLeftTab: "changes",
			terminalActive: false,
			commandsActive: false,
			envActive: false,
			formattingActive: false,
			openAgentId: "",
			referencesPanelOpen: false,
			referencesQuery: "",
		});
	});
});

describe("initViewStates", () => {
	it("restores a state read from disk", () => {
		initViewStates({
			p1: { activeStep: "tests", gitLeftTab: "graph" } as ProjectUiState,
		});
		applyProjectState("p1");
		expect(get(activeStep)).toBe("tests");
		expect(get(gitLeftTab)).toBe("graph");
	});

	it("fills in the fields a state saved by an older version lacks", () => {
		initViewStates({
			p1: { activeStep: "tests" } as ProjectUiState,
		});
		applyProjectState("p1");
		expect(get(referencesPanelOpen)).toBe(false);
		expect(get(openAgentId)).toBe("");
		expect(get(gitLeftTab)).toBe("changes");
	});

	it("replaces whatever was loaded before", () => {
		initViewStates({ p1: { activeStep: "git" } as ProjectUiState });
		initViewStates({ p2: { activeStep: "agent" } as ProjectUiState });
		expect(get(viewStates)).not.toHaveProperty("p1");
	});
});

describe("getAllProjectStates", () => {
	it("hands the persistence layer every project's state", () => {
		activeStep.set("git");
		snapshotCurrentProject();
		activeProjectId.set("p2");
		activeStep.set("tests");
		snapshotCurrentProject();
		expect(Object.keys(getAllProjectStates()).sort()).toEqual(["p1", "p2"]);
	});

	it("carries the fields no ui store owns", () => {
		updateProjectViewState({ gitLogSearch: "fix:", gitChangesSearch: "src/" });
		expect(getAllProjectStates().p1).toMatchObject({
			gitLogSearch: "fix:",
			gitChangesSearch: "src/",
		});
	});

	it("keeps the search boxes across a snapshot, which does not own them", () => {
		updateProjectViewState({ gitLogSearch: "fix:" });
		activeStep.set("git");
		snapshotCurrentProject();
		expect(getAllProjectStates().p1.gitLogSearch).toBe("fix:");
	});
});
