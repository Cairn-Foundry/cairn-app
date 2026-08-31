// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readEnvFile = vi.fn();
vi.mock("$lib/services/env-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readEnvFile: (...a: unknown[]) => readEnvFile(...a),
}));

const { RESERVED_KEY_PREFIX } = await import("$lib/utils/env/env-file");
const { default: EnvImport } = await import(
	"$lib/components/env/EnvImport.svelte"
);

function mount(props: Record<string, unknown> = {}) {
	const onImport = vi.fn();
	const onClose = vi.fn();
	render(EnvImport, {
		props: {
			worktreePath: "/repo",
			defaultFileName: ".env",
			existingKeys: [],
			...props,
		},
		events: {
			import: (e: CustomEvent) => onImport(e.detail),
			close: () => onClose(),
		},
	});
	return { onImport, onClose };
}

const raw = () => document.querySelector(".ei-raw") as HTMLTextAreaElement;
const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ei-row"));
const keys = () => rows().map((r) => r.querySelector(".ei-key")?.textContent);
const boxes = () =>
	rows().map((r) => r.querySelector("input") as HTMLInputElement);
const warnings = () =>
	Array.from(document.querySelectorAll(".ei-warn")).map((w) => w.textContent);
const badges = () => document.querySelectorAll(".ei-badge");
const allButton = () => document.querySelector(".ei-all") as HTMLElement;
const confirm = () =>
	document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
const replaceBox = () =>
	document.querySelector(".ei-check input") as HTMLInputElement;

/** Pasted, not typed: an env file carries characters userEvent reads as keys. */
async function paste(text: string) {
	raw().focus();
	await userEvent.paste(text);
	await tick();
}

beforeEach(() => {
	readEnvFile.mockReset().mockResolvedValue("");
});

describe("EnvImport", () => {
	describe("reading what was pasted", () => {
		it("lists the variables it found", async () => {
			mount();
			await paste("A=1\nB=2");
			expect(keys()).toEqual(["A", "B"]);
		});

		it("shows nothing for an empty paste", () => {
			mount();
			expect(rows()).toHaveLength(0);
		});

		/** A line that is not a KEY=value pair is counted, not silently dropped. */
		it("counts the lines it could not read", async () => {
			mount();
			await paste("A=1\nnot a pair\nB=2");
			expect(keys()).toEqual(["A", "B"]);
			expect(warnings().length).toBeGreaterThan(0);
		});

		/**
		 * The reserved prefix belongs to the app: those keys are shown as
		 * refused rather than offered for import.
		 */
		it("keeps the reserved keys out of the list, and says so", async () => {
			mount();
			await paste(`A=1\n${RESERVED_KEY_PREFIX}HOME=x`);
			expect(keys()).toEqual(["A"]);
			expect(warnings().length).toBeGreaterThan(0);
		});

		it("warns about nothing when everything parsed", async () => {
			mount();
			await paste("A=1\nB=2");
			expect(warnings()).toHaveLength(0);
		});

		/** A key already set is marked, so overwriting it is a visible choice. */
		it("marks the keys that already exist", async () => {
			mount({ existingKeys: ["A"] });
			await paste("A=1\nB=2");
			expect(badges()).toHaveLength(1);
		});
	});

	describe("choosing what to import", () => {
		it("preselects everything it found", async () => {
			mount();
			await paste("A=1\nB=2");
			expect(boxes().every((b) => b.checked)).toBe(true);
		});

		/** Re-reading the paste re-selects; an explicit choice is not overwritten. */
		it("follows a new paste while nothing was chosen by hand", async () => {
			mount();
			await paste("A=1");
			await userEvent.clear(raw());
			await paste("C=3\nD=4");
			expect(keys()).toEqual(["C", "D"]);
			expect(boxes().every((b) => b.checked)).toBe(true);
		});

		it("drops a variable that was unticked", async () => {
			const { onImport } = mount();
			await paste("A=1\nB=2");
			await userEvent.click(boxes()[0]);
			await userEvent.click(confirm());
			expect(
				(onImport.mock.calls[0][0].entries as { key: string }[]).map(
					(e) => e.key,
				),
			).toEqual(["B"]);
		});

		/** The one control says which of the two things it will do. */
		it("clears the selection when everything is on, and says so", async () => {
			mount();
			await paste("A=1\nB=2");
			const offersToClear = allButton().textContent?.trim();
			await userEvent.click(allButton());
			expect(boxes().every((b) => !b.checked)).toBe(true);
			expect(allButton().textContent?.trim()).not.toBe(offersToClear);
		});

		it("takes everything when some are off", async () => {
			mount();
			await paste("A=1\nB=2");
			await userEvent.click(boxes()[0]);
			await userEvent.click(allButton());
			expect(boxes().every((b) => b.checked)).toBe(true);
		});

		it("refuses to import nothing", async () => {
			const { onImport } = mount();
			await paste("A=1");
			await userEvent.click(allButton());
			expect(confirm().disabled).toBe(true);
			confirm().disabled = false;
			await userEvent.click(confirm());
			expect(onImport).not.toHaveBeenCalled();
		});
	});

	describe("importing", () => {
		it("imports the chosen variables with their values", async () => {
			const { onImport } = mount();
			await paste("A=1\nB=2");
			await userEvent.click(confirm());
			const entries = onImport.mock.calls[0][0].entries as {
				key: string;
				value: string;
			}[];
			expect(entries).toHaveLength(2);
			expect(entries[0]).toMatchObject({ key: "A", value: "1" });
		});

		/** Overwriting what is already set is the default, and can be refused. */
		it("overwrites existing keys unless told not to", async () => {
			const { onImport } = mount();
			await paste("A=1");
			expect(replaceBox().checked).toBe(true);
			await userEvent.click(replaceBox());
			await userEvent.click(confirm());
			expect(onImport.mock.calls[0][0].replace).toBe(false);
		});

		it("imports into the scope that was chosen", async () => {
			const { onImport } = mount();
			await paste("A=1");
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			const options = Array.from(document.querySelectorAll('[role="option"]'));
			await userEvent.click(options[options.length - 1] as HTMLElement);
			await userEvent.click(confirm());
			expect(onImport.mock.calls[0][0].scope).toBeTruthy();
		});

		it("closes without importing anything", async () => {
			const { onImport, onClose } = mount();
			await paste("A=1");
			await userEvent.click(
				document.querySelector(".modal-foot .btn.ghost") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
			expect(onImport).not.toHaveBeenCalled();
		});
	});

	describe("loading from the worktree", () => {
		it("reads the default file of the worktree", async () => {
			readEnvFile.mockResolvedValue("A=1\nB=2");
			mount({ worktreePath: "/repo", defaultFileName: ".env.local" });
			const load = Array.from(
				document.querySelectorAll<HTMLElement>(".ei-sources .btn"),
			)[1];
			await userEvent.click(load);
			await tick();
			await tick();
			expect(readEnvFile).toHaveBeenCalledWith("/repo", ".env.local");
			expect(keys()).toEqual(["A", "B"]);
		});

		/** With no worktree there is no file to offer. */
		it("offers no worktree file without a worktree", () => {
			mount({ worktreePath: null });
			expect(document.querySelectorAll(".ei-sources .btn")).toHaveLength(1);
		});
	});
});
