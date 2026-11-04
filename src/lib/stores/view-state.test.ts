// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { activeProjectId } from "#lib/stores/project";
import { activeStep, gitLeftTab, showTool } from "#lib/stores/ui";
import {
	currentProjectViewState,
	initViewStates,
	snapshotCurrentProject,
	updateProjectViewState,
	viewStates,
} from "./view-state";

function countNotifications(run: () => void): number {
	let calls = 0;
	const unsubscribe = viewStates.subscribe(() => {
		calls += 1;
	});
	calls = 0;
	run();
	unsubscribe();
	return calls;
}

describe("view state", () => {
	beforeEach(() => {
		initViewStates({});
		activeProjectId.set("p");
		activeStep.set("files");
		gitLeftTab.set("changes");
		showTool(null);
	});

	it("notifies once for the first snapshot of a project", () => {
		expect(countNotifications(() => snapshotCurrentProject())).toBe(1);
		expect(get(viewStates).p.activeStep).toBe("files");
	});

	it("stays silent when a snapshot brings nothing new", () => {
		snapshotCurrentProject();
		expect(countNotifications(() => snapshotCurrentProject())).toBe(0);
		expect(
			countNotifications(() => {
				snapshotCurrentProject();
				snapshotCurrentProject();
			}),
		).toBe(0);
	});

	it("notifies when a tracked value actually changes", () => {
		snapshotCurrentProject();
		activeStep.set("git");
		expect(countNotifications(() => snapshotCurrentProject())).toBe(1);
		expect(get(viewStates).p.activeStep).toBe("git");
	});

	it("keeps the tool flags of the snapshot in sync", () => {
		showTool("terminal");
		snapshotCurrentProject();
		expect(get(viewStates).p.terminalActive).toBe(true);
		expect(get(viewStates).p.commandsActive).toBe(false);
	});

	it("stays silent when a patch repeats the stored value", () => {
		updateProjectViewState({ gitLogSearch: "fix" });
		expect(get(viewStates).p.gitLogSearch).toBe("fix");
		expect(
			countNotifications(() => updateProjectViewState({ gitLogSearch: "fix" })),
		).toBe(0);
		expect(
			countNotifications(() =>
				updateProjectViewState({ gitLogSearch: "feat" }),
			),
		).toBe(1);
	});

	it("patches nothing when no project is active", () => {
		activeProjectId.set(null);
		expect(
			countNotifications(() => updateProjectViewState({ gitLogSearch: "fix" })),
		).toBe(0);
		expect(get(viewStates)).toEqual({});
	});

	it("serves the default view state when no project is active", () => {
		activeProjectId.set(null);
		expect(get(currentProjectViewState)).toMatchObject({
			activeStep: "files",
			gitLeftTab: "changes",
			terminalActive: false,
			lastCli: "",
			gitLogSearch: "",
		});
	});

	it("serves the default view state of a project never snapshotted", () => {
		expect(get(currentProjectViewState)).toMatchObject({
			activeStep: "files",
			gitLogSearch: "",
		});
		expect(get(viewStates).p).toBeUndefined();
	});

	it("serves the stored view state of the active project", () => {
		activeStep.set("git");
		snapshotCurrentProject();
		expect(get(currentProjectViewState).activeStep).toBe("git");
	});

	it("snapshots nothing when no project is active", () => {
		activeProjectId.set(null);
		expect(countNotifications(() => snapshotCurrentProject())).toBe(0);
		expect(get(viewStates)).toEqual({});
	});

	it("fills the fields no ui store owns from the defaults on a first snapshot", () => {
		snapshotCurrentProject();
		expect(get(viewStates).p).toMatchObject({
			gitChangesSearch: "",
			gitLogSearch: "",
			gitStagedSearch: "",
		});
	});

	it("starts from the defaults when patching a project never snapshotted", () => {
		updateProjectViewState({ gitLogSearch: "fix" });
		expect(get(viewStates).p).toMatchObject({
			activeStep: "files",
			gitLeftTab: "changes",
			terminalActive: false,
			gitChangesSearch: "",
			gitLogSearch: "fix",
		});
	});

	it("keeps each project on its own state", () => {
		snapshotCurrentProject();
		activeProjectId.set("q");
		activeStep.set("agent");
		snapshotCurrentProject();
		expect(get(viewStates).p.activeStep).toBe("files");
		expect(get(viewStates).q.activeStep).toBe("agent");
	});
});
