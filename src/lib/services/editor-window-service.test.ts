// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabPayload } from "#lib/utils/files/tab-transfer";

const webviewWindow = vi.hoisted(() => ({
	label: "editor-3",
	listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
	getCurrentWebviewWindow: () => webviewWindow,
}));

import {
	beginNativeDrag,
	claimNativeDrag,
	closeAllEditorWindows,
	currentWindowLabel,
	editorWindowAtCursor,
	finishNativeDrag,
	focusFileOwner,
	MAIN_WINDOW,
	onNativeDragEnd,
	onRevealFile,
	onSaveAll,
	onTabsReceived,
	openEditorWindow,
	otherWindowsDirty,
	saveAllOtherWindows,
	startNativeDrag,
	syncWindowFiles,
	takeWindowTabs,
	transferTabs,
} from "./editor-window-service";

const mockInvoke = vi.mocked(invoke);

const TAB = { path: "/w/a.ts" } as unknown as TabPayload;

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
	webviewWindow.listen.mockReset();
});

describe("window identity", () => {
	it("names the main window", () => {
		expect(MAIN_WINDOW).toBe("main");
	});

	it("reads the label of the current webview window", () => {
		expect(currentWindowLabel()).toBe("editor-3");
	});
});

describe("window commands", () => {
	it("finds the window under the cursor", async () => {
		const answer = { supported: true, cursor: [1, 2], label: "main" };
		mockInvoke.mockResolvedValue(answer);
		await expect(editorWindowAtCursor()).resolves.toBe(answer);
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_at_cursor");
	});

	it("opens a window without a position by default", async () => {
		mockInvoke.mockResolvedValue("editor-4");
		await expect(openEditorWindow([TAB])).resolves.toBe("editor-4");
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_open", {
			tabs: [TAB],
			x: null,
			y: null,
		});
	});

	it("opens a window at the given position", async () => {
		await openEditorWindow([TAB], 10, 20);
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_open", {
			tabs: [TAB],
			x: 10,
			y: 20,
		});
	});

	it("takes the tabs the window was opened with", async () => {
		mockInvoke.mockResolvedValue([TAB]);
		await expect(takeWindowTabs()).resolves.toEqual([TAB]);
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_take_tabs");
	});

	it("transfers tabs to a target window", async () => {
		await transferTabs("main", [TAB]);
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_transfer", {
			target: "main",
			tabs: [TAB],
		});
	});

	it("syncs the files this window holds", async () => {
		const files = [{ path: "/w/a.ts", isDirty: true }];
		await syncWindowFiles(files);
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_sync", { files });
	});

	it("focuses the owner of a file and returns its label", async () => {
		mockInvoke.mockResolvedValue("editor-2");
		await expect(focusFileOwner("/w/a.ts")).resolves.toBe("editor-2");
		expect(mockInvoke).toHaveBeenCalledWith("editor_window_focus_owner", {
			path: "/w/a.ts",
		});
	});

	it("returns null when no window owns the file", async () => {
		mockInvoke.mockResolvedValue(null);
		await expect(focusFileOwner("/w/none.ts")).resolves.toBeNull();
	});

	it("lists the dirty files of the other windows", async () => {
		const dirty = [{ label: "editor-2", path: "/w/a.ts" }];
		mockInvoke.mockResolvedValue(dirty);
		await expect(otherWindowsDirty()).resolves.toBe(dirty);
		expect(mockInvoke).toHaveBeenCalledWith("editor_windows_dirty");
	});

	it("asks the other windows to save everything", async () => {
		await saveAllOtherWindows();
		expect(mockInvoke).toHaveBeenCalledWith("editor_windows_save_all");
	});

	it("closes every editor window", async () => {
		await closeAllEditorWindows();
		expect(mockInvoke).toHaveBeenCalledWith("editor_windows_close_all");
	});
});

describe("native drag", () => {
	it("starts the drag with its token", async () => {
		await startNativeDrag("tok");
		expect(mockInvoke).toHaveBeenCalledWith("editor_drag_start", {
			token: "tok",
		});
	});

	it("begins the drag with the tab it carries", async () => {
		await beginNativeDrag("tok", TAB);
		expect(mockInvoke).toHaveBeenCalledWith("editor_drag_begin", {
			token: "tok",
			tab: TAB,
		});
	});

	it("claims the tab of a drag", async () => {
		mockInvoke.mockResolvedValue(TAB);
		await expect(claimNativeDrag("tok")).resolves.toBe(TAB);
		expect(mockInvoke).toHaveBeenCalledWith("editor_drag_claim", {
			token: "tok",
		});
	});

	it("returns null when nobody holds the token", async () => {
		mockInvoke.mockResolvedValue(null);
		await expect(claimNativeDrag("tok")).resolves.toBeNull();
	});

	it("finishes the drag and says whether the tab moved", async () => {
		mockInvoke.mockResolvedValue(true);
		await expect(finishNativeDrag("tok")).resolves.toBe(true);
		expect(mockInvoke).toHaveBeenCalledWith("editor_drag_finish", {
			token: "tok",
		});
	});
});

describe("event subscriptions", () => {
	const unlisten = () => {};

	/** The callback the service registered for an event name. */
	const registered = (name: string) => {
		const call = webviewWindow.listen.mock.calls.find((c) => c[0] === name);
		return call?.[1] as (e: { payload: unknown }) => void;
	};

	beforeEach(() => {
		webviewWindow.listen.mockResolvedValue(unlisten);
	});

	it("forwards the payload of received tabs", async () => {
		const handler = vi.fn();
		await expect(onTabsReceived(handler)).resolves.toBe(unlisten);
		const payload = { tabs: [TAB], from: "main" };
		registered("editor-tabs-received")({ payload });
		expect(handler).toHaveBeenCalledWith(payload);
	});

	it("forwards the path of a revealed file", async () => {
		const handler = vi.fn();
		await expect(onRevealFile(handler)).resolves.toBe(unlisten);
		registered("editor-reveal-file")({ payload: "/w/a.ts" });
		expect(handler).toHaveBeenCalledWith("/w/a.ts");
	});

	it("calls the save-all handler without the event", async () => {
		const handler = vi.fn();
		await expect(onSaveAll(handler)).resolves.toBe(unlisten);
		registered("editor-save-all")({ payload: "ignored" });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith();
	});

	it("forwards how a native drag ended", async () => {
		const handler = vi.fn();
		await expect(onNativeDragEnd(handler)).resolves.toBe(unlisten);
		const end = { isDropped: true, isCancelled: false };
		registered("editor-drag-end")({ payload: end });
		expect(handler).toHaveBeenCalledWith(end);
	});
});
