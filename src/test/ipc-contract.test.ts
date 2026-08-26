// The frontend and the backend are wired by name only: a service calls
// invoke("some_command", { someArg }) and Rust answers with
// #[tauri::command] fn some_command(some_arg: ...). Nothing type-checks that
// pairing, and every service test mocks invoke away, so a renamed command or a
// renamed argument stays green through the whole suite and only fails in the
// running app. These tests read both sides off disk and confront them.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const RUST_SRC = join(ROOT, "src-tauri", "src");
const SERVICES = join(ROOT, "src", "lib", "services");

function walk(dir: string, ext: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full, ext));
		else if (entry.endsWith(ext)) out.push(full);
	}
	return out;
}

/**
 * Tauri injects these from their type, so they never appear in the invoke
 * payload. Matched on the type rather than the name: `state: CommitState` is
 * an ordinary argument the frontend must pass, `state: State<'_, T>` is not.
 */
const INJECTED_TYPES =
	/^(?:tauri::)?(?:State<|AppHandle|Window|WebviewWindow|Webview\b|Channel<|ipc::Channel<)/;

/**
 * Splits on the commas that separate arguments, not on the ones inside a
 * generic: `State<'_, AgentState>` is one argument, not two.
 */
function splitTopLevel(src: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of src) {
		if ("<([{".includes(ch)) depth++;
		else if (">)]}".includes(ch)) depth--;
		else if (ch === "," && depth === 0) {
			out.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	out.push(current);
	return out;
}

interface RustCommand {
	name: string;
	args: string[];
	file: string;
}

/** Every `#[tauri::command]` in the crate, with the arguments it declares. */
function rustCommands(): RustCommand[] {
	const found: RustCommand[] = [];
	for (const file of walk(RUST_SRC, ".rs")) {
		const src = readFileSync(file, "utf-8");
		const re =
			/#\[tauri::command[^\]]*\]\s*(?:(?:\/\/\/[^\n]*|\/\/[^\n]*|#\[[^\]]*\])\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
		for (const m of src.matchAll(re)) {
			const [, name, rawArgs] = m;
			const args = splitTopLevel(rawArgs)
				.map((a) => a.trim())
				.filter(Boolean)
				.filter((a) => !a.startsWith("#"))
				.filter((a) => !INJECTED_TYPES.test(a.slice(a.indexOf(":") + 1).trim()))
				.map((a) =>
					a
						.split(":")[0]
						.trim()
						.replace(/^mut\s+/, ""),
				)
				.filter(Boolean);
			found.push({ name, args, file });
		}
	}
	return found;
}

/** The commands actually registered on the invoke handler. */
function registeredCommands(): string[] {
	const src = readFileSync(join(RUST_SRC, "lib.rs"), "utf-8");
	const block = /generate_handler!\[([\s\S]*?)\]/.exec(src);
	if (!block) throw new Error("generate_handler! not found in lib.rs");
	return block[1]
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith("//"))
		.map((s) => s.split("::").pop() as string);
}

/**
 * The fields of the interface a spread variable is typed with, so
 * `invoke("cmd", { ...doc })` is checked rather than skipped.
 */
function spreadFields(
	src: string,
	variable: string,
	file: string,
): string[] | null {
	const typed = new RegExp(`\\b${variable}\\s*:\\s*([A-Za-z_$][\\w$]*)`).exec(
		src,
	);
	if (!typed) return null;
	const name = typed[1];
	const local = interfaceFields(src, name);
	if (local) return local;
	for (const other of walk(SERVICES, ".ts")) {
		if (other === file) continue;
		const fields = interfaceFields(readFileSync(other, "utf-8"), name);
		if (fields) return fields;
	}
	return null;
}

/** The property names an `interface Name { ... }` declares. */
function interfaceFields(src: string, name: string): string[] | null {
	const re = new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
	const m = re.exec(src);
	if (!m) return null;
	return m[1]
		.split("\n")
		.map((l) => /^\s*([A-Za-z_$][\w$]*)\??\s*:/.exec(l)?.[1])
		.filter((v): v is string => Boolean(v));
}

/** The fields of an inline object type on the parameter a call forwards. */
function paramObjectFields(src: string, variable: string): string[] | null {
	const re = new RegExp(`${variable}\\s*:\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
	let m: RegExpExecArray | null = null;
	for (const found of src.matchAll(re)) m = found as RegExpExecArray;
	if (!m) return null;
	return m[1]
		.split("\n")
		.map((l) => /^\s*([A-Za-z_$][\w$]*)\??\s*:/.exec(l)?.[1])
		.filter((v): v is string => Boolean(v));
}

interface InvokeCall {
	command: string;
	args: string[];
	file: string;
	line: number;
}

/**
 * Every `invoke("name", { ... })` in the service layer. Only the object
 * literal form is read; a spread or a computed key yields no argument list
 * rather than a wrong one, and is reported separately.
 */
function invokeCalls(): { calls: InvokeCall[]; opaque: InvokeCall[] } {
	const calls: InvokeCall[] = [];
	const opaque: InvokeCall[] = [];
	for (const file of walk(SERVICES, ".ts")) {
		if (file.endsWith(".test.ts")) continue;
		const src = readFileSync(file, "utf-8");
		const re = /invoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"\s*(,|\))/g;
		for (const m of src.matchAll(re)) {
			const command = m[1];
			const line = src.slice(0, m.index ?? 0).split("\n").length;
			if (m[2] === ")") {
				calls.push({ command, args: [], file, line });
				continue;
			}
			const rest = src.slice((m.index ?? 0) + m[0].length);
			const objStart = rest.indexOf("{");
			const call: InvokeCall = { command, args: [], file, line };
			const beforeObj = objStart === -1 ? "" : rest.slice(0, objStart).trim();
			if (objStart === -1 || beforeObj !== "") {
				// `invoke("cmd", args)`: read the fields off the parameter's
				// inline object type rather than giving up on the call.
				const variable = rest.slice(0, rest.indexOf(")")).trim();
				// Search backwards from the call so a shared parameter name
				// resolves against the enclosing function, not the first match.
				const enclosing = src.slice(0, m.index ?? 0);
				const fields = /^[A-Za-z_$][\w$]*$/.test(variable)
					? paramObjectFields(enclosing, variable)
					: null;
				if (!fields) {
					opaque.push(call);
					continue;
				}
				call.args = fields;
				calls.push(call);
				continue;
			}
			let depth = 0;
			let end = -1;
			for (let i = objStart; i < rest.length; i++) {
				if (rest[i] === "{") depth++;
				else if (rest[i] === "}") {
					depth--;
					if (depth === 0) {
						end = i;
						break;
					}
				}
			}
			if (end === -1) {
				opaque.push(call);
				continue;
			}
			const body = rest.slice(objStart + 1, end);
			let nesting = 0;
			let current = "";
			const keys: string[] = [];
			for (const ch of body) {
				if ("{[(".includes(ch)) nesting++;
				else if ("}])".includes(ch)) nesting--;
				else if (ch === "," && nesting === 0) {
					keys.push(current);
					current = "";
					continue;
				}
				current += ch;
			}
			keys.push(current);
			const resolved: string[] = [];
			let unresolved = false;
			for (const raw of keys) {
				const key = raw.trim();
				if (!key) continue;
				if (key.startsWith("...")) {
					const fields = spreadFields(src, key.slice(3).trim(), file);
					if (!fields) {
						unresolved = true;
						break;
					}
					resolved.push(...fields);
					continue;
				}
				const name = key.split(":")[0].trim();
				if (/^[A-Za-z_$][\w$]*$/.test(name)) resolved.push(name);
			}
			if (unresolved) {
				opaque.push(call);
				continue;
			}
			call.args = resolved;
			calls.push(call);
		}
	}
	return { calls, opaque };
}

/** camelCase on the TS side maps to snake_case on the Rust side. */
function toSnakeCase(name: string): string {
	return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const commands = rustCommands();
const byName = new Map(commands.map((c) => [c.name, c]));
const registered = registeredCommands();
const { calls, opaque } = invokeCalls();

describe("IPC inventory", () => {
	it("finds the commands on both sides", () => {
		expect(commands.length).toBeGreaterThan(100);
		expect(registered.length).toBeGreaterThan(100);
		expect(calls.length).toBeGreaterThan(100);
	});

	it("registers every declared command on the invoke handler", () => {
		const missing = commands
			.map((c) => c.name)
			.filter((n) => !registered.includes(n));
		expect(missing).toEqual([]);
	});

	it("declares every registered command", () => {
		const ghosts = registered.filter((n) => !byName.has(n));
		expect(ghosts).toEqual([]);
	});

	it("registers each command once", () => {
		const seen = new Set<string>();
		const dupes = registered.filter((n) => seen.size === seen.add(n).size);
		expect(dupes).toEqual([]);
	});
});

describe("IPC contract", () => {
	it("calls only commands the backend answers", () => {
		const unknown = calls
			.filter((c) => !byName.has(c.command))
			.map((c) => `${c.command} (${c.file}:${c.line})`);
		expect(unknown).toEqual([]);
	});

	it("calls only commands registered on the handler", () => {
		const unregistered = calls
			.filter((c) => !registered.includes(c.command))
			.map((c) => `${c.command} (${c.file}:${c.line})`);
		expect(unregistered).toEqual([]);
	});

	it("passes every argument the command declares", () => {
		const wrong: string[] = [];
		for (const call of calls) {
			const cmd = byName.get(call.command);
			if (!cmd) continue;
			const passed = new Set(call.args.map(toSnakeCase));
			for (const arg of cmd.args) {
				if (!passed.has(arg)) {
					wrong.push(
						`${call.command} misses "${arg}" (${call.file}:${call.line})`,
					);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	it("passes no argument the command does not declare", () => {
		const extra: string[] = [];
		for (const call of calls) {
			const cmd = byName.get(call.command);
			if (!cmd) continue;
			const declared = new Set(cmd.args);
			for (const arg of call.args) {
				if (!declared.has(toSnakeCase(arg))) {
					extra.push(
						`${call.command} passes "${arg}" (${call.file}:${call.line})`,
					);
				}
			}
		}
		expect(extra).toEqual([]);
	});

	it("keeps every call readable by this parser", () => {
		expect(opaque.map((c) => `${c.command} (${c.file}:${c.line})`)).toEqual([]);
	});
});

describe("toSnakeCase", () => {
	it("converts a camelCase argument to its Rust spelling", () => {
		expect(toSnakeCase("projectId")).toBe("project_id");
		expect(toSnakeCase("instanceId")).toBe("instance_id");
		expect(toSnakeCase("worktreePath")).toBe("worktree_path");
	});

	it("leaves a single word alone", () => {
		expect(toSnakeCase("settings")).toBe("settings");
		expect(toSnakeCase("")).toBe("");
	});

	it("splits every hump, not just the first", () => {
		expect(toSnakeCase("aBCd")).toBe("a_b_cd");
	});
});
