// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(
	() => ({}) as Record<string, (event: { payload: unknown }) => void>,
);
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(
		(name: string, callback: (event: { payload: unknown }) => void) => {
			listeners[name] = callback;
			return Promise.resolve(() => {});
		},
	),
}));

const writeToTerminal = vi.hoisted(() => vi.fn());
const resizeTerminal = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/terminal-service", () => ({
	writeToTerminal,
	resizeTerminal,
}));

const webglState = vi.hoisted(() => ({
	instances: [] as { loseContext: () => void }[],
	isUnsupported: false,
	dispose: undefined as unknown as ReturnType<typeof vi.fn>,
}));
const fitSpy = vi.hoisted(() => vi.fn());
const fitted = vi.hoisted(() => ({ term: null as Terminal | null }));
const serializeSpy = vi.hoisted(() => vi.fn());
vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class {
		fit = fitSpy;
		activate(term: Terminal) {
			fitted.term = term;
		}
		dispose() {}
	},
}));
vi.mock("@xterm/addon-serialize", () => ({
	SerializeAddon: class {
		serialize = serializeSpy;
		activate() {}
		dispose() {}
	},
}));

vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: class {
		constructor() {
			webglState.instances.push(this);
			if (webglState.isUnsupported) throw new Error("no webgl");
		}
		onContextLoss(callback: () => void) {
			this.loseContext = callback;
		}
		loseContext: () => void = () => {};
		activate() {}
		dispose = webglState.dispose;
	},
}));

import {
	attach,
	create,
	detach,
	dispose,
	focus,
	observeInput,
	observeOutput,
	onTerminalExit,
	paste,
	refit,
	size,
} from "./terminal-manager";

let slot: HTMLDivElement;
let counter = 0;
const freshId = () => `t${++counter}`;

const emitOutput = (id: string, data: string) =>
	listeners["terminal-output"]({ payload: { id, data } });

const observers: (() => void)[] = [];

beforeEach(() => {
	window.matchMedia = vi.fn().mockReturnValue({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
	});
	vi.useFakeTimers();
	webglState.instances.length = 0;
	webglState.isUnsupported = false;
	webglState.dispose = vi.fn();
	writeToTerminal.mockReset().mockResolvedValue(undefined);
	resizeTerminal.mockReset().mockResolvedValue(undefined);
	fitSpy.mockReset();
	serializeSpy.mockReset().mockReturnValue("SCREEN");
	slot = document.createElement("div");
	document.body.append(slot);
});

afterEach(() => {
	for (const stop of observers.splice(0)) stop();
	slot.remove();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("create and size", () => {
	it("reports 80x24 for a terminal that was never laid out", () => {
		const id = freshId();
		create(id);

		expect(size(id)).toEqual({ cols: 80, rows: 24 });
	});

	it("reports 80x24 for an unknown id", () => {
		expect(size("unknown")).toEqual({ cols: 80, rows: 24 });
	});

	it("keeps the host element of a terminal that is created twice", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const host = slot.firstChild;

		create(id);
		const other = document.createElement("div");
		attach(id, other);

		expect(other.firstChild).toBe(host);
	});
});

describe("attach", () => {
	it("opens xterm in the host and places it in the slot", () => {
		const id = freshId();
		create(id);

		attach(id, slot);

		const host = slot.firstElementChild as HTMLElement;
		expect(host.className).toBe("terminal-host");
		expect(host.querySelector(".xterm")).not.toBeNull();
	});

	it("does nothing for an unknown id", () => {
		attach("unknown", slot);

		expect(slot.childElementCount).toBe(0);
	});

	it("takes the keyboard focus once it has moved into the slot", () => {
		const id = freshId();
		create(id);

		attach(id, slot);
		vi.advanceTimersByTime(20);

		expect(document.activeElement).toBe(
			slot.querySelector(".xterm-helper-textarea"),
		);
	});

	it("leaves the focus alone when the terminal is already in the slot", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		(document.activeElement as HTMLElement).blur();

		attach(id, slot);
		vi.advanceTimersByTime(20);

		expect(document.activeElement).toBe(document.body);
	});

	it("refits to the slot", () => {
		const id = freshId();
		create(id);

		attach(id, slot);
		vi.advanceTimersByTime(20);

		expect(fitSpy).toHaveBeenCalledTimes(2);
	});
});

describe("refit", () => {
	it("coalesces several requests into one fit per frame", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		fitSpy.mockClear();

		refit(id);
		refit(id);
		refit(id);
		vi.advanceTimersByTime(20);

		expect(fitSpy).toHaveBeenCalledTimes(1);
	});

	it("skips a terminal that was disposed before the frame", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		fitSpy.mockClear();

		refit(id);
		dispose(id);
		vi.advanceTimersByTime(20);

		expect(fitSpy).not.toHaveBeenCalled();
	});

	it("tells the PTY the size the fit settled on", () => {
		const id = freshId();
		create(id);
		fitSpy.mockImplementation(() => fitted.term?.resize(120, 40));

		attach(id, slot);

		expect(size(id)).toEqual({ cols: 120, rows: 40 });
		expect(resizeTerminal).toHaveBeenCalledWith(id, 120, 40);
	});
});

describe("detach and re-attach", () => {
	it("empties the host and hibernates the screen", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const host = slot.firstElementChild as HTMLElement;

		detach(id);

		expect(host.childElementCount).toBe(0);
		expect(serializeSpy).toHaveBeenCalledWith({ scrollback: 2000 });
	});

	it("does nothing for a terminal that is not on screen", () => {
		const id = freshId();
		create(id);

		detach(id);

		expect(serializeSpy).not.toHaveBeenCalled();
	});

	it("replays the screen and what arrived while hibernated, on the next attach", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		detach(id);
		emitOutput(id, "while away");
		const write = vi.spyOn(Terminal.prototype, "write");

		attach(id, slot);

		expect(write).toHaveBeenCalledWith(
			"SCREENwhile away",
			expect.any(Function),
		);
	});

	it("does not replay when nothing was kept", () => {
		const id = freshId();
		create(id);
		serializeSpy.mockReturnValue("");
		attach(id, slot);
		detach(id);
		const write = vi.spyOn(Terminal.prototype, "write");

		attach(id, slot);

		expect(write).not.toHaveBeenCalled();
	});
});

describe("output", () => {
	it("tells the observer which terminal printed, without the bytes", () => {
		const id = freshId();
		create(id);
		const seen = vi.fn();
		observers.push(observeOutput(seen));

		emitOutput(id, "secret");

		expect(seen).toHaveBeenCalledTimes(1);
		expect(seen).toHaveBeenCalledWith(id);
	});

	it("stops telling once the observer is removed", () => {
		const id = freshId();
		create(id);
		const seen = vi.fn();
		const stop = observeOutput(seen);
		stop();

		emitOutput(id, "x");

		expect(seen).not.toHaveBeenCalled();
	});

	it("writes straight to a terminal that is on screen", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const write = vi.spyOn(Terminal.prototype, "write");

		emitOutput(id, "live");

		expect(write).toHaveBeenCalledWith("live");
	});
});

describe("paste", () => {
	it("types the text without submitting it, newlines turned into spaces", async () => {
		const id = freshId();

		paste(id, "  line one\nline two\r\nline three \n");
		await vi.runAllTimersAsync();

		expect(writeToTerminal).toHaveBeenCalledTimes(1);
		expect(writeToTerminal).toHaveBeenCalledWith(
			id,
			"line one line two line three",
		);
	});

	it("types nothing for blank text", async () => {
		paste(freshId(), " \n ");
		await vi.runAllTimersAsync();

		expect(writeToTerminal).not.toHaveBeenCalled();
	});

	it("reaches the input observer before the PTY", async () => {
		const id = freshId();
		const order: string[] = [];
		observers.push(
			observeInput((seenId, data) => order.push(`observed ${seenId} ${data}`)),
		);
		writeToTerminal.mockImplementation(async (_id, data) => {
			order.push(`written ${data}`);
		});

		paste(id, "hello");
		await vi.runAllTimersAsync();

		expect(order).toEqual([`observed ${id} hello`, "written hello"]);
	});

	it("keeps the order of what was typed", async () => {
		const id = freshId();
		let releaseFirst: () => void = () => {};
		writeToTerminal.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseFirst = resolve)),
		);

		paste(id, "first");
		paste(id, "second");
		await vi.advanceTimersByTimeAsync(0);
		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual(["first"]);

		releaseFirst();
		await vi.runAllTimersAsync();
		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual([
			"first",
			"second",
		]);
	});

	it("keeps writing after a write failed", async () => {
		const id = freshId();
		writeToTerminal.mockRejectedValueOnce(new Error("pty gone"));

		paste(id, "first");
		paste(id, "second");
		await vi.runAllTimersAsync();

		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual([
			"first",
			"second",
		]);
	});
});

describe("focus", () => {
	it("gives the keyboard to a terminal on screen", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		(document.activeElement as HTMLElement).blur();

		focus(id);

		expect(document.activeElement).toBe(
			slot.querySelector(".xterm-helper-textarea"),
		);
	});

	it("does nothing for a hibernated or unknown terminal", () => {
		const id = freshId();
		create(id);

		focus(id);
		focus("unknown");

		expect(document.activeElement).toBe(document.body);
	});
});

describe("dispose", () => {
	it("removes the terminal from the page and forgets it", () => {
		const id = freshId();
		create(id);
		attach(id, slot);

		dispose(id);

		expect(slot.childElementCount).toBe(0);
		const other = document.createElement("div");
		attach(id, other);
		expect(other.childElementCount).toBe(0);
	});

	it("does nothing for an unknown id", () => {
		expect(() => dispose("unknown")).not.toThrow();
	});

	it("drops the output that arrives afterwards", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		dispose(id);
		const write = vi.spyOn(Terminal.prototype, "write");

		emitOutput(id, "late");

		expect(write).not.toHaveBeenCalled();
	});
});

describe("refit when the slot has no layout", () => {
	it("keeps going when fit throws and leaves the PTY size alone", () => {
		const id = freshId();
		create(id);
		fitSpy.mockImplementation(() => {
			throw new Error("no layout");
		});

		expect(() => attach(id, slot)).not.toThrow();

		expect(fitSpy).toHaveBeenCalled();
		expect(resizeTerminal).not.toHaveBeenCalled();
		expect(size(id)).toEqual({ cols: 80, rows: 24 });
	});
});

describe("renderer", () => {
	it("loads one WebGL context however many times the terminal is attached", () => {
		const id = freshId();
		create(id);

		attach(id, slot);
		attach(id, slot);

		expect(webglState.instances).toHaveLength(1);
	});

	it("releases the context on detach and takes a new one on the next attach", () => {
		const id = freshId();
		create(id);
		attach(id, slot);

		detach(id);
		expect(webglState.dispose).toHaveBeenCalledTimes(1);
		attach(id, slot);

		expect(webglState.instances).toHaveLength(2);
	});

	it("loads a fresh context after the previous one was lost", () => {
		const id = freshId();
		create(id);
		attach(id, slot);

		webglState.instances[0].loseContext();
		attach(id, slot);

		expect(webglState.dispose).toHaveBeenCalledTimes(1);
		expect(webglState.instances).toHaveLength(2);
	});

	it("stays on the DOM renderer when WebGL is unsupported", () => {
		webglState.isUnsupported = true;
		const id = freshId();
		create(id);

		expect(() => attach(id, slot)).not.toThrow();

		expect(webglState.instances).toHaveLength(2);
		expect(webglState.dispose).not.toHaveBeenCalled();
	});
});

describe("theme observer", () => {
	afterEach(() => {
		document.documentElement.removeAttribute("style");
	});

	it("repaints once for several mutations within a frame", async () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		const term = fitted.term as Terminal;
		const themes: unknown[] = [];
		let current = term.options.theme;
		Object.defineProperty(term.options, "theme", {
			get: () => current,
			set: (value) => {
				current = value;
				themes.push(value);
			},
			configurable: true,
		});

		document.documentElement.style.setProperty("--accent", "red");
		await Promise.resolve();
		document.documentElement.style.setProperty("--accent", "blue");
		await Promise.resolve();
		vi.advanceTimersByTime(20);

		expect(themes).toHaveLength(1);
	});

	it("keeps the font and skips the refit when the font is unchanged", async () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		const term = fitted.term as Terminal;
		document.documentElement.style.setProperty("--font-mono", "Mono A");
		await Promise.resolve();
		vi.advanceTimersByTime(20);
		expect(term.options.fontFamily).toBe("Mono A");
		fitSpy.mockClear();

		document.documentElement.style.setProperty("--accent", "red");
		await Promise.resolve();
		vi.advanceTimersByTime(20);

		expect(term.options.fontFamily).toBe("Mono A");
		expect(fitSpy).not.toHaveBeenCalled();
	});
});

describe("theme without a document", () => {
	it("falls back to the built-in palette and font stack", async () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		const term = fitted.term as Terminal;

		document.documentElement.style.setProperty("--accent", "red");
		await Promise.resolve();
		vi.stubGlobal("document", undefined);
		try {
			vi.advanceTimersByTime(20);
		} finally {
			vi.unstubAllGlobals();
		}

		expect(term.options.theme?.background).toBe("#161616");
		expect(term.options.theme?.cursor).toBe("#6c8eff");
		expect(term.options.fontFamily).toBe(
			"'JetBrains Mono', 'Fira Code', monospace",
		);
	});
});

describe("theme probe", () => {
	it("measures colours through a probe element it cleans up", () => {
		const append = vi.spyOn(document.body, "appendChild");
		const id = freshId();
		create(id);

		attach(id, slot);

		const probes = append.mock.calls
			.map(([node]) => node)
			.filter(
				(node): node is HTMLSpanElement => node instanceof HTMLSpanElement,
			);
		expect(probes.length).toBeGreaterThan(0);
		expect(document.body.querySelectorAll(":scope > span")).toHaveLength(0);
	});

	it("hands xterm the colour the variable resolved to", () => {
		const id = freshId();
		create(id);

		attach(id, slot);

		expect((fitted.term as Terminal).options.theme).toMatchObject({
			background: "var(--bg-0)",
			foreground: "var(--fg-0)",
			cursor: "var(--accent)",
		});
	});

	it("falls back to the built-in colour when the variable resolves to nothing", () => {
		const real = window.getComputedStyle.bind(window);
		vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
			const style = real(el, pseudo);
			return el instanceof HTMLSpanElement
				? ({ color: "" } as CSSStyleDeclaration)
				: style;
		});
		const id = freshId();
		create(id);

		attach(id, slot);

		expect((fitted.term as Terminal).options.theme?.background).toBe("#161616");
	});
});

describe("exit subscription", () => {
	it("tells the handler which terminal ended, until it unsubscribes", () => {
		const handler = vi.fn();
		const unsubscribe = onTerminalExit(handler);

		listeners["terminal-exit"]({ payload: { id: "gone", exitCode: 2 } });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ id: "gone", exitCode: 2 });

		unsubscribe();
		listeners["terminal-exit"]({ payload: { id: "gone", exitCode: 0 } });
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

describe("repaint after a blind fit", () => {
	it("repaints every row when the slot had no width", () => {
		const refresh = vi.spyOn(Terminal.prototype, "refresh");
		const id = freshId();
		create(id);

		attach(id, slot);
		vi.advanceTimersByTime(20);

		expect(refresh).toHaveBeenCalled();
		for (const call of refresh.mock.calls) expect(call).toEqual([0, 23]);
	});

	it("does not repaint when the terminal already had a width", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		const element = (fitted.term as Terminal).element as HTMLElement;
		Object.defineProperty(element, "clientWidth", {
			value: 640,
			configurable: true,
		});
		const refresh = vi.spyOn(Terminal.prototype, "refresh");

		refit(id);
		vi.advanceTimersByTime(20);

		expect(fitSpy).toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("repaints the screen restored from the backlog row for row", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		detach(id);
		const write = vi.spyOn(Terminal.prototype, "write");
		attach(id, slot);
		const [, onWritten] = write.mock.calls[0] as unknown as [
			string,
			() => void,
		];
		const refresh = vi.spyOn(Terminal.prototype, "refresh");

		onWritten();

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith(0, 23);
	});
});

describe("theme font change", () => {
	afterEach(() => {
		document.documentElement.removeAttribute("style");
	});

	it("refits the terminal once the font family changed", async () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		fitSpy.mockClear();

		document.documentElement.style.setProperty("--font-mono", "Mono B");
		await Promise.resolve();
		vi.advanceTimersByTime(20);

		expect(fitSpy).toHaveBeenCalled();
	});
});

describe("write queue", () => {
	it("keeps a later write behind one still in flight after an earlier one finished", async () => {
		const id = freshId();
		let releaseSecond: () => void = () => {};
		writeToTerminal
			.mockImplementationOnce(() => Promise.resolve())
			.mockImplementationOnce(
				() => new Promise<void>((resolve) => (releaseSecond = resolve)),
			);

		paste(id, "first");
		paste(id, "second");
		await vi.advanceTimersByTimeAsync(0);
		paste(id, "third");
		await vi.advanceTimersByTimeAsync(0);
		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual([
			"first",
			"second",
		]);

		releaseSecond();
		await vi.runAllTimersAsync();
		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	it("forgets what was queued for a terminal when it is disposed", async () => {
		const id = freshId();
		create(id);
		writeToTerminal.mockImplementationOnce(() => new Promise<void>(() => {}));

		paste(id, "stuck");
		await vi.advanceTimersByTimeAsync(0);
		dispose(id);
		paste(id, "after");
		await vi.advanceTimersByTimeAsync(0);

		expect(writeToTerminal.mock.calls.map((c) => c[1])).toEqual([
			"stuck",
			"after",
		]);
	});
});

describe("renderer wiring", () => {
	it("registers the WebGL addon with the terminal", () => {
		const loadAddon = vi.spyOn(Terminal.prototype, "loadAddon");
		const id = freshId();
		create(id);

		attach(id, slot);

		expect(loadAddon).toHaveBeenCalledWith(webglState.instances[0]);
	});

	it("ignores the loss of a context that was already replaced", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const [first] = webglState.instances;

		first.loseContext();
		attach(id, slot);
		expect(webglState.instances).toHaveLength(2);
		first.loseContext();
		attach(id, slot);

		expect(webglState.instances).toHaveLength(2);
	});
});

describe("terminal wiring", () => {
	it("loads the serialize addon so the screen can be hibernated", () => {
		const loadAddon = vi.spyOn(Terminal.prototype, "loadAddon");
		const id = freshId();
		create(id);

		attach(id, slot);

		const loaded = loadAddon.mock.calls.map(([addon]) => addon);
		expect(
			loaded.some(
				(addon) =>
					(addon as { serialize?: unknown }).serialize === serializeSpy,
			),
		).toBe(true);
	});

	it("installs the clipboard key handler, which lets other keys through", () => {
		const install = vi.spyOn(Terminal.prototype, "attachCustomKeyEventHandler");
		const id = freshId();
		create(id);

		attach(id, slot);

		expect(install).toHaveBeenCalledTimes(1);
		const handler = install.mock.calls[0][0];
		expect(handler(new KeyboardEvent("keyup", { key: "c" }))).toBe(true);
	});

	it("registers a link provider that offers nothing on a plain line", () => {
		const register = vi.spyOn(Terminal.prototype, "registerLinkProvider");
		const id = freshId();
		create(id);

		attach(id, slot);

		expect(register).toHaveBeenCalledTimes(1);
		const provider = register.mock.calls[0][0];
		const callback = vi.fn();
		provider.provideLinks(1, callback);
		expect(callback).toHaveBeenCalledWith(undefined);
	});

	it("sends what the user types to the PTY", async () => {
		const id = freshId();
		create(id);
		attach(id, slot);

		(fitted.term as Terminal).input("a");
		await vi.runAllTimersAsync();

		expect(writeToTerminal).toHaveBeenCalledWith(id, "a");
	});

	it("claims the backlog on wake so a later hibernation does not stack it", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		detach(id);
		emitOutput(id, "while away");
		attach(id, slot);
		detach(id);
		const write = vi.spyOn(Terminal.prototype, "write");

		attach(id, slot);

		expect(write).toHaveBeenCalledWith("SCREEN", expect.any(Function));
	});

	it("keeps the helper textarea empty between keystrokes", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const textarea = slot.querySelector(
			".xterm-helper-textarea",
		) as HTMLTextAreaElement;

		textarea.value = "typed so far";
		textarea.dispatchEvent(new Event("input"));
		vi.advanceTimersByTime(20);

		expect(textarea.value).toBe("");
	});

	it("observes its host and refits when it is resized", () => {
		const observe = vi.fn();
		let onResize: () => void = () => {};
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					onResize = callback;
				}
				observe = observe;
				disconnect() {}
				unobserve() {}
			},
		);
		try {
			const id = freshId();
			create(id);
			attach(id, slot);
			vi.advanceTimersByTime(20);
			fitSpy.mockClear();

			expect(observe).toHaveBeenCalledWith(slot.firstElementChild);
			onResize();
			vi.advanceTimersByTime(20);
			expect(fitSpy).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("attach when already in place", () => {
	it("neither reopens xterm nor moves the host", () => {
		const open = vi.spyOn(Terminal.prototype, "open");
		const id = freshId();
		create(id);
		attach(id, slot);
		const replaceChildren = vi.spyOn(slot, "replaceChildren");

		attach(id, slot);

		expect(open).toHaveBeenCalledTimes(1);
		expect(replaceChildren).not.toHaveBeenCalled();
	});
});

describe("detach teardown", () => {
	it("disposes the xterm instance and empties the host itself", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		const host = slot.firstElementChild as HTMLElement;
		const disposeTerm = vi
			.spyOn(Terminal.prototype, "dispose")
			.mockImplementation(() => {});

		detach(id);

		expect(disposeTerm).toHaveBeenCalledTimes(1);
		expect(host.childElementCount).toBe(0);
	});
});

describe("refit scheduling", () => {
	it("asks for a single frame however many refits are requested", () => {
		const id = freshId();
		create(id);
		attach(id, slot);
		vi.advanceTimersByTime(20);
		const frame = vi.spyOn(window, "requestAnimationFrame");

		refit(id);
		refit(id);
		refit(id);

		expect(frame).toHaveBeenCalledTimes(1);
	});
});
