// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { IS_MAC } from "#lib/utils/platform";

// The webview's own undo stack is unreliable: there is no Edit menu to route
// it on Linux and Windows, and a value written back by a Svelte binding wipes it
// everywhere. Cairn keeps the history of every text field itself. CodeMirror has
// its own history and is left alone.

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Snapshot {
	value: string;
	start: number;
	end: number;
}

interface History {
	stack: Snapshot[];
	index: number;
	lastInputAt: number;
}

const COALESCE_MS = 600;
const MAX_ENTRIES = 200;
const TEXT_INPUT_TYPES = new Set([
	"text",
	"search",
	"url",
	"email",
	"tel",
	"password",
	"number",
	"",
]);

const histories = new WeakMap<Field, History>();
let isReplaying = false;

function asField(target: EventTarget | null): Field | null {
	const el = target as HTMLElement | null;
	if (!el || el.closest?.(".cm-editor")) return null;
	if (el instanceof HTMLTextAreaElement) return el;
	if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type))
		return el;
	return null;
}

function snapshot(el: Field): Snapshot {
	const start = safeSelection(() => el.selectionStart) ?? el.value.length;
	const end = safeSelection(() => el.selectionEnd) ?? start;
	return { value: el.value, start, end };
}

function safeSelection(read: () => number | null): number | null {
	try {
		return read();
	} catch {
		return null;
	}
}

/** Seeds the history, or records a value set by code since the last edit. */
function sync(el: Field): History {
	let h = histories.get(el);
	if (!h) {
		h = { stack: [snapshot(el)], index: 0, lastInputAt: 0 };
		histories.set(el, h);
	} else if (h.stack[h.index].value !== el.value) {
		push(h, snapshot(el));
		h.lastInputAt = 0;
	}
	return h;
}

function push(h: History, entry: Snapshot) {
	h.stack.length = h.index + 1;
	h.stack.push(entry);
	if (h.stack.length > MAX_ENTRIES) h.stack.shift();
	h.index = h.stack.length - 1;
}

function onFocusIn(e: FocusEvent) {
	const el = asField(e.target);
	if (el) sync(el);
}

function onBeforeInput(e: Event) {
	const el = asField(e.target);
	if (el && !isReplaying) sync(el);
}

function onInput(e: Event) {
	const el = asField(e.target);
	if (!el || isReplaying) return;
	const h = histories.get(el);
	if (!h) return;
	const now = Date.now();
	const isTyping = (e as InputEvent).inputType === "insertText";
	if (isTyping && h.index > 0 && now - h.lastInputAt < COALESCE_MS) {
		h.stack.length = h.index + 1;
		h.stack[h.index] = snapshot(el);
	} else {
		push(h, snapshot(el));
	}
	h.lastInputAt = isTyping ? now : 0;
}

function restore(el: Field, entry: Snapshot) {
	isReplaying = true;
	try {
		el.value = entry.value;
		safeSelection(() => {
			el.setSelectionRange(entry.start, entry.end);
			return null;
		});
		el.dispatchEvent(new Event("input", { bubbles: true }));
	} finally {
		isReplaying = false;
	}
}

function onKeyDown(e: KeyboardEvent) {
	const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if (!mod || e.altKey) return;
	const key = e.key.toLowerCase();
	const isUndo = key === "z" && !e.shiftKey;
	const isRedo = (key === "z" && e.shiftKey) || (!IS_MAC && key === "y");
	if (!isUndo && !isRedo) return;
	const el = asField(document.activeElement);
	if (!el || el.readOnly || el.disabled) return;

	e.preventDefault();
	const h = sync(el);
	h.lastInputAt = 0;
	const next = h.index + (isUndo ? -1 : 1);
	if (next < 0 || next >= h.stack.length) return;
	h.index = next;
	restore(el, h.stack[next]);
}

/** Installs the undo/redo handling of every text field; returns its teardown. */
export function installFieldUndoHandler(): () => void {
	document.addEventListener("focusin", onFocusIn, true);
	document.addEventListener("beforeinput", onBeforeInput, true);
	document.addEventListener("input", onInput, true);
	window.addEventListener("keydown", onKeyDown, true);
	return () => {
		document.removeEventListener("focusin", onFocusIn, true);
		document.removeEventListener("beforeinput", onBeforeInput, true);
		document.removeEventListener("input", onInput, true);
		window.removeEventListener("keydown", onKeyDown, true);
	};
}
