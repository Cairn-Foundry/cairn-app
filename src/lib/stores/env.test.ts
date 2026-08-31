// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type EnvVariable, emptyEnvFile } from "$lib/services/env-service";

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
	envFileExists: vi.fn().mockResolvedValue(false),
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
