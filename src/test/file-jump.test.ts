// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activeInstance = (await import("svelte/store")).writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const LINES = ["one", "two", "three", "four", "five"];
vi.mock("$lib/services/file-service", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		readDirTree: vi.fn().mockResolvedValue([]),
		readDirTreeCached: vi.fn().mockResolvedValue([]),
		listDirNames: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(LINES.join("\n")),
		fileMtimes: vi.fn().mockResolvedValue({}),
		writeFile: vi.fn().mockResolvedValue(undefined),
		gitStatus: vi.fn().mockResolvedValue({}),
		gitBlame: vi.fn().mockResolvedValue(new Map()),
		gitShowFile: vi.fn().mockResolvedValue(""),
	};
});

vi.mock("$lib/stores/git", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getRemoteUrl: vi.fn().mockResolvedValue(""),
	refreshStatus: vi.fn().mockResolvedValue(undefined),
	setGitWatched: vi.fn(),
}));

vi.mock("$lib/utils/files/files-persistence", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadEditorState: vi
		.fn()
		.mockResolvedValue({ persisted: null, recentFiles: [] }),
	saveEditorState: vi.fn(),
}));

vi.mock("$lib/services/fs-watch-service", () => ({
	onFsChanged: vi.fn().mockResolvedValue(() => {}),
	watchWorktree: vi.fn().mockResolvedValue(undefined),
	unwatchWorktree: vi.fn().mockResolvedValue(undefined),
}));

const { activeProjectId } = await import("$lib/stores/project");
const { default: FilesView } = await import(
	"$lib/components/files/FilesView.svelte"
);

beforeEach(() => {
	activeProjectId.set("p1");
	activeInstance.set({
		id: "i1",
		projectId: "p1",
		branch: "feature",
		worktreePath: "/worktrees/p1/i1",
	});
});

/** Lets the reads, the pane restore and the editor mount settle. */
async function settle() {
	for (let i = 0; i < 12; i++) {
		await Promise.resolve();
		await tick();
	}
	await new Promise((resolve) => setTimeout(resolve, 120));
	await tick();
}

/** The cursor's 1-based line, as the status bar shows it. */
function cursorLine(): number | null {
	const match = (
		document.querySelector(".editor-statusbar")?.textContent ?? ""
	).match(/(\d+):(\d+)/);
	return match ? Number(match[1]) : null;
}

describe("opening a file at a line", () => {
	it("lands the cursor on the requested line of a freshly read tab", async () => {
		const view = render(FilesView);
		await settle();
		const component = view.component as unknown as {
			openFileAtLine: (
				path: string,
				line: number,
				col?: number,
			) => Promise<void>;
		};
		await component.openFileAtLine("a.ts", 4, 2);
		await settle();
		expect(document.querySelector(".editor-statusbar")).not.toBeNull();
		expect(cursorLine()).toBe(4);
	});

	it("lands on the requested line again when the file is already open", async () => {
		const view = render(FilesView);
		await settle();
		const component = view.component as unknown as {
			openFileAtLine: (
				path: string,
				line: number,
				col?: number,
			) => Promise<void>;
		};
		await component.openFileAtLine("a.ts", 4, 1);
		await settle();
		await component.openFileAtLine("a.ts", 2, 1);
		await settle();
		expect(cursorLine()).toBe(2);
	});
});
