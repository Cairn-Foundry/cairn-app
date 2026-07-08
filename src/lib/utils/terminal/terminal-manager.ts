import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
	resizeTerminal,
	writeToTerminal,
} from "$lib/services/terminal-service";

interface ManagedTerminal {
	term: Terminal;
	fit: FitAddon;
	el: HTMLDivElement;
	opened: boolean;
}

const managed = new Map<string, ManagedTerminal>();

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

function buildTheme() {
	return {
		background: cssVar("--bg-0", "#161616"),
		foreground: cssVar("--fg-0", "#e6e6e6"),
		cursor: cssVar("--accent", "#6c8eff"),
		cursorAccent: cssVar("--bg-0", "#161616"),
		selectionBackground: cssVar("--accent-weak", "rgba(108,142,255,0.3)"),
	};
}

const listenersReady: Promise<UnlistenFn[]> = Promise.all([
	listen<{ id: string; data: string }>("terminal-output", (e) => {
		managed.get(e.payload.id)?.term.write(e.payload.data);
	}),
	listen<{ id: string }>("terminal-exit", (e) => {
		managed
			.get(e.payload.id)
			?.term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
	}),
]);
void listenersReady;

export function create(id: string): void {
	if (managed.has(id)) return;

	const term = new Terminal({
		fontFamily:
			cssVar("--font-mono", "").trim() ||
			"'JetBrains Mono', 'Fira Code', monospace",
		fontSize: 12.5,
		cursorBlink: true,
		scrollback: 5000,
		theme: buildTheme(),
	});
	const fit = new FitAddon();
	term.loadAddon(fit);

	const el = document.createElement("div");
	el.className = "terminal-host";

	term.onData((data) => {
		void writeToTerminal(id, data);
	});
	term.onResize(({ cols, rows }) => {
		void resizeTerminal(id, cols, rows);
	});

	managed.set(id, { term, fit, el, opened: false });
}

export function attach(id: string, slot: HTMLElement): void {
	const m = managed.get(id);
	if (!m) return;
	if (slot.firstChild !== m.el) slot.replaceChildren(m.el);
	if (!m.opened) {
		m.term.open(m.el);
		m.opened = true;
	}
	requestAnimationFrame(() => {
		refit(id);
		m.term.focus();
	});
}

export function refit(id: string): void {
	const m = managed.get(id);
	if (!m?.opened) return;
	try {
		m.fit.fit();
	} catch {
		// Slot has no layout yet (hidden view); ignore until it is shown.
	}
}

export function focus(id: string): void {
	managed.get(id)?.term.focus();
}

export function size(id: string): { cols: number; rows: number } {
	const m = managed.get(id);
	return m ? { cols: m.term.cols, rows: m.term.rows } : { cols: 80, rows: 24 };
}

export function dispose(id: string): void {
	const m = managed.get(id);
	if (!m) return;
	m.term.dispose();
	m.el.remove();
	managed.delete(id);
}
