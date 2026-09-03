// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { osDropPoint } from "$lib/utils/files/files-editor-drop";
import { IS_MAC } from "$lib/utils/platform";
import "@xterm/xterm/css/xterm.css";
import {
	resizeTerminal,
	writeToTerminal,
} from "$lib/services/terminal-service";

// The terminals, kept outside the component tree so one survives switching
// view. Only a terminal on screen holds an xterm instance: the others are
// hibernated as a serialized screen, and whatever the PTY prints meanwhile is
// kept as raw text and replayed on the next attach - no VT parsing, no DOM
// and no GPU context for something nobody is looking at.

/** One terminal: live (`term`) when attached, otherwise `frozen` holds its state. */
interface ManagedTerminal {
	term: Terminal | null;
	fit: FitAddon | null;
	serialize: SerializeAddon | null;
	el: HTMLDivElement;
	webgl: WebglAddon | null;
	observer: ResizeObserver | null;
	frozen: string;
	cols: number;
	rows: number;
}

/** What a hibernated terminal keeps of its output: the newest bytes, up to this many. */
export const FROZEN_MAX = 1_000_000;

const managed = new Map<string, ManagedTerminal>();

const FALLBACK_FONT = "'JetBrains Mono', 'Fira Code', monospace";

/** Resolves a CSS colour variable through a probe element, since xterm needs
 * a concrete colour rather than a `var()` reference. */
function cssVar(name: string, fallback: string): string {
	if (typeof document === "undefined") return fallback;
	const probe = document.createElement("span");
	probe.style.color = `var(${name})`;
	probe.style.display = "none";
	document.body.appendChild(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color || fallback;
}

// cssVar resolves through style.color, so it only ever returns a colour: asking
// it for a font stack yields the initial "rgb(0, 0, 0)", never the real value.
function cssFontVar(name: string, fallback: string): string {
	if (typeof document === "undefined") return fallback;
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

/** The xterm palette, taken from the app theme currently applied. */
function buildTheme() {
	return {
		background: cssVar("--bg-0", "#161616"),
		foreground: cssVar("--fg-0", "#e6e6e6"),
		cursor: cssVar("--accent", "#6c8eff"),
		cursorAccent: cssVar("--bg-0", "#161616"),
		selectionBackground: cssVar("--accent-weak", "rgba(108,142,255,0.3)"),
	};
}

/** Refits to the slot; a terminal in a hidden view has no size to fit to. */
function refitTerminal(m: ManagedTerminal): void {
	if (!m.fit) return;
	const wasBlind = m.term?.element?.clientWidth === 0;
	try {
		m.fit.fit();
	} catch {
		// Slot has no layout yet (hidden view); ignore until it is shown.
		return;
	}
	// fit() is a no-op when the size did not change, so a terminal that opened
	// against a zero-sized slot would keep the blank canvas it rendered into.
	if (wasBlind && m.term) m.term.refresh(0, m.term.rows - 1);
}

/** Repaints every terminal after a theme change, refitting only on a font change. */
function applyTheme(): void {
	const theme = buildTheme();
	const fontFamily = cssFontVar("--font-mono", FALLBACK_FONT);
	for (const m of managed.values()) {
		if (!m.term) continue;
		m.term.options.theme = theme;
		if (m.term.options.fontFamily !== fontFamily) {
			m.term.options.fontFamily = fontFamily;
			refitTerminal(m);
		}
	}
}

/**
 * `style` has to be watched alongside `data-theme`: the accent and the font are
 * custom properties on the root, not part of the theme attribute. A settings
 * change writes several of them in a row, so the callback is coalesced onto a
 * frame rather than repainting every terminal once per property.
 */
let themeObserver: MutationObserver | null = null;
let themeFrame = 0;

if (typeof document !== "undefined") {
	themeObserver = new MutationObserver(() => {
		if (themeFrame) return;
		themeFrame = requestAnimationFrame(() => {
			themeFrame = 0;
			applyTheme();
		});
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "style"],
	});
}

const isMac = IS_MAC;

/**
 * Returns false to swallow the key. Only copy is intercepted: Ctrl+V and the
 * rest must reach the shell, and on macOS Cmd+C would otherwise be sent as a
 * control sequence instead of copying the selection.
 */
function handleClipboardKey(term: Terminal, e: KeyboardEvent): boolean {
	if (e.type !== "keydown") return true;
	const copyCombo = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
	if (!copyCombo) return true;

	if (e.key.toLowerCase() === "c") {
		const selection = term.getSelection();
		if (!selection) return true;
		void writeText(selection);
		return false;
	}
	return true;
}

/** A PTY that ended; `exitCode` is null when it was killed by a signal. */
export interface TerminalExit {
	id: string;
	exitCode: number | null;
}

const exitHandlers = new Set<(exit: TerminalExit) => void>();

/** Subscribes to PTY exits, returning the unsubscribe. */
export function onTerminalExit(
	handler: (exit: TerminalExit) => void,
): () => void {
	exitHandlers.add(handler);
	return () => exitHandlers.delete(handler);
}

const listenersReady: Promise<UnlistenFn[]> = Promise.all([
	listen<{ id: string; data: string }>("terminal-output", (e) => {
		onOutput?.(e.payload.id);
		write(e.payload.id, e.payload.data);
	}),
	listen<TerminalExit>("terminal-exit", (e) => {
		const { exitCode } = e.payload;
		const label =
			exitCode === null || exitCode === 0
				? "[process exited]"
				: `[process exited with code ${exitCode}]`;
		write(e.payload.id, `\r\n\x1b[2m${label}\x1b[0m\r\n`);
		for (const handler of exitHandlers) handler(e.payload);
	}),
]);
void listenersReady;

/** Quotes a dropped path so a shell receives it as one argument. */
function quotePath(p: string): string {
	return /\s/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

if (typeof window !== "undefined") {
	void getCurrentWebview().onDragDropEvent((event) => {
		if (event.payload.type !== "drop") return;
		const { paths, position } = event.payload;
		if (!paths.length) return;
		const { x, y } = osDropPoint(
			position,
			{ width: window.innerWidth, height: window.innerHeight },
			window.devicePixelRatio || 1,
		);
		for (const [id, m] of managed) {
			const r = m.el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
				m.term?.focus();
				void writeToTerminal(id, paths.map(quotePath).join(" "));
				return;
			}
		}
	});
}

// One pending-write chain per terminal. A composed character ends the
// composition from a timer while ordinary keys emit synchronously, so two
// `onData` calls can be issued back to back; unawaited `invoke()` calls have no
// ordering guarantee and would reach the PTY out of order.
const writeQueues = new Map<string, Promise<void>>();

/**
 * Told about every byte typed into a terminal, before it reaches the PTY. The
 * Agent step uses it to name a conversation from its first prompt; nothing else
 * listens, and nothing ever reads the output side.
 */
let onInput: ((id: string, data: string) => void) | null = null;

/** Registers the input observer; passing null removes it. */
export function observeInput(
	fn: ((id: string, data: string) => void) | null,
): void {
	onInput = fn;
}

/**
 * Told that a terminal produced output, without being told what. The Agent step
 * uses it to know a CLI is still doing something; the bytes themselves are not
 * passed on, because nothing in Cairn reads them.
 */
let onOutput: ((id: string) => void) | null = null;

/** Registers the output observer; passing null removes it. */
export function observeOutput(fn: ((id: string) => void) | null): void {
	onOutput = fn;
}

/** Queues a PTY write behind the ones already in flight for that terminal. */
function enqueueWrite(id: string, data: string): void {
	onInput?.(id, data);
	const pending = writeQueues.get(id) ?? Promise.resolve();
	const next = pending.then(() => writeToTerminal(id, data)).catch(() => {});
	writeQueues.set(id, next);
	void next.then(() => {
		if (writeQueues.get(id) === next) writeQueues.delete(id);
	});
}

/**
 * The DOM renderer repaints every cell as an element and cannot keep up with a
 * verbose build. WebGL is loaded on top of it and takes over; if the context is
 * lost (GPU reset, driver hiccup) the addon disposes itself and xterm silently
 * falls back to the DOM renderer, so there is nothing to rebuild.
 *
 * Only terminals on screen hold a context: WebKit caps active contexts at
 * about sixteen and evicts the oldest, which used to hit exactly the hidden
 * terminals still scrolling in the background.
 */
function loadRenderer(m: ManagedTerminal): void {
	if (m.webgl || !m.term) return;
	try {
		const webgl = new WebglAddon();
		webgl.onContextLoss(() => {
			webgl.dispose();
			if (m.webgl === webgl) m.webgl = null;
		});
		m.term.loadAddon(webgl);
		m.webgl = webgl;
	} catch {
		// No WebGL in this webview; the DOM renderer stays in place.
	}
}

function unloadRenderer(m: ManagedTerminal): void {
	m.webgl?.dispose();
	m.webgl = null;
}

/** Writes PTY output to the live instance, or keeps it for the next attach. */
function write(id: string, data: string): void {
	const m = managed.get(id);
	if (!m) return;
	if (m.term) {
		m.term.write(data);
		return;
	}
	setFrozen(m, m.frozen + data);
}

/** Keeps the newest `FROZEN_MAX` characters of a hibernated terminal's backlog. */
export function capFrozen(text: string): string {
	return text.length > FROZEN_MAX ? text.slice(-FROZEN_MAX) : text;
}

/** The one writer of `frozen`, so the cap cannot be bypassed by a new caller. */
function setFrozen(m: ManagedTerminal, text: string): void {
	m.frozen = capFrozen(text);
}

/** Registers a terminal; its xterm instance is only built on the first attach. */
export function create(id: string): void {
	if (managed.has(id)) return;
	const el = document.createElement("div");
	el.className = "terminal-host";
	managed.set(id, {
		term: null,
		fit: null,
		serialize: null,
		el,
		webgl: null,
		observer: null,
		frozen: "",
		cols: 80,
		rows: 24,
	});
}

/** Builds the xterm instance of a terminal and wires its I/O. */
function wake(id: string, m: ManagedTerminal): void {
	const term = new Terminal({
		fontFamily: cssFontVar("--font-mono", FALLBACK_FONT),
		fontSize: 12.5,
		cursorBlink: true,
		scrollback: 2000,
		allowProposedApi: true,
		theme: buildTheme(),
	});
	const fit = new FitAddon();
	term.loadAddon(fit);

	const unicode11 = new Unicode11Addon();
	term.loadAddon(unicode11);
	term.unicode.activeVersion = "11";
	const serialize = new SerializeAddon();
	term.loadAddon(serialize);

	term.attachCustomKeyEventHandler((e) => handleClipboardKey(term, e));

	term.onData((data) => {
		enqueueWrite(id, data);
	});
	term.onResize(({ cols, rows }) => {
		m.cols = cols;
		m.rows = rows;
		void resizeTerminal(id, cols, rows);
	});

	// Claim the backlog before `m.term` goes live: once it is set, write() routes
	// straight to the instance, and output arriving here would be replayed over
	// by the frozen screen. Writing before the fit is also the right order --
	// xterm reflows its buffer on resize, whereas fitting first replays the old
	// absolute cursor positioning into a new grid.
	const backlog = m.frozen;
	setFrozen(m, "");
	m.term = term;
	m.fit = fit;
	m.serialize = serialize;
	term.open(m.el);
	if (backlog) term.write(backlog);
	refitTerminal(m);

	// A slot with no layout yet makes fit() throw, which leaves xterm at its
	// 80x24 default with nothing to bring it back: the pane stays blank and the
	// PTY keeps the wrong size. Observing the host gives it that second chance.
	m.observer = new ResizeObserver(() => refit(id));
	m.observer.observe(m.el);
}

/**
 * Moves the existing element into `slot`, opening xterm on first attach only.
 *
 * Focus is only taken when the terminal actually moved into the slot. The
 * caller is a reactive effect that re-runs on unrelated store writes, and a
 * `focus()` landing between `compositionstart` and `compositionend` makes xterm
 * blur-clear its helper textarea, which desynchronises the composition offsets
 * and duplicates or scrambles dead-key input (`^` then `a`) on Linux.
 */
export function attach(id: string, slot: HTMLElement): void {
	const m = managed.get(id);
	if (!m) return;
	const moved = slot.firstChild !== m.el;
	if (moved) slot.replaceChildren(m.el);
	if (!m.term) wake(id, m);
	loadRenderer(m);
	refit(id);
	if (moved) requestAnimationFrame(() => m.term?.focus());
}

/** Hibernates a terminal that left the screen: its screen and scrollback become a string, the instance goes. */
export function detach(id: string): void {
	const m = managed.get(id);
	if (!m?.term) return;
	unloadRenderer(m);
	m.observer?.disconnect();
	m.observer = null;
	setFrozen(m, (m.serialize?.serialize({ scrollback: 2000 }) ?? "") + m.frozen);
	m.term.dispose();
	m.term = null;
	m.fit = null;
	m.serialize = null;
	m.el.replaceChildren();
}

const pendingRefits = new Set<string>();
let refitFrame = 0;

/** Recomputes rows and columns from the current slot size, once per frame. */
export function refit(id: string): void {
	pendingRefits.add(id);
	if (refitFrame) return;
	refitFrame = requestAnimationFrame(() => {
		refitFrame = 0;
		for (const pending of pendingRefits) {
			const m = managed.get(pending);
			if (m) refitTerminal(m);
		}
		pendingRefits.clear();
	});
}

/** Gives the terminal keyboard focus. */
/**
 * Types text into a terminal as if the user had typed it, newlines stripped so
 * it lands in the prompt without submitting it. Goes through the same queue as
 * the keyboard, so it cannot overtake what is already in flight.
 */
export function paste(id: string, text: string): void {
	const typed = text.replace(/\r?\n/g, " ").trim();
	if (typed) enqueueWrite(id, typed);
}

export function focus(id: string): void {
	managed.get(id)?.term?.focus();
}

/** Current dimensions, falling back to 80x24 for an unknown id. */
export function size(id: string): { cols: number; rows: number } {
	const m = managed.get(id);
	return m ? { cols: m.cols, rows: m.rows } : { cols: 80, rows: 24 };
}

/** Tears the terminal down and forgets it. */
export function dispose(id: string): void {
	const m = managed.get(id);
	if (!m) return;
	m.observer?.disconnect();
	m.term?.dispose();
	m.el.remove();
	managed.delete(id);
	pendingRefits.delete(id);
	writeQueues.delete(id);
}
