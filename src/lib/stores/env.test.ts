// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type EnvFile,
	type EnvVariable,
	emptyEnvFile,
	getGlobalEnv,
	getInstanceEnv,
	getProjectEnv,
	saveGlobalEnv,
	saveInstanceEnv,
	saveProjectEnv,
	writeEnvFile,
} from "$lib/services/env-service";

// Only the IPC calls are replaced; the pure helpers of the service (emptyEnvFile
// and friends) stay real, since the store builds its initial state from them.
vi.mock("$lib/services/env-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGlobalEnv: vi.fn().mockResolvedValue(null),
	getProjectEnv: vi.fn().mockResolvedValue(null),
	getInstanceEnv: vi.fn().mockResolvedValue(null),
	saveGlobalEnv: vi.fn().mockResolvedValue(undefined),
	saveProjectEnv: vi.fn().mockResolvedValue(undefined),
	saveInstanceEnv: vi.fn().mockResolvedValue(undefined),
	readEnvFile: vi.fn().mockResolvedValue(""),
	writeEnvFile: vi.fn().mockResolvedValue(undefined),
	ensureEnvIgnored: vi.fn().mockResolvedValue(true),
	envFileExists: vi.fn().mockResolvedValue(false),
	getSystemUser: vi.fn().mockResolvedValue("tester"),
}));

vi.mock("$lib/services/custom-command-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getSystemUser: vi.fn().mockResolvedValue("tester"),
}));

vi.mock("$lib/services/git-service", () => ({
	getIdentity: vi.fn().mockResolvedValue({ name: "", email: "" }),
}));

import {
	addVariables,
	envKey,
	globalEnv,
	instanceEnvFile,
	instanceEnvs,
	moveVariable,
	newVariable,
	overrideValue,
	projectEnvFile,
	projectEnvs,
	removeVariable,
	resolveInstanceEnv,
	scopeVariables,
	setOverride,
	setProjectEnvOptions,
	syncEnvFile,
	toggleVariableEnabled,
	updateVariable,
} from "./env";

/** A variable with the fields a test cares about, the rest at their defaults. */
function variable(
	key: string,
	value: string,
	overrides: Partial<EnvVariable> = {},
): EnvVariable {
	return { ...newVariable(key, value), ...overrides };
}

const emptyFile = emptyEnvFile;

const KEY = envKey("p1", "i1");

beforeEach(() => {
	globalEnv.set(emptyFile());
	projectEnvs.set({});
	instanceEnvs.set({});
});

describe("envKey", () => {
	it("keys the instance maps by project and instance", () => {
		expect(envKey("p", "i")).toBe("p:i");
	});
});

describe("newVariable", () => {
	it("mints a distinct id every time", () => {
		expect(newVariable().id).not.toBe(newVariable().id);
	});

	it("starts enabled, not secret, and not per-instance", () => {
		expect(newVariable("K", "v")).toMatchObject({
			key: "K",
			value: "v",
			enabled: true,
			secret: false,
			perInstance: false,
			defaultValue: "",
		});
	});

	it("starts blank when given nothing", () => {
		expect(newVariable()).toMatchObject({ key: "", value: "" });
	});
});

describe("overrideValue", () => {
	const v = variable("K", "v", { perInstance: true, defaultValue: "fallback" });

	it("serves the instance's own value when it set one", () => {
		expect(overrideValue(v, { [v.id]: "mine" })).toBe("mine");
	});

	it("falls back to the default when the instance never typed one", () => {
		expect(overrideValue(v, {})).toBe("fallback");
	});

	it("keeps an override that is deliberately empty", () => {
		expect(overrideValue(v, { [v.id]: "" })).toBe("");
	});

	it("ignores another variable's override", () => {
		expect(overrideValue(v, { other: "not mine" })).toBe("fallback");
	});
});

describe("addVariables", () => {
	it("appends to the global scope", () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A"]);
	});

	it("appends to a project scope", () => {
		addVariables("project", "p1", null, [variable("A", "1")]);
		expect(projectEnvFile("p1").variables.map((v) => v.key)).toEqual(["A"]);
	});

	it("appends to an instance scope", () => {
		addVariables("instance", "p1", "i1", [variable("A", "1")]);
		expect(instanceEnvFile("p1", "i1").variables.map((v) => v.key)).toEqual([
			"A",
		]);
	});

	it("keeps the existing variables, appending after them", () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		addVariables("global", "p1", null, [variable("B", "2")]);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A", "B"]);
	});

	it("keeps the scopes apart", () => {
		addVariables("global", "p1", null, [variable("G", "1")]);
		addVariables("project", "p1", null, [variable("P", "2")]);
		expect(get(globalEnv).variables).toHaveLength(1);
		expect(projectEnvFile("p1").variables).toHaveLength(1);
	});

	it("keeps two projects apart", () => {
		addVariables("project", "p1", null, [variable("A", "1")]);
		addVariables("project", "p2", null, [variable("B", "2")]);
		expect(projectEnvFile("p1").variables.map((v) => v.key)).toEqual(["A"]);
		expect(projectEnvFile("p2").variables.map((v) => v.key)).toEqual(["B"]);
	});
});

describe("updateVariable", () => {
	it("replaces a variable by id, keeping its position", () => {
		const a = variable("A", "1");
		const b = variable("B", "2");
		addVariables("global", "p1", null, [a, b]);
		updateVariable("global", "p1", null, { ...a, value: "changed" });
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A", "B"]);
		expect(get(globalEnv).variables[0].value).toBe("changed");
	});

	it("leaves the list alone for an id it does not carry", () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		updateVariable("global", "p1", null, variable("GHOST", "x"));
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A"]);
	});
});

describe("removeVariable", () => {
	it("deletes the variable", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a, variable("B", "2")]);
		removeVariable("global", "p1", null, a.id);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["B"]);
	});

	it("does nothing for an id the scope does not carry", () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		removeVariable("global", "p1", null, "ghost");
		expect(get(globalEnv).variables).toHaveLength(1);
	});
});

describe("toggleVariableEnabled", () => {
	it("disables a variable without deleting it", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a]);
		toggleVariableEnabled("global", "p1", null, a.id);
		expect(get(globalEnv).variables[0]).toMatchObject({
			key: "A",
			enabled: false,
		});
	});

	it("re-enables it on a second toggle", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a]);
		toggleVariableEnabled("global", "p1", null, a.id);
		toggleVariableEnabled("global", "p1", null, a.id);
		expect(get(globalEnv).variables[0].enabled).toBe(true);
	});

	it("leaves the other variables alone", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a, variable("B", "2")]);
		toggleVariableEnabled("global", "p1", null, a.id);
		expect(get(globalEnv).variables[1].enabled).toBe(true);
	});
});

describe("setOverride", () => {
	it("records an instance's own value", () => {
		setOverride("p1", "i1", "v1", "mine");
		expect(instanceEnvFile("p1", "i1").overrides).toEqual({ v1: "mine" });
	});

	it("restores the default when the override is cleared", () => {
		setOverride("p1", "i1", "v1", "mine");
		setOverride("p1", "i1", "v1", null);
		expect(instanceEnvFile("p1", "i1").overrides).toEqual({});
	});

	it("keeps an override that is deliberately empty", () => {
		setOverride("p1", "i1", "v1", "");
		expect(instanceEnvFile("p1", "i1").overrides).toEqual({ v1: "" });
	});

	it("keeps overrides of different variables apart", () => {
		setOverride("p1", "i1", "v1", "one");
		setOverride("p1", "i1", "v2", "two");
		expect(instanceEnvFile("p1", "i1").overrides).toEqual({
			v1: "one",
			v2: "two",
		});
	});

	it("keeps instances apart", () => {
		setOverride("p1", "i1", "v1", "one");
		setOverride("p1", "i2", "v1", "two");
		expect(instanceEnvFile("p1", "i1").overrides.v1).toBe("one");
		expect(instanceEnvFile("p1", "i2").overrides.v1).toBe("two");
	});
});

describe("scopeVariables", () => {
	it("reads each scope without a subscription", () => {
		addVariables("global", "p1", null, [variable("G", "1")]);
		addVariables("project", "p1", null, [variable("P", "2")]);
		addVariables("instance", "p1", "i1", [variable("I", "3")]);
		expect(scopeVariables("global", "p1", "i1").map((v) => v.key)).toEqual([
			"G",
		]);
		expect(scopeVariables("project", "p1", "i1").map((v) => v.key)).toEqual([
			"P",
		]);
		expect(scopeVariables("instance", "p1", "i1").map((v) => v.key)).toEqual([
			"I",
		]);
	});

	it("answers an empty list for a project that has none", () => {
		expect(scopeVariables("project", "unknown", null)).toEqual([]);
	});

	it("answers an empty list when there is no project at all", () => {
		expect(scopeVariables("project", null, null)).toEqual([]);
	});
});

describe("moveVariable", () => {
	it("reorders inside one scope", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a, variable("B", "2")]);
		moveVariable("global", "global", "p1", null, a.id, 2);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["B", "A"]);
	});

	it("moves a variable from the project scope to the global one", () => {
		const a = variable("A", "1");
		addVariables("project", "p1", null, [a]);
		moveVariable("project", "global", "p1", null, a.id, 0);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A"]);
		expect(projectEnvFile("p1").variables).toEqual([]);
	});

	it("moves a variable down to the instance scope", () => {
		const a = variable("A", "1");
		addVariables("project", "p1", null, [a]);
		moveVariable("project", "instance", "p1", "i1", a.id, 0);
		expect(instanceEnvFile("p1", "i1").variables.map((v) => v.key)).toEqual([
			"A",
		]);
		expect(projectEnvFile("p1").variables).toEqual([]);
	});

	it("refuses to move to the instance scope with no instance", () => {
		const a = variable("A", "1");
		addVariables("project", "p1", null, [a]);
		moveVariable("project", "instance", "p1", null, a.id, 0);
		expect(projectEnvFile("p1").variables.map((v) => v.key)).toEqual(["A"]);
	});

	it("inserts at the position the drop asked for", () => {
		const c = variable("C", "3");
		addVariables("global", "p1", null, [
			variable("A", "1"),
			variable("B", "2"),
		]);
		addVariables("project", "p1", null, [c]);
		moveVariable("project", "global", "p1", null, c.id, 1);
		expect(get(globalEnv).variables.map((v) => v.key)).toEqual(["A", "C", "B"]);
	});

	it("does nothing for a variable the source scope does not carry", () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		moveVariable("global", "project", "p1", null, "ghost", 0);
		expect(get(globalEnv).variables).toHaveLength(1);
		expect(projectEnvFile("p1").variables).toEqual([]);
	});
});

describe("resolveInstanceEnv", () => {
	it("carries a variable of every scope through", () => {
		addVariables("global", "p1", null, [variable("G", "1")]);
		addVariables("project", "p1", null, [variable("P", "2")]);
		addVariables("instance", "p1", "i1", [variable("I", "3")]);
		const keys = resolveInstanceEnv("p1", "i1", {}).map((e) => e.key);
		expect(keys).toEqual(expect.arrayContaining(["G", "P", "I"]));
	});

	it("lets a narrower scope win over a wider one", () => {
		addVariables("global", "p1", null, [variable("K", "global")]);
		addVariables("project", "p1", null, [variable("K", "project")]);
		const entry = resolveInstanceEnv("p1", "i1", {}).find((e) => e.key === "K");
		expect(entry?.value).toBe("project");
	});

	it("lets the instance scope win over the project one", () => {
		addVariables("project", "p1", null, [variable("K", "project")]);
		addVariables("instance", "p1", "i1", [variable("K", "instance")]);
		const entry = resolveInstanceEnv("p1", "i1", {}).find((e) => e.key === "K");
		expect(entry?.value).toBe("instance");
	});

	it("leaves a disabled variable out of the resolved environment", () => {
		const a = variable("A", "1");
		addVariables("global", "p1", null, [a]);
		toggleVariableEnabled("global", "p1", null, a.id);
		expect(resolveInstanceEnv("p1", "i1", {}).map((e) => e.key)).not.toContain(
			"A",
		);
	});

	it("serves an instance its own value for a per-instance variable", () => {
		const a = variable("K", "", {
			perInstance: true,
			defaultValue: "fallback",
		});
		addVariables("project", "p1", null, [a]);
		setOverride("p1", "i1", a.id, "mine");
		const entry = resolveInstanceEnv("p1", "i1", {}).find((e) => e.key === "K");
		expect(entry?.value).toBe("mine");
	});

	it("serves the default to an instance that set no override", () => {
		const a = variable("K", "", {
			perInstance: true,
			defaultValue: "fallback",
		});
		addVariables("project", "p1", null, [a]);
		const entry = resolveInstanceEnv("p1", "i1", {}).find((e) => e.key === "K");
		expect(entry?.value).toBe("fallback");
	});

	it("answers nothing when no scope declares anything", () => {
		expect(resolveInstanceEnv("p1", "i1", {})).toEqual([]);
	});

	it("resolves with no project or instance at all", () => {
		addVariables("global", "p1", null, [variable("G", "1")]);
		expect(resolveInstanceEnv(null, null, {}).map((e) => e.key)).toEqual(["G"]);
	});
});

describe("instanceEnvFile", () => {
	it("answers an empty file for an instance that has none", () => {
		expect(instanceEnvFile("p1", "i1")).toEqual(emptyFile());
	});

	it("answers an empty file when there is no instance", () => {
		expect(instanceEnvFile("p1", null)).toEqual(emptyFile());
	});

	it("reads the file once one exists", () => {
		addVariables("instance", "p1", "i1", [variable("A", "1")]);
		expect(get(instanceEnvs)[KEY].variables).toHaveLength(1);
	});
});

/** The fields syncEnvFile reaches for on an instance. */
function instanceStub(id: string) {
	return {
		id,
		worktreePath: `/w/${id}`,
		branch: "main",
		baseBranch: "main",
		ticket: { id: "T-1", title: "t" },
	} as never;
}

describe("generating the env file", () => {
	let n = 0;
	const ids = () => {
		n++;
		return { p: `gp${n}`, i: `gi${n}` };
	};

	/**
	 * Switching to an instance rewrites its file, which is how an edit made in
	 * another instance - or in a scope above it - reaches this worktree.
	 */
	it("picks up a global edit made while another instance was active", async () => {
		const { p, i } = ids();
		const project = { id: p, name: p, path: `/p/${p}` } as never;
		vi.mocked(getGlobalEnv).mockResolvedValue(null as never);
		vi.mocked(getProjectEnv).mockResolvedValue(null as never);
		vi.mocked(getInstanceEnv).mockResolvedValue(null as never);
		vi.mocked(writeEnvFile).mockReset().mockResolvedValue(false);

		setProjectEnvOptions(p, { writeEnvFile: true, envFileName: ".env" });
		addVariables("global", p, i, [variable("G", "before")]);
		await syncEnvFile(project, instanceStub(i));

		addVariables("global", p, i, [variable("H", "after")]);
		await syncEnvFile(project, instanceStub(i));

		const bodies = vi.mocked(writeEnvFile).mock.calls.map((c) => c[2]);
		expect(bodies.length).toBeGreaterThanOrEqual(2);
		expect(bodies.at(-1)).toContain("after");
	});
});

/** A pristine copy of the store, since what was already loaded is module state. */
async function freshEnv() {
	vi.resetModules();
	const env = await import("./env");
	const service = await import("$lib/services/env-service");
	return { env, service };
}

const fileWith = (key: string, value: string): EnvFile => ({
	...emptyFile(),
	variables: [variable(key, value)],
});

describe("loadEnv", () => {
	it("reads the three scopes into their stores, each one once", async () => {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockClear();
		vi.mocked(service.getProjectEnv).mockClear();
		vi.mocked(service.getInstanceEnv).mockClear();
		const globalFile = fileWith("G", "1");
		const projectFile = fileWith("P", "2");
		const instanceFile = fileWith("I", "3");
		vi.mocked(service.getGlobalEnv).mockResolvedValue(globalFile);
		vi.mocked(service.getProjectEnv).mockResolvedValue(projectFile);
		vi.mocked(service.getInstanceEnv).mockResolvedValue(instanceFile);

		await env.loadEnv("p1", "i1");
		await env.loadEnv("p1", "i1");

		expect(get(env.globalEnv)).toEqual(globalFile);
		expect(get(env.projectEnvs)).toEqual({ p1: projectFile });
		expect(get(env.instanceEnvs)).toEqual({ "p1:i1": instanceFile });
		expect(service.getGlobalEnv).toHaveBeenCalledTimes(1);
		expect(service.getProjectEnv).toHaveBeenCalledTimes(1);
		expect(service.getInstanceEnv).toHaveBeenCalledTimes(1);
		expect(service.getInstanceEnv).toHaveBeenCalledWith("p1", "i1");
	});

	it("stops after the project when there is no instance", async () => {
		const { env, service } = await freshEnv();
		const projectFile = fileWith("P", "2");
		vi.mocked(service.getGlobalEnv).mockResolvedValue(null as never);
		vi.mocked(service.getProjectEnv).mockResolvedValue(projectFile);
		vi.mocked(service.getInstanceEnv).mockClear();

		await env.loadEnv("p1", null);

		expect(get(env.projectEnvs)).toEqual({ p1: projectFile });
		expect(get(env.instanceEnvs)).toEqual({});
		expect(service.getInstanceEnv).not.toHaveBeenCalled();
	});

	it("keeps the empty defaults when a read fails", async () => {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockRejectedValue(new Error("boom"));
		vi.mocked(service.getProjectEnv).mockRejectedValue(new Error("boom"));
		vi.mocked(service.getInstanceEnv).mockRejectedValue(new Error("boom"));

		await env.loadEnv("p1", "i1");

		expect(get(env.globalEnv)).toEqual(emptyFile());
		expect(get(env.projectEnvs)).toEqual({});
		expect(get(env.instanceEnvs)).toEqual({});
	});
});

describe("moving a per-instance variable out of the instance", () => {
	it("drops the override the instance had given it", () => {
		const shared = variable("A", "1", { perInstance: true });
		instanceEnvs.set({
			[KEY]: {
				...emptyFile(),
				variables: [shared],
				overrides: { [shared.id]: "mine" },
			},
		});

		moveVariable("instance", "project", "p1", "i1", shared.id, 0);

		expect(instanceEnvFile("p1", "i1")).toEqual(emptyFile());
		expect(projectEnvFile("p1").variables).toEqual([shared]);
	});
});

describe("buildInstanceEnv", () => {
	it("is empty without a project", async () => {
		const { env } = await freshEnv();
		await expect(
			env.buildInstanceEnv(null, instanceStub("i")),
		).resolves.toEqual({});
	});

	it("is empty without an instance", async () => {
		const { env } = await freshEnv();
		const project = { id: "p", name: "p", path: "/p" } as never;
		await expect(env.buildInstanceEnv(project, null)).resolves.toEqual({});
	});

	it("resolves the variables of every scope with the instance tokens", async () => {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(fileWith("G", "g"));
		vi.mocked(service.getProjectEnv).mockResolvedValue(
			fileWith("BRANCH", "{{instance.branch}}"),
		);
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		const project = { id: "p", name: "p", path: "/p" } as never;

		const record = await env.buildInstanceEnv(project, instanceStub("i"));

		expect(record).toEqual({ G: "g", BRANCH: "main" });
		expect(get(env.envInterpolationValues)["instance.branch"]).toBe("main");
		expect(get(env.envInterpolationValues)["instance.worktree"]).toBe("/w/i");
	});
});

describe("syncEnvFile", () => {
	const project = { id: "sp", name: "sp", path: "/p/sp" } as never;

	async function readyEnv() {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockResolvedValue({
			...fileWith("K", "v"),
			writeEnvFile: true,
			envFileName: ".env.local",
		});
		vi.mocked(service.writeEnvFile).mockResolvedValue(true);
		vi.mocked(service.ensureEnvIgnored).mockClear();
		vi.mocked(service.writeEnvFile).mockClear();
		return { env, service };
	}

	it("writes the file once and keeps the ignore rule in place", async () => {
		const { env, service } = await readyEnv();

		await env.syncEnvFile(project, instanceStub("i"));

		expect(service.writeEnvFile).toHaveBeenCalledWith(
			"/w/i",
			".env.local",
			"K=v",
			false,
		);
		expect(service.ensureEnvIgnored).toHaveBeenCalledWith("/w/i", ".env.local");
		expect(get(env.envFileConflicts)).toEqual({ "sp:i": false });
	});

	it("does not rewrite a body it already wrote, unless forced", async () => {
		const { env, service } = await readyEnv();

		await env.syncEnvFile(project, instanceStub("i"));
		await env.syncEnvFile(project, instanceStub("i"));
		expect(service.writeEnvFile).toHaveBeenCalledTimes(1);

		await env.syncEnvFile(project, instanceStub("i"), undefined, true);
		expect(service.writeEnvFile).toHaveBeenCalledTimes(2);
		expect(vi.mocked(service.writeEnvFile).mock.calls[1][3]).toBe(true);
	});

	it("reports a conflict and leaves the ignore rule alone when the write is refused", async () => {
		const { env, service } = await readyEnv();
		vi.mocked(service.writeEnvFile).mockResolvedValue(false);

		await env.syncEnvFile(project, instanceStub("i"));

		expect(get(env.envFileConflicts)).toEqual({ "sp:i": true });
		expect(service.ensureEnvIgnored).not.toHaveBeenCalled();
	});
});

describe("prepareInstanceEnv", () => {
	it("answers the injected variables and writes the generated file", async () => {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockResolvedValue({
			...fileWith("K", "v"),
			writeEnvFile: true,
		});
		vi.mocked(service.writeEnvFile).mockResolvedValue(true);
		vi.mocked(service.writeEnvFile).mockClear();
		const project = { id: "pp", name: "pp", path: "/p/pp" } as never;

		const record = await env.prepareInstanceEnv(project, instanceStub("i"));

		expect(record).toEqual({ K: "v" });
		expect(service.writeEnvFile).toHaveBeenCalledWith(
			"/w/i",
			".env",
			"K=v",
			false,
		);
	});
});

describe("debounced persistence", () => {
	const DEBOUNCE_MS = 250;

	beforeEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50));
		vi.useFakeTimers();
		vi.mocked(saveGlobalEnv).mockClear();
		vi.mocked(saveProjectEnv).mockClear();
		vi.mocked(saveInstanceEnv).mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("writes the global file once the debounce has elapsed", async () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
		expect(saveGlobalEnv).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(saveGlobalEnv).toHaveBeenCalledTimes(1);
		expect(vi.mocked(saveGlobalEnv).mock.calls[0][0].variables).toHaveLength(1);
	});

	it("collapses a burst of edits into one write of the latest state", async () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
		addVariables("global", "p1", null, [variable("B", "2")]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(saveGlobalEnv).toHaveBeenCalledTimes(1);
		expect(vi.mocked(saveGlobalEnv).mock.calls[0][0].variables).toHaveLength(2);
	});

	it("writes the instance file with its project and instance ids", async () => {
		setOverride("p1", "i1", "v1", "mine");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(saveInstanceEnv).toHaveBeenCalledTimes(1);
		const [projectId, instanceId, file] =
			vi.mocked(saveInstanceEnv).mock.calls[0];
		expect([projectId, instanceId]).toEqual(["p1", "i1"]);
		expect(file.overrides).toEqual({ v1: "mine" });
	});

	it("does not write a ghost move, which changes nothing", async () => {
		addVariables("global", "p1", null, [variable("A", "1")]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		vi.mocked(saveGlobalEnv).mockClear();
		moveVariable("global", "project", "p1", null, "ghost", 0);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(saveGlobalEnv).not.toHaveBeenCalled();
		expect(saveProjectEnv).not.toHaveBeenCalled();
	});
});

describe("scope guards", () => {
	it("ignores a project file filed under an empty project id", () => {
		projectEnvs.set({
			"": { ...emptyFile(), variables: [variable("A", "1")] },
		});
		expect(projectEnvFile("")).toEqual(emptyFile());
	});

	it("ignores an instance file keyed by a missing instance", () => {
		const stale = { ...emptyFile(), variables: [variable("A", "1")] };
		instanceEnvs.set({ "p1:null": stale, "null:i1": stale });
		expect(instanceEnvFile("p1", null)).toEqual(emptyFile());
		expect(instanceEnvFile(null, "i1")).toEqual(emptyFile());
	});

	it("drops an instance-scope change that has no instance", () => {
		addVariables("instance", "p1", null, [variable("A", "1")]);
		expect(get(instanceEnvs)).toEqual({});
	});
});

describe("moveVariables ordering", () => {
	const keysOf = () => get(globalEnv).variables.map((v) => v.key);
	const seedABC = () => {
		const [a, b, c] = [
			variable("A", "1"),
			variable("B", "2"),
			variable("C", "3"),
		];
		addVariables("global", "p1", null, [a, b, c]);
		return { a, b, c };
	};

	it("leaves the order alone when dropped just below itself", () => {
		const { a } = seedABC();
		moveVariable("global", "global", "p1", null, a.id, 1);
		expect(keysOf()).toEqual(["A", "B", "C"]);
	});

	it("leaves the order alone when dropped right above itself", () => {
		const { a } = seedABC();
		moveVariable("global", "global", "p1", null, a.id, 0);
		expect(keysOf()).toEqual(["A", "B", "C"]);
	});

	it("corrects the insertion point for the variable removed above it", () => {
		const { a } = seedABC();
		moveVariable("global", "global", "p1", null, a.id, 2);
		expect(keysOf()).toEqual(["B", "A", "C"]);
	});

	it("moves a variable to the front", () => {
		const { c } = seedABC();
		moveVariable("global", "global", "p1", null, c.id, 0);
		expect(keysOf()).toEqual(["C", "A", "B"]);
	});
});

describe("moving a per-instance variable into the instance", () => {
	it("bakes the instance's override into a plain value", () => {
		const shared = variable("A", "", { perInstance: true, defaultValue: "d" });
		addVariables("project", "p1", null, [shared]);
		setOverride("p1", "i1", shared.id, "mine");

		moveVariable("project", "instance", "p1", "i1", shared.id, 0);

		expect(instanceEnvFile("p1", "i1").variables).toEqual([
			{ ...shared, perInstance: false, value: "mine" },
		]);
		expect(instanceEnvFile("p1", "i1").overrides).toEqual({});
	});

	it("bakes the default when the instance gave no override", () => {
		const shared = variable("A", "", { perInstance: true, defaultValue: "d" });
		addVariables("project", "p1", null, [shared]);

		moveVariable("project", "instance", "p1", "i1", shared.id, 0);

		expect(instanceEnvFile("p1", "i1").variables[0]).toMatchObject({
			perInstance: false,
			value: "d",
		});
	});

	it("keeps a variable's value when it moves to a wider scope", () => {
		const plain = variable("A", "1", { perInstance: true, defaultValue: "d" });
		addVariables("project", "p1", null, [plain]);

		moveVariable("project", "global", "p1", "i1", plain.id, 0);

		expect(get(globalEnv).variables).toEqual([plain]);
	});

	it("does not touch the instance file for a plain variable", () => {
		const plain = variable("A", "1");
		addVariables("project", "p1", null, [plain]);
		moveVariable("project", "global", "p1", "i1", plain.id, 0);
		expect(get(instanceEnvs)).toEqual({});
	});

	it("does not touch any instance file when there is no instance", () => {
		const shared = variable("A", "1", { perInstance: true });
		addVariables("project", "p1", null, [shared]);
		moveVariable("project", "global", "p1", null, shared.id, 0);
		expect(get(instanceEnvs)).toEqual({});
	});
});

describe("interpolation tokens", () => {
	const project = { id: "ip", name: "ip", path: "/p/ip" } as never;

	async function build(
		ticket: Record<string, string>,
		options: { isUserLookupFailing?: boolean } = {},
	) {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		const { getSystemUser } = await import(
			"$lib/services/custom-command-service"
		);
		vi.mocked(getSystemUser).mockClear();
		if (options.isUserLookupFailing) {
			vi.mocked(getSystemUser).mockRejectedValue(new Error("boom"));
		} else {
			vi.mocked(getSystemUser).mockResolvedValue("tester");
		}
		const instance = { ...(instanceStub("i") as object), ticket } as never;
		await env.buildInstanceEnv(project, instance);
		await env.buildInstanceEnv(project, instance);
		return { values: get(env.envInterpolationValues), getSystemUser };
	}

	it("looks the login name up once and serves it as a token", async () => {
		const { values, getSystemUser } = await build({ id: "T-1", title: "t" });
		expect(getSystemUser).toHaveBeenCalledTimes(1);
		expect(values["user.login"]).toBe("tester");
	});

	it("serves an empty login when the lookup fails", async () => {
		const { values } = await build(
			{ id: "T-1", title: "t" },
			{ isUserLookupFailing: true },
		);
		expect(values["user.login"]).toBe("");
	});

	it("falls back to the ticket id and an empty url for a bare ticket", async () => {
		const { values } = await build({ id: "T-1", title: "t" });
		expect(values["ticket.key"]).toBe("T-1");
		expect(values["ticket.url"]).toBe("");
	});

	it("serves the ticket key and url when it has them", async () => {
		const { values } = await build({
			id: "T-1",
			title: "t",
			key: "ABC-9",
			url: "https://x/ABC-9",
		});
		expect(values["ticket.key"]).toBe("ABC-9");
		expect(values["ticket.url"]).toBe("https://x/ABC-9");
	});
});

describe("syncEnvFile guards", () => {
	const project = { id: "gp", name: "gp", path: "/p/gp" } as never;

	async function readyEnv(isWritingEnabled: boolean) {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockResolvedValue({
			...fileWith("K", "v"),
			writeEnvFile: isWritingEnabled,
		});
		vi.mocked(service.writeEnvFile).mockResolvedValue(true);
		vi.mocked(service.writeEnvFile).mockClear();
		return { env, service };
	}

	it("does nothing without a project", async () => {
		const { env, service } = await readyEnv(true);
		await expect(
			env.syncEnvFile(null, instanceStub("i")),
		).resolves.toBeUndefined();
		expect(service.writeEnvFile).not.toHaveBeenCalled();
	});

	it("does nothing without an instance", async () => {
		const { env, service } = await readyEnv(true);
		await expect(env.syncEnvFile(project, null)).resolves.toBeUndefined();
		expect(service.writeEnvFile).not.toHaveBeenCalled();
	});

	it("does nothing for an instance with no worktree", async () => {
		const { env, service } = await readyEnv(true);
		const bare = {
			...(instanceStub("i") as object),
			worktreePath: "",
		} as never;
		await expect(env.syncEnvFile(project, bare)).resolves.toBeUndefined();
		expect(service.writeEnvFile).not.toHaveBeenCalled();
		expect(get(env.envFileConflicts)).toEqual({});
	});

	it("writes nothing and clears the conflict when the file is switched off", async () => {
		const { env, service } = await readyEnv(false);
		env.envFileConflicts.set({ "gp:i": true });

		await env.syncEnvFile(project, instanceStub("i"));

		expect(service.writeEnvFile).not.toHaveBeenCalled();
		expect(get(env.envFileConflicts)).toEqual({ "gp:i": false });
	});
});

describe("forgetProject", () => {
	it("reloads the project and its instances on the next load", async () => {
		const { env, service } = await freshEnv();
		vi.mocked(service.getGlobalEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getInstanceEnv).mockResolvedValue(emptyFile());
		vi.mocked(service.getProjectEnv).mockClear();
		vi.mocked(service.getInstanceEnv).mockClear();

		await env.loadEnv("p1", "i1");
		env.forgetProject("p1");
		await env.loadEnv("p1", "i1");

		expect(service.getProjectEnv).toHaveBeenCalledTimes(2);
		expect(service.getInstanceEnv).toHaveBeenCalledTimes(2);
	});
});
