import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHORTCUT_DEFS } from "$lib/stores/shortcuts";
import { SHORTCUT_COMMANDS } from "$lib/utils/editor/editor-extensions";

/**
 * Every declared shortcut must be reachable, and the two entry points - a key
 * press and the command palette - both land in the same place. A ShortcutId
 * that no switch handles is a binding the settings screen still offers and
 * nothing answers; the symptom is a shortcut that silently does nothing.
 *
 * This is read from the source rather than executed: Workspace and FilesView
 * are the two heaviest components of the app, and mounting either to learn
 * which ids they name would cost far more than reading their switch.
 */
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");

const workspace = read("../lib/components/Workspace.svelte");
const filesView = read("../lib/components/files/FilesView.svelte");

/** The ids the workspace claims the key press for. */
const appActions = (
	workspace.match(/const APP_ACTIONS: ShortcutId\[\] = \[([^\]]*)\]/s)?.[1] ??
	""
)
	.split(",")
	.map((s) => s.trim().replace(/^'|'$/g, ""))
	.filter(Boolean);

/** The ids a switch answers with a case of its own, read to its closing brace. */
function casesOf(source: string, fn: string): string[] {
	const start = source.indexOf(fn);
	expect(start, `${fn} not found`).toBeGreaterThan(-1);
	const open = source.indexOf("switch", start);
	let depth = 0;
	let end = open;
	for (let i = source.indexOf("{", open); i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) {
			end = i;
			break;
		}
	}
	return Array.from(
		source.slice(open, end).matchAll(/case '([A-Za-z]+)':/g),
		(m) => m[1],
	);
}

const workspaceCases = casesOf(workspace, "async function runAction");
const filesCases = casesOf(filesView, "export async function executeAction");
/** The third target: editing commands bound straight into the CodeMirror keymap. */
const editorCases = SHORTCUT_COMMANDS.map((c) => c.id);

describe("shortcut routing", () => {
	it("declares at least one shortcut to route", () => {
		expect(SHORTCUT_DEFS.length).toBeGreaterThan(0);
		expect(appActions.length).toBeGreaterThan(0);
	});

	it("handles every keyboard shortcut somewhere", () => {
		const handled = new Set([...workspaceCases, ...filesCases, ...editorCases]);
		const orphans = SHORTCUT_DEFS.filter(
			(d) => !d.mouse && !handled.has(d.id),
		).map((d) => d.id);
		expect(orphans).toEqual([]);
	});

	/**
	 * A mouse shortcut is matched on a click in the editor, not by a switch, so
	 * it is the one kind that legitimately answers to neither.
	 */
	it("routes the mouse shortcuts through the editor's click handling", () => {
		const mouseIds = SHORTCUT_DEFS.filter((d) => d.mouse).map((d) => d.id);
		expect(mouseIds.length).toBeGreaterThan(0);
		const editor = read("../lib/components/files/CodeEditor.svelte");
		for (const id of mouseIds) {
			expect(editor, id).toContain(`$activeShortcuts.${id}`);
		}
	});

	/**
	 * runAction falls through to FilesView by default, so an id the workspace
	 * claims the key for but neither switch answers is swallowed entirely.
	 */
	it("answers every app action it claims the key press for", () => {
		const handled = new Set([...workspaceCases, ...filesCases]);
		const unclaimed = appActions.filter((id) => !handled.has(id));
		expect(unclaimed).toEqual([]);
	});

	it("claims a key only for ids that are real shortcuts", () => {
		const declared = new Set<string>(SHORTCUT_DEFS.map((d) => d.id));
		const unknown = appActions.filter((id) => !declared.has(id));
		expect(unknown).toEqual([]);
	});

	it("routes each shortcut to a single owner, never to two", () => {
		const owners = [workspaceCases, filesCases, editorCases];
		for (let i = 0; i < owners.length; i++) {
			for (let j = i + 1; j < owners.length; j++) {
				expect(owners[i].filter((id) => owners[j].includes(id))).toEqual([]);
			}
		}
	});

	it("names each id once in the switch that owns it", () => {
		for (const cases of [workspaceCases, filesCases, editorCases]) {
			expect(new Set(cases).size).toBe(cases.length);
		}
	});

	/** The palette calls runAction, the same function a key press does. */
	it("sends the palette through the same routing as a key press", () => {
		expect(workspace).toMatch(/onAction=\{[^}]*runAction\(id\)/s);
	});

	it("gives every shortcut a group, and a key when it ships bound", () => {
		for (const def of SHORTCUT_DEFS) {
			expect(def.group, def.id).toBeTruthy();
			if (def.default !== null) expect(def.default.key, def.id).toBeTruthy();
		}
	});

	/** An editing command only fires with a document focused, so it binds a key. */
	it("binds every editing command to a key", () => {
		const byId = new Map(SHORTCUT_DEFS.map((d) => [d.id, d]));
		for (const id of editorCases) {
			expect(byId.get(id), id).toBeTruthy();
		}
	});
});
