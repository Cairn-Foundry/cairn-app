// CLAUDE.md requires four layers for a view to survive a restart: the ui store
// flag, the field on ProjectUiState, the snapshot and the restore, and the Rust
// field plus its persist subscription. Skipping any one of them reads as "the
// app forgot where I was", and nothing at runtime complains. These tests read
// the four layers off disk and confront them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (...parts: string[]) =>
	readFileSync(join(ROOT, ...parts), "utf-8");

const uiStore = read("src", "lib", "stores", "ui.ts");
const viewState = read("src", "lib", "stores", "view-state.ts");
const uiService = read("src", "lib", "services", "ui-state-service.ts");
const page = read("src", "routes", "+page.svelte");
const rust = read("src-tauri", "src", "commands", "ui_state.rs");

/** The fields ProjectUiState declares on the TypeScript side. */
function tsFields(): string[] {
	const block = /export interface ProjectUiState \{([\s\S]*?)\n\}/.exec(
		uiService,
	);
	if (!block)
		throw new Error("ProjectUiState not found in ui-state-service.ts");
	return block[1]
		.split("\n")
		.map((line) => /^\s*([A-Za-z_$][\w$]*)\??\s*:/.exec(line)?.[1])
		.filter((v): v is string => Boolean(v));
}

/** The names the Rust struct serializes to, read off its serde renames. */
function rustFields(): string[] {
	const block = /pub struct ProjectUiState \{([\s\S]*?)\n\}/.exec(rust);
	if (!block) throw new Error("ProjectUiState not found in ui_state.rs");
	return [...block[1].matchAll(/#\[serde\(rename = "(\w+)"/g)].map((m) => m[1]);
}

/** The fields snapshotCurrentProject() copies out of the ui stores. */
function snapshotFields(): string[] {
	const block =
		/export function snapshotCurrentProject\(\): void \{([\s\S]*?)\n\}/.exec(
			viewState,
		);
	if (!block) throw new Error("snapshotCurrentProject not found");
	return [...block[1].matchAll(/^\t\t(\w+):\s*get\(/gm)].map((m) => m[1]);
}

/** The stores subscribed to so a change reaches the ui state file. */
function persistedStores(): string[] {
	const block = /const persistSubscriptions = \[([\s\S]*?)\]\.map/.exec(page);
	if (!block) throw new Error("persistSubscriptions not found in +page.svelte");
	return block[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

const TS = tsFields();
const RUST = rustFields();
const SNAPSHOT = snapshotFields();
const PERSISTED = persistedStores();

/**
 * The fields a ui store owns, so a snapshot has to copy them. The git search
 * boxes are excluded: no store owns them, they are patched directly through
 * updateProjectViewState().
 */
const STORE_OWNED = TS.filter((f) => !f.startsWith("gitChangesSearch"))
	.filter((f) => !f.startsWith("gitLogSearch"))
	.filter((f) => !f.startsWith("gitStagedSearch"));

describe("the four layers of a persisted view", () => {
	it("finds all four layers", () => {
		expect(TS.length).toBeGreaterThan(5);
		expect(RUST.length).toBeGreaterThan(5);
		expect(SNAPSHOT.length).toBeGreaterThan(5);
		expect(PERSISTED.length).toBeGreaterThan(5);
	});

	it("declares the same fields in TypeScript and in Rust", () => {
		expect([...TS].sort()).toEqual([...RUST].sort());
	});

	it("snapshots every field a ui store owns", () => {
		const missing = STORE_OWNED.filter((f) => !SNAPSHOT.includes(f));
		expect(missing).toEqual([]);
	});

	it("snapshots nothing that is not a declared field", () => {
		const extra = SNAPSHOT.filter((f) => !TS.includes(f));
		expect(extra).toEqual([]);
	});

	it("restores every field it snapshots", () => {
		const restore =
			/export function applyProjectState\(id: string\): void \{([\s\S]*?)\n\}/.exec(
				viewState,
			);
		expect(restore).not.toBeNull();
		const body = restore?.[1] ?? "";
		for (const field of SNAPSHOT) {
			expect(body.includes(`ps.${field}`), `${field} is never restored`).toBe(
				true,
			);
		}
	});

	it("subscribes to every ui store the snapshot reads", () => {
		const missing = SNAPSHOT.filter((f) => !PERSISTED.includes(f));
		expect(missing).toEqual([]);
	});

	it("gives every Rust field a default, so an older file still loads", () => {
		const block = /pub struct ProjectUiState \{([\s\S]*?)\n\}/.exec(rust);
		const entries = [...(block?.[1] ?? "").matchAll(/#\[serde\(([^)]*)\)\]/g)];
		expect(entries.length).toBe(RUST.length);
		for (const [, attrs] of entries) {
			expect(attrs, attrs).toContain("default");
		}
	});
});

describe("tools taking over the main area", () => {
	/** The tools showTool() knows about. */
	function toolNames(): string[] {
		const block = /export function showTool\(\s*tool:([\s\S]*?)\n\}/.exec(
			uiStore,
		);
		if (!block) throw new Error("showTool not found in ui.ts");
		return [...block[1].matchAll(/tool === "(\w+)"/g)].map((m) => m[1]);
	}

	const TOOLS = toolNames();

	it("finds the tools", () => {
		expect(TOOLS.length).toBeGreaterThan(1);
	});

	it("gives every tool a flag that is persisted", () => {
		for (const tool of TOOLS) {
			const field = `${tool}Active`;
			expect(TS, `${field} is not a ProjectUiState field`).toContain(field);
			expect(SNAPSHOT, `${field} is never snapshotted`).toContain(field);
		}
	});

	it("declares a store for every tool flag", () => {
		for (const tool of TOOLS) {
			expect(uiStore).toContain(`export const ${tool}Active`);
		}
	});

	it("turns exactly one flag on per tool, and clears the others", () => {
		const block = /export function showTool\(\s*tool:([\s\S]*?)\n\}/.exec(
			uiStore,
		);
		const body = block?.[1] ?? "";
		for (const tool of TOOLS) {
			expect(body, tool).toContain(`${tool}Active.set(tool === "${tool}")`);
		}
	});
});
