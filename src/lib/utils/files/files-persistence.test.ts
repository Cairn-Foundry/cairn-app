import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fileService from "../../../lib/services/file-service";
import * as fileStateService from "../../../lib/services/file-state-service";
import { docFromString } from "./document-model";
import {
	type InstanceTabState,
	loadEditorState,
	type PersistedState,
	pushRecent,
	rehydrateFromPersisted,
	saveEditorState,
} from "./files-persistence";

vi.mock("$lib/services/file-service", () => ({
	isBinaryPath: vi.fn().mockReturnValue(false),
	readFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("$lib/services/file-state-service", () => ({
	getFileState: vi.fn().mockResolvedValue(null),
	saveFileState: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(fileService.isBinaryPath).mockReturnValue(false);
	vi.mocked(fileService.readFile).mockResolvedValue("");
	vi.mocked(fileStateService.getFileState).mockResolvedValue(null);
});

function persistedTab(path: string) {
	return { path, cursorPos: 0, scrollTop: 0 };
}

describe("pushRecent", () => {
	it("puts the path first", () => {
		expect(pushRecent(["a.ts", "b.ts"], "c.ts")).toEqual([
			"c.ts",
			"a.ts",
			"b.ts",
		]);
	});

	it("moves an existing path to the front instead of duplicating it", () => {
		expect(pushRecent(["a.ts", "b.ts", "c.ts"], "c.ts")).toEqual([
			"c.ts",
			"a.ts",
			"b.ts",
		]);
	});

	it("caps the list at ten entries", () => {
		const prev = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
		const next = pushRecent(prev, "new.ts");
		expect(next).toHaveLength(10);
		expect(next[0]).toBe("new.ts");
		expect(next).not.toContain("f9.ts");
	});

	it("leaves the input untouched", () => {
		const prev = ["a.ts"];
		pushRecent(prev, "b.ts");
		expect(prev).toEqual(["a.ts"]);
	});
});

describe("saveEditorState", () => {
	it("persists the layout without any file content", () => {
		const state: InstanceTabState = {
			panes: [
				{
					tabs: [
						{
							path: "a.ts",
							doc: docFromString("edited"),
							savedDoc: docFromString("on disk"),
							cursorPos: 12,
							scrollTop: 40,
							pinned: true,
							lineEndings: "LF",
						},
					],
					activeTabIdx: 0,
				},
			],
			expanded: new Set(["src"]),
			splitMode: true,
			splitLeftWidth: 300,
		};

		saveEditorState("proj", "inst", state, ["a.ts"]);

		expect(fileStateService.saveFileState).toHaveBeenCalledWith(
			"proj",
			"inst",
			{
				panes: [
					{
						tabs: [
							{ path: "a.ts", cursorPos: 12, scrollTop: 40, pinned: true },
						],
						activeTabIdx: 0,
					},
				],
				expanded: ["src"],
				splitMode: true,
				splitLeftWidth: 300,
				recentFiles: ["a.ts"],
			},
		);

		const saved = vi.mocked(fileStateService.saveFileState).mock.calls[0][2];
		expect(JSON.stringify(saved)).not.toContain("edited");
	});
});

describe("loadEditorState", () => {
	it("returns a null layout for an instance opened for the first time", async () => {
		const result = await loadEditorState("proj", "inst");
		expect(result).toEqual({ persisted: null, recentFiles: [] });
	});

	it("splits the stored state into layout and recent files", async () => {
		vi.mocked(fileStateService.getFileState).mockResolvedValueOnce({
			panes: [{ tabs: [persistedTab("a.ts")], activeTabIdx: 0 }],
			expanded: ["src"],
			splitMode: false,
			splitLeftWidth: 200,
			recentFiles: ["a.ts", "b.ts"],
		});

		const { persisted, recentFiles } = await loadEditorState("proj", "inst");

		expect(recentFiles).toEqual(["a.ts", "b.ts"]);
		expect(persisted?.panes).toHaveLength(1);
		expect(persisted?.splitLeftWidth).toBe(200);
		expect(persisted).not.toHaveProperty("recentFiles");
	});
});

describe("rehydrateFromPersisted", () => {
	function statePersisting(
		tabs: string[],
		activeTabIdx: number,
	): PersistedState {
		return {
			panes: [{ tabs: tabs.map(persistedTab), activeTabIdx }],
			expanded: [],
		};
	}

	it("reads each tab's content back from disk", async () => {
		vi.mocked(fileService.readFile).mockResolvedValue("hello");
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts"], 0),
		);
		expect(result.panes[0].tabs[0].savedDoc.toString()).toBe("hello");
		expect(result.panes[0].tabs[0].doc).toBe(result.panes[0].tabs[0].savedDoc);
	});

	it("normalizes CRLF content and records the original line endings", async () => {
		vi.mocked(fileService.readFile).mockResolvedValue("a\r\nb");
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts"], 0),
		);
		expect(result.panes[0].tabs[0].lineEndings).toBe("CRLF");
		expect(result.panes[0].tabs[0].savedDoc.toString()).toBe("a\nb");
	});

	it("opens a binary tab empty without reading it", async () => {
		vi.mocked(fileService.isBinaryPath).mockReturnValue(true);
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.png"], 0),
		);
		expect(result.panes[0].tabs[0].savedDoc.toString()).toBe("");
		expect(fileService.readFile).not.toHaveBeenCalled();
	});

	it("drops a tab whose file no longer reads", async () => {
		vi.mocked(fileService.readFile)
			.mockResolvedValueOnce("kept")
			.mockRejectedValueOnce(new Error("gone"));
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts", "b.ts"], 0),
		);
		expect(result.panes[0].tabs.map((t) => t.path)).toEqual(["a.ts"]);
	});

	it("clamps an active index left past the end by a deleted file", async () => {
		vi.mocked(fileService.readFile)
			.mockResolvedValueOnce("kept")
			.mockRejectedValueOnce(new Error("gone"));
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts", "b.ts"], 1),
		);
		expect(result.panes[0].activeTabIdx).toBe(0);
	});

	it("marks an emptied pane as having no active tab", async () => {
		vi.mocked(fileService.readFile).mockRejectedValue(new Error("gone"));
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts"], 0),
		);
		expect(result.panes[0].tabs).toHaveLength(0);
		expect(result.panes[0].activeTabIdx).toBe(-1);
	});

	it("clamps a negative active index on a non-empty pane", async () => {
		const result = await rehydrateFromPersisted(
			"/wt",
			statePersisting(["a.ts"], -1),
		);
		expect(result.panes[0].activeTabIdx).toBe(0);
	});

	it("restores the expanded set and defaults the missing split fields", async () => {
		const result = await rehydrateFromPersisted("/wt", {
			panes: [],
			expanded: ["src", "src/lib"],
		});
		expect(result.expanded).toEqual(new Set(["src", "src/lib"]));
		expect(result.splitMode).toBe(false);
		expect(result.splitLeftWidth).toBe(0);
	});
});
