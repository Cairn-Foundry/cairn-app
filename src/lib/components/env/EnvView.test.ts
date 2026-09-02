// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvVariable } from "$lib/services/env-service";
import { envActive } from "$lib/stores/ui";

vi.mock("$lib/services/env-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readEnvFile: vi.fn().mockResolvedValue(null),
	deleteEnvFile: vi.fn().mockResolvedValue(undefined),
	writeEnvFile: vi.fn().mockResolvedValue(undefined),
}));

// The view only leaves its loading state once a project is active, and it
// syncs the .env on disk on the way; neither is what these tests are about.
vi.mock("$lib/stores/env", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadEnv: vi.fn().mockResolvedValue(undefined),
	syncEnvFile: vi.fn().mockResolvedValue(undefined),
}));

const { emptyEnvFile } = await import("$lib/services/env-service");
const { globalEnv, projectEnvs, instanceEnvs } = await import(
	"$lib/stores/env"
);
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project } = await import("../../../test/fixtures");
const { default: EnvView } = await import("./EnvView.svelte");

function variable(overrides: Partial<EnvVariable> = {}): EnvVariable {
	return {
		id: "v1",
		key: "TOKEN",
		value: "super-secret",
		perInstance: false,
		defaultValue: "",
		secret: true,
		enabled: true,
		...overrides,
	};
}

beforeEach(() => {
	envActive.set(true);
	globalEnv.set(emptyEnvFile());
	projectEnvs.set({});
	instanceEnvs.set({});
	projects.set([project("p1")]);
	activeProjectId.set("p1");
});

/** Mounts the view with the given variables in the global scope. */
async function mountWith(variables: EnvVariable[]) {
	globalEnv.set({ ...emptyEnvFile(), variables });
	const result = render(EnvView, {});
	await vi.waitFor(() =>
		expect(document.querySelector(".env-row")).not.toBeNull(),
	);
	return result;
}

const rowOf = (key: string) =>
	Array.from(document.querySelectorAll<HTMLElement>(".env-row")).find(
		(r) => r.querySelector(".env-key")?.textContent?.trim() === key,
	) as HTMLElement;
const shownValue = (key: string) =>
	rowOf(key).querySelector(".env-value")?.textContent ?? "";
const revealButton = (key: string) =>
	Array.from(rowOf(key).querySelectorAll<HTMLElement>(".env-action")).find(
		(b) => /reveal|hide|révéler|masquer/i.test(b.getAttribute("title") ?? ""),
	) as HTMLElement;

describe("EnvView secret values", () => {
	it("masks a secret value rather than printing it", async () => {
		await mountWith([variable()]);
		expect(shownValue("TOKEN")).not.toContain("super-secret");
		expect(shownValue("TOKEN")).toMatch(/^\*+$/);
	});

	it("shows an ordinary value plainly", async () => {
		await mountWith([variable({ secret: false, value: "plain" })]);
		expect(shownValue("TOKEN")).toBe("plain");
	});

	/**
	 * The regression this test exists for: the eye button rendered and clicked,
	 * but the value stayed masked, because the template only re-reads a function
	 * call when its arguments change and `revealed` is not one of them.
	 */
	it("reveals the value when the eye button is used", async () => {
		await mountWith([variable()]);
		await userEvent.click(revealButton("TOKEN"));
		await tick();
		expect(shownValue("TOKEN")).toBe("super-secret");
	});

	it("masks it again on a second click", async () => {
		await mountWith([variable()]);
		await userEvent.click(revealButton("TOKEN"));
		await tick();
		await userEvent.click(revealButton("TOKEN"));
		await tick();
		expect(shownValue("TOKEN")).not.toContain("super-secret");
	});

	it("reveals one row without revealing the others", async () => {
		await mountWith([
			variable({ id: "a", key: "A", value: "value-a" }),
			variable({ id: "b", key: "B", value: "value-b" }),
		]);
		await userEvent.click(revealButton("A"));
		await tick();
		expect(shownValue("A")).toBe("value-a");
		expect(shownValue("B")).not.toContain("value-b");
	});

	it("offers no reveal button for a value that is not secret", async () => {
		await mountWith([variable({ secret: false })]);
		expect(revealButton("TOKEN")).toBeUndefined();
	});

	/** The mask must not leak the length of a long secret. */
	it("caps the mask rather than drawing one star per character", async () => {
		await mountWith([variable({ value: "x".repeat(80) })]);
		expect(shownValue("TOKEN").length).toBeLessThanOrEqual(12);
	});

	it("shows nothing at all for an empty value", async () => {
		await mountWith([variable({ value: "" })]);
		expect(shownValue("TOKEN")).toBe("");
	});
});
