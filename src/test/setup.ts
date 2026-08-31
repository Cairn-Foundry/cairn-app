import { cleanup } from "@testing-library/svelte";
import { afterEach, vi } from "vitest";

// Every rendered component is unmounted after its test, so the next one starts
// on an empty document rather than finding two of everything.
afterEach(cleanup);

// Resolved rather than bare: a fire-and-forget caller does `invoke(...).catch()`
// on the result, so returning `undefined` throws asynchronously, escapes as an
// unhandled error and fails the whole run even though every test passes.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn().mockResolvedValue(undefined),
	convertFileSrc: (path: string, protocol = "asset") =>
		`${protocol}://localhost/${encodeURIComponent(path)}`,
}));
// Several modules subscribe at import time; without this the real listen()
// reaches into a Tauri runtime that does not exist under jsdom.
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn().mockResolvedValue(() => {}),
	emit: vi.fn().mockResolvedValue(undefined),
	once: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({
		onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
	}),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		listen: vi.fn().mockResolvedValue(() => {}),
		onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
	openPath: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: vi.fn(),
	readText: vi.fn(),
}));

// xterm probes a canvas on construction; jsdom has no 2D context and logs a
// "Not implemented" line per call. The probe result is unused by these tests.
HTMLCanvasElement.prototype.getContext = (() =>
	null) as HTMLCanvasElement["getContext"];

// jsdom lays nothing out, so it ships no scrollIntoView; several views call it
// to keep the active item in sight.
Element.prototype.scrollIntoView = () => {};

// jsdom ships no ResizeObserver, and several views observe their own scroller
// to size a virtual window. Nothing here lays out, so a stub that never fires
// is the honest stand-in: the observed height stays whatever the view assumed.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
