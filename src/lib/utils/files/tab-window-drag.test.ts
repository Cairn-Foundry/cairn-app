// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabPayload } from "./tab-transfer";

const service = vi.hoisted(() => ({
	currentWindowLabel: vi.fn(() => "main"),
	editorWindowAtCursor: vi.fn(),
	transferTabs: vi.fn(),
	openEditorWindow: vi.fn(),
	beginNativeDrag: vi.fn(),
	startNativeDrag: vi.fn(),
	finishNativeDrag: vi.fn(),
	claimNativeDrag: vi.fn(),
	onNativeDragEnd: vi.fn(),
}));
vi.mock("#lib/services/editor-window-service", () => service);

const { claimDroppedTabs, dragTabNatively, dropTabOutside, isOutsideViewport } =
	await import("./tab-window-drag");

const payload = { absPath: "/w/a.ts" } as TabPayload;
const release = { screenX: 300, screenY: 200 } as PointerEvent;

/** Makes GTK report the end of the drag as soon as it is listened for. */
function endNativeDragWith(end: { isDropped: boolean; isCancelled: boolean }) {
	service.onNativeDragEnd.mockImplementation(async (handler) => {
		queueMicrotask(() => handler(end));
		return () => {};
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout"] });
	for (const fn of Object.values(service)) fn.mockReset();
	service.currentWindowLabel.mockReturnValue("main");
});

describe("dropping a tab outside its window", () => {
	it("moves it to the window under the cursor", async () => {
		service.editorWindowAtCursor.mockResolvedValue({
			supported: true,
			cursor: [0, 0],
			label: "editor-2",
		});
		expect(await dropTabOutside(payload, release)).toBe("moved");
		expect(service.transferTabs).toHaveBeenCalledWith("editor-2", [payload]);
	});

	it("opens a new window where it was released when no window is there", async () => {
		service.editorWindowAtCursor.mockResolvedValue({
			supported: true,
			cursor: [0, 0],
			label: null,
		});
		expect(await dropTabOutside(payload, release)).toBe("moved");
		expect(service.openEditorWindow).toHaveBeenCalledWith([payload], 300, 200);
	});

	it("leaves it put when the backend cannot locate windows", async () => {
		service.editorWindowAtCursor.mockResolvedValue({ supported: false });
		expect(await dropTabOutside(payload, release)).toBe("stayed");
		expect(service.transferTabs).not.toHaveBeenCalled();
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});

	it("leaves it put when released over its own window", async () => {
		service.editorWindowAtCursor.mockResolvedValue({
			supported: true,
			cursor: [0, 0],
			label: "main",
		});
		expect(await dropTabOutside(payload, release)).toBe("stayed");
		expect(service.transferTabs).not.toHaveBeenCalled();
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});
});

describe("the native drag (Wayland)", () => {
	async function run() {
		const outcome = dragTabNatively(payload);
		await vi.runAllTimersAsync();
		return outcome;
	}

	it("counts as moved when another window claimed the tab", async () => {
		endNativeDragWith({ isDropped: true, isCancelled: false });
		service.finishNativeDrag.mockResolvedValue(true);
		expect(await run()).toBe("moved");
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});

	it("opens a window when it was dropped where no Cairn window took it", async () => {
		endNativeDragWith({ isDropped: true, isCancelled: false });
		service.finishNativeDrag.mockResolvedValue(false);
		expect(await run()).toBe("moved");
		expect(service.openEditorWindow).toHaveBeenCalledWith([payload]);
	});

	it("stays put on Escape", async () => {
		endNativeDragWith({ isDropped: false, isCancelled: true });
		service.finishNativeDrag.mockResolvedValue(false);
		expect(await run()).toBe("stayed");
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});

	it("stays put when GTK refuses to start", async () => {
		endNativeDragWith({ isDropped: false, isCancelled: false });
		service.startNativeDrag.mockRejectedValue("no drag");
		expect(await run()).toBe("stayed");
		expect(service.finishNativeDrag).toHaveBeenCalledWith(
			service.startNativeDrag.mock.calls[0][0],
		);
	});
});

describe("the native drag listener", () => {
	it("stops listening once the drag ended after the listener was registered", async () => {
		const off = vi.fn();
		let onEnd: (end: unknown) => void = () => {};
		service.onNativeDragEnd.mockImplementation(async (handler) => {
			onEnd = handler;
			return off;
		});
		service.startNativeDrag.mockResolvedValue(undefined);
		service.finishNativeDrag.mockResolvedValue(true);
		const outcome = dragTabNatively(payload);
		await vi.advanceTimersByTimeAsync(0);
		expect(off).not.toHaveBeenCalled();
		onEnd({ isDropped: true, isCancelled: false });
		await vi.runAllTimersAsync();
		expect(await outcome).toBe("moved");
		expect(off).toHaveBeenCalledTimes(1);
	});

	it("gives up on a drag that never reports its end", async () => {
		const off = vi.fn();
		service.onNativeDragEnd.mockResolvedValue(off);
		service.startNativeDrag.mockResolvedValue(undefined);
		service.finishNativeDrag.mockResolvedValue(false);
		const outcome = dragTabNatively(payload);
		await vi.advanceTimersByTimeAsync(119_999);
		expect(off).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(await outcome).toBe("stayed");
		expect(off).toHaveBeenCalledTimes(1);
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});

	it("stays put when the tab was dropped back on its own window", async () => {
		endNativeDragWith({ isDropped: true, isCancelled: false });
		service.finishNativeDrag.mockResolvedValue(false);
		let claimed: unknown;
		service.startNativeDrag.mockImplementation(async (token: string) => {
			claimed = await claimDroppedTabs([`cairn-tab:${token}`]);
		});
		const outcome = dragTabNatively(payload);
		await vi.runAllTimersAsync();
		expect(await outcome).toBe("stayed");
		expect(claimed).toEqual({ tabs: [], files: [] });
		expect(service.claimNativeDrag).not.toHaveBeenCalled();
		expect(service.openEditorWindow).not.toHaveBeenCalled();
	});
});

describe("claiming dropped tabs", () => {
	it("claims tab tokens and hands real files back", async () => {
		service.claimNativeDrag.mockResolvedValue(payload);
		const { tabs, files } = await claimDroppedTabs([
			"cairn-tab:editor-1-abc",
			"/home/me/notes.txt",
		]);
		expect(tabs).toEqual([payload]);
		expect(files).toEqual(["/home/me/notes.txt"]);
		expect(service.claimNativeDrag).toHaveBeenCalledWith("editor-1-abc");
	});

	it("drops a token whose claim failed", async () => {
		service.claimNativeDrag.mockRejectedValue(new Error("gone"));
		const result = await claimDroppedTabs(["cairn-tab:gone", "/a.txt"]);
		expect(result).toEqual({ tabs: [], files: ["/a.txt"] });
	});

	it("drops a token nobody could claim", async () => {
		service.claimNativeDrag.mockResolvedValue(null);
		const { tabs } = await claimDroppedTabs(["cairn-tab:gone"]);
		expect(tabs).toEqual([]);
	});
});

describe("the native drag handshake", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers the payload under a token made of the window, the time and six random characters", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
		vi.spyOn(Math, "random").mockReturnValue(0.123456789);
		const suffix = (0.123456789).toString(36).slice(2, 8);
		endNativeDragWith({ isDropped: true, isCancelled: false });
		service.finishNativeDrag.mockResolvedValue(true);

		const outcome = dragTabNatively(payload);
		await vi.runAllTimersAsync();
		await outcome;

		const token = `main-1700000000000-${suffix}`;
		expect(suffix).toHaveLength(6);
		expect(service.beginNativeDrag).toHaveBeenCalledWith(token, payload);
		expect(service.startNativeDrag).toHaveBeenCalledWith(token);
		expect(service.finishNativeDrag).toHaveBeenCalledWith(token);
	});

	it("releases the listener of a drag that ended before it was registered", async () => {
		const off = vi.fn();
		service.onNativeDragEnd.mockImplementation(async (handler) => {
			queueMicrotask(() => handler({ isDropped: true, isCancelled: false }));
			return off;
		});
		service.finishNativeDrag.mockResolvedValue(true);

		const outcome = dragTabNatively(payload);
		await vi.runAllTimersAsync();
		await outcome;

		expect(off).toHaveBeenCalledTimes(1);
	});

	it("cancels the give-up timer once the drag ended", async () => {
		vi.useRealTimers();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		endNativeDragWith({ isDropped: true, isCancelled: false });
		service.finishNativeDrag.mockResolvedValue(true);

		const outcome = dragTabNatively(payload);
		await vi.advanceTimersByTimeAsync(400);
		await outcome;

		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("telling whether tabs leave through a native drag", () => {
	async function freshUsesNativeDrag() {
		vi.resetModules();
		return (await import("./tab-window-drag")).usesNativeDrag;
	}

	it("is true when the backend cannot locate windows", async () => {
		service.editorWindowAtCursor.mockResolvedValue({ supported: false });
		expect(await (await freshUsesNativeDrag())()).toBe(true);
	});

	it("is false when the backend can locate windows", async () => {
		service.editorWindowAtCursor.mockResolvedValue({
			supported: true,
			cursor: [0, 0],
			label: null,
		});
		expect(await (await freshUsesNativeDrag())()).toBe(false);
	});

	it("is false when the probe fails", async () => {
		service.editorWindowAtCursor.mockRejectedValue(new Error("no backend"));
		expect(await (await freshUsesNativeDrag())()).toBe(false);
	});

	it("probes the backend only once", async () => {
		service.editorWindowAtCursor.mockResolvedValue({ supported: false });
		const usesNativeDrag = await freshUsesNativeDrag();
		await usesNativeDrag();
		await usesNativeDrag();
		expect(service.editorWindowAtCursor).toHaveBeenCalledTimes(1);
	});
});

describe("leaving the viewport", () => {
	const at = (clientX: number, clientY: number) =>
		isOutsideViewport({ clientX, clientY } as PointerEvent);
	const width = window.innerWidth;
	const height = window.innerHeight;

	it("stays inside from the top-left pixel to the last pixel", () => {
		expect(at(0, 0)).toBe(false);
		expect(at(width - 1, height - 1)).toBe(false);
		expect(at(10, 10)).toBe(false);
	});

	it("is outside past the left edge", () => {
		expect(at(-1, 10)).toBe(true);
	});

	it("is outside past the top edge", () => {
		expect(at(10, -1)).toBe(true);
	});

	it("is outside from the right edge on", () => {
		expect(at(width, 10)).toBe(true);
	});

	it("is outside from the bottom edge on", () => {
		expect(at(10, height)).toBe(true);
	});
});
