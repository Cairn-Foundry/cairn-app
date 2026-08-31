// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CliProviderDef,
	CliProviderId,
} from "$lib/services/cli-provider-service";
import { cliProviders } from "$lib/stores/cli-providers";
import ProviderPicker from "./ProviderPicker.svelte";

function provider(
	id: CliProviderId,
	overrides: Partial<CliProviderDef> = {},
): CliProviderDef {
	return {
		id,
		label: id,
		hasLocalScope: id === "claude-code",
		installed: true,
		configured: true,
		path: null,
		version: null,
		resumable: true,
		...overrides,
	};
}

const ALL: CliProviderDef[] = [
	provider("claude-code"),
	provider("codex"),
	provider("copilot"),
];

function mount(props: Record<string, unknown> = {}) {
	const onChange = vi.fn();
	const result = render(ProviderPicker, {
		props: { selected: [], reached: [], unavailable: {}, ...props },
		events: { change: (e: CustomEvent) => onChange(e.detail) },
	});
	return { ...result, onChange };
}

const tiles = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".target"));
const tileFor = (id: string) =>
	tiles().find(
		(t) => t.querySelector(".name")?.textContent === id,
	) as HTMLElement;
const foot = () =>
	document.querySelector(".foot .ag-hint")?.textContent?.trim();
const warned = () =>
	document.querySelector(".foot .ag-hint.warn")?.textContent?.trim();

beforeEach(() => {
	cliProviders.set(ALL);
});

describe("ProviderPicker", () => {
	describe("what it shows", () => {
		it("shows a tile per known agent, installed or not", () => {
			cliProviders.set([
				provider("claude-code"),
				provider("codex", {
					installed: false,
					configured: false,
					path: null,
					version: null,
					resumable: true,
				}),
			]);
			mount();
			expect(tiles()).toHaveLength(2);
		});

		it("marks the agents the entry is written for", () => {
			mount({ selected: ["codex"] });
			expect(tileFor("codex").getAttribute("aria-pressed")).toBe("true");
			expect(tileFor("claude-code").getAttribute("aria-pressed")).toBe("false");
		});

		it("says which agents are missing from this machine", () => {
			cliProviders.set([
				provider("claude-code"),
				provider("codex", {
					installed: false,
					configured: false,
					path: null,
					version: null,
					resumable: true,
				}),
			]);
			mount();
			expect(tileFor("codex").querySelector(".absent")).not.toBeNull();
			expect(tileFor("claude-code").querySelector(".absent")).toBeNull();
		});

		it("asks for a choice while nothing is picked", () => {
			mount({ selected: [] });
			expect(warned()).toBeTruthy();
		});
	});

	describe("picking and unpicking", () => {
		it("adds an agent that was clicked", async () => {
			const { onChange } = mount({ selected: ["claude-code"] });
			await userEvent.click(tileFor("codex"));
			expect(onChange).toHaveBeenCalledWith(["claude-code", "codex"]);
		});

		it("returns the selection in registry order, not click order", async () => {
			const { onChange } = mount({ selected: ["copilot"] });
			await userEvent.click(tileFor("claude-code"));
			expect(onChange).toHaveBeenCalledWith(["claude-code", "copilot"]);
		});

		it("removes an agent already picked", async () => {
			const { onChange } = mount({ selected: ["claude-code", "codex"] });
			await userEvent.click(tileFor("codex"));
			expect(onChange).toHaveBeenCalledWith(["claude-code"]);
		});

		it("allows unpicking down to nothing", async () => {
			const { onChange } = mount({ selected: ["codex"] });
			await userEvent.click(tileFor("codex"));
			expect(onChange).toHaveBeenCalledWith([]);
		});
	});

	describe("agents that cannot be picked", () => {
		/**
		 * Writing for an agent this machine does not have only leaves files
		 * nothing reads, so adding is refused - with the reason, not in silence.
		 */
		it("refuses to add an agent that is not installed, and says why", async () => {
			cliProviders.set([
				provider("claude-code"),
				provider("codex", {
					installed: false,
					configured: false,
					path: null,
					version: null,
					resumable: true,
				}),
			]);
			const { onChange } = mount({ selected: ["claude-code"] });
			await userEvent.click(tileFor("codex"));
			expect(onChange).not.toHaveBeenCalled();
			expect(warned()).toBeTruthy();
		});

		/**
		 * The asymmetry that matters: an entry already written for a missing
		 * agent can still be taken back out, which is how a stale copy is cleaned.
		 */
		it("still lets an entry be removed from a missing agent", async () => {
			cliProviders.set([
				provider("claude-code"),
				provider("codex", {
					installed: false,
					configured: false,
					path: null,
					version: null,
					resumable: true,
				}),
			]);
			const { onChange } = mount({ selected: ["claude-code", "codex"] });
			await userEvent.click(tileFor("codex"));
			expect(onChange).toHaveBeenCalledWith(["claude-code"]);
		});

		it("refuses an agent the scope has no place for, with the scope's reason", async () => {
			const { onChange } = mount({
				selected: ["claude-code"],
				unavailable: { codex: "no local scope here" },
			});
			await userEvent.click(tileFor("codex"));
			expect(onChange).not.toHaveBeenCalled();
			expect(warned()).toBe("no local scope here");
		});

		it("marks a refused agent for a screen reader", () => {
			mount({ unavailable: { codex: "nope" } });
			expect(tileFor("codex").getAttribute("aria-disabled")).toBe("true");
		});

		/** An agent already picked is not refused, even where the scope objects. */
		it("does not mark a picked agent as refused", () => {
			mount({ selected: ["codex"], unavailable: { codex: "nope" } });
			expect(tileFor("codex").getAttribute("aria-disabled")).toBe("false");
		});

		/**
		 * The regression this test exists for: the scope above this picker decides
		 * which agents it refuses, and changing the scope rewrites `unavailable`.
		 * A plain function reading it was never re-run, so switching the MCP
		 * import scope to "local" left the refused agents looking pickable.
		 */
		it("follows the refusals changing under it", async () => {
			const { rerender } = mount({ selected: ["claude-code"] });
			expect(tileFor("codex").getAttribute("aria-disabled")).toBe("false");

			await rerender({
				selected: ["claude-code"],
				reached: [],
				unavailable: { codex: "no local scope here" },
			});
			expect(tileFor("codex").getAttribute("aria-disabled")).toBe("true");

			await rerender({
				selected: ["claude-code"],
				reached: [],
				unavailable: {},
			});
			expect(tileFor("codex").getAttribute("aria-disabled")).toBe("false");
		});

		it("refuses the pick itself once the refusals change under it", async () => {
			const { onChange, rerender } = mount({ selected: ["claude-code"] });
			await rerender({
				selected: ["claude-code"],
				reached: [],
				unavailable: { codex: "no local scope here" },
			});
			await userEvent.click(tileFor("codex"));
			expect(onChange).not.toHaveBeenCalled();
			expect(warned()).toBe("no local scope here");
		});

		it("clears the refusal notice once a pick succeeds", async () => {
			const { onChange, rerender } = mount({
				selected: ["claude-code"],
				unavailable: { codex: "nope" },
			});
			await userEvent.click(tileFor("codex"));
			expect(warned()).toBe("nope");

			await rerender({
				selected: ["claude-code", "copilot"],
				reached: [],
				unavailable: { codex: "nope" },
			});
			expect(warned()).toBeUndefined();
			void onChange;
		});
	});

	describe("agents reached without being picked", () => {
		/**
		 * Two agents can share one file, so picking one hands the entry to the
		 * other whether it was asked for or not - which is worth saying plainly.
		 */
		it("names the agents the entry also reaches", () => {
			mount({ selected: ["claude-code"], reached: ["claude-code", "copilot"] });
			expect(foot()).toContain("copilot");
		});

		it("says nothing extra when the reach matches the pick", () => {
			mount({ selected: ["claude-code"], reached: ["claude-code"] });
			expect(foot()).not.toContain("copilot");
		});

		it("puts a refusal before the reach, the refusal being the news", async () => {
			const { onChange } = mount({
				selected: ["claude-code"],
				reached: ["claude-code", "copilot"],
				unavailable: { codex: "nope" },
			});
			await userEvent.click(tileFor("codex"));
			expect(warned()).toBe("nope");
			void onChange;
		});
	});

	describe("picking everything", () => {
		const selectAll = () => document.querySelector(".btn.all") as HTMLElement;

		it("picks every installed agent", async () => {
			const { onChange } = mount();
			await userEvent.click(selectAll());
			expect(onChange).toHaveBeenCalledWith([
				"claude-code",
				"codex",
				"copilot",
			]);
		});

		it("leaves out the agents that are not installed", async () => {
			cliProviders.set([
				provider("claude-code"),
				provider("codex", {
					installed: false,
					configured: false,
					path: null,
					version: null,
					resumable: true,
				}),
			]);
			const { onChange } = mount();
			await userEvent.click(selectAll());
			expect(onChange).toHaveBeenCalledWith(["claude-code"]);
		});

		it("leaves out the agents the scope has no place for", async () => {
			const { onChange } = mount({ unavailable: { copilot: "nope" } });
			await userEvent.click(selectAll());
			expect(onChange).toHaveBeenCalledWith(["claude-code", "codex"]);
		});
	});

	describe("when the picker is disabled", () => {
		it("changes nothing on a click", async () => {
			const { onChange } = mount({ selected: ["claude-code"], disabled: true });
			await userEvent.click(tileFor("codex"));
			expect(onChange).not.toHaveBeenCalled();
		});

		it("offers no way to pick everything", () => {
			mount({ disabled: true });
			expect(document.querySelector(".btn.all")).toBeNull();
		});
	});
});
