import { describe, expect, it } from "vitest";
import type { EnvVariable } from "$lib/services/env-service";
import { resolveEnv, toEnvRecord } from "./env-resolve";

function variable(patch: Partial<EnvVariable> & { key: string }): EnvVariable {
	return {
		id: patch.key.toLowerCase(),
		value: "",
		perInstance: false,
		secret: false,
		enabled: true,
		...patch,
	};
}

function resolve(input: {
	global?: EnvVariable[];
	project?: EnvVariable[];
	instance?: EnvVariable[];
	overrides?: Record<string, string>;
	interpolate?: (value: string) => string;
}) {
	return resolveEnv({
		global: input.global ?? [],
		project: input.project ?? [],
		instance: input.instance ?? [],
		overrides: input.overrides ?? {},
		interpolate: input.interpolate,
	});
}

describe("resolveEnv", () => {
	it("lets the narrowest scope win on a shared key", () => {
		const resolved = resolve({
			global: [variable({ key: "API_URL", value: "global" })],
			project: [variable({ key: "API_URL", value: "project" })],
			instance: [variable({ key: "API_URL", value: "instance" })],
		});

		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({ value: "instance", scope: "instance" });
	});

	it("keeps a project value when the instance says nothing", () => {
		const resolved = resolve({
			global: [variable({ key: "API_URL", value: "global" })],
			project: [variable({ key: "API_URL", value: "project" })],
		});

		expect(resolved[0]).toMatchObject({ value: "project", scope: "project" });
	});

	it("reads a per-instance value from the overrides", () => {
		const resolved = resolve({
			project: [
				variable({
					key: "PORT",
					id: "p1",
					perInstance: true,
					value: "ignored",
				}),
			],
			overrides: { p1: "3001" },
		});

		expect(resolved).toEqual([
			{
				key: "PORT",
				value: "3001",
				scope: "project",
				variableId: "p1",
				secret: false,
			},
		]);
	});

	it("leaves out a per-instance variable with no override", () => {
		const resolved = resolve({
			project: [
				variable({ key: "PORT", id: "p1", perInstance: true, value: "3000" }),
			],
		});

		expect(resolved).toEqual([]);
	});

	it("ignores a disabled variable, uncovering the scope beneath", () => {
		const resolved = resolve({
			project: [variable({ key: "API_URL", value: "project" })],
			instance: [
				variable({ key: "API_URL", value: "instance", enabled: false }),
			],
		});

		expect(resolved[0]).toMatchObject({ value: "project", scope: "project" });
	});

	it("ignores a variable whose key is unusable", () => {
		expect(
			resolve({ project: [variable({ key: "2BAD", value: "x" })] }),
		).toEqual([]);
	});

	it("interpolates the value", () => {
		const resolved = resolve({
			project: [variable({ key: "DB", value: "app_{{instance.slug}}" })],
			interpolate: (value) => value.replace("{{instance.slug}}", "feature-x"),
		});

		expect(resolved[0].value).toBe("app_feature-x");
	});

	it("carries the secret flag through", () => {
		const resolved = resolve({
			global: [variable({ key: "TOKEN", value: "abc", secret: true })],
		});

		expect(resolved[0].secret).toBe(true);
	});
});

describe("toEnvRecord", () => {
	it("flattens the entries into what a process expects", () => {
		const record = toEnvRecord(
			resolve({
				project: [
					variable({ key: "A", value: "1" }),
					variable({ key: "B", value: "2" }),
				],
			}),
		);

		expect(record).toEqual({ A: "1", B: "2" });
	});
});
