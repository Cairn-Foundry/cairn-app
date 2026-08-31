// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProviderId } from "$lib/services/cli-provider-service";

// UpdateCard, nested inside the sidebar, reads the update store; nothing here
// is about updates, so it is held in its quiet state.
vi.mock("$lib/stores/update", () => ({
	hasPendingUpdate: { subscribe: writable(false).subscribe },
	updateState: { subscribe: writable({ status: "idle" }).subscribe },
	openUpdateModal: vi.fn(),
}));

const { cliProviders } = await import("$lib/stores/cli-providers");
const { default: HomeSidebar } = await import(
	"$lib/components/home/HomeSidebar.svelte"
);
type HomeSection =
	import("$lib/components/home/HomeSidebar.svelte").HomeSection;
const { default: ProviderChips } = await import(
	"$lib/components/home/ProviderChips.svelte"
);

describe("HomeSidebar", () => {
	function mount(activeSection: HomeSection = "projects") {
		const onSelect = vi.fn();
		const rendered = render(HomeSidebar, {
			props: { activeSection },
			events: { select: (e: CustomEvent) => onSelect(e.detail) },
		});
		return { onSelect, unmount: rendered.unmount };
	}

	const items = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".home-nav-item"));
	const active = () => items().filter((i) => i.classList.contains("active"));

	it("offers every section of the home screen", () => {
		mount();
		expect(items().length).toBeGreaterThan(5);
	});

	it("marks the section on screen, and only that one", () => {
		mount("mcp");
		expect(active()).toHaveLength(1);
	});

	it("marks a different section when a different one is open", () => {
		const { unmount } = mount("projects");
		const first = active()[0].textContent;
		unmount();
		mount("settings");
		expect(active()[0].textContent).not.toBe(first);
	});

	it("reports the section that was picked", async () => {
		const { onSelect } = mount("projects");
		await userEvent.click(items()[1]);
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(typeof onSelect.mock.calls[0][0]).toBe("string");
	});

	/** Nothing is wired by section id but the parent's switch, so ids are unique. */
	it("reports a different id for each entry", async () => {
		const seen: string[] = [];
		for (let i = 0; i < items().length; i++) {
			const { onSelect } = mount("projects");
			await userEvent.click(items()[i]);
			seen.push(onSelect.mock.calls[0][0]);
			document.body.innerHTML = "";
		}
		expect(new Set(seen).size).toBe(seen.length);
	});
});

describe("ProviderChips", () => {
	beforeEach(() => {
		cliProviders.set([
			{
				id: "claude-code",
				label: "Claude Code",
				hasLocalScope: true,
				installed: true,
				configured: true,
				path: null,
				version: null,
				resumable: true,
			},
			{
				id: "codex",
				label: "Codex",
				hasLocalScope: false,
				installed: true,
				configured: true,
				path: null,
				version: null,
				resumable: true,
			},
		]);
	});

	const chips = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".chip, .provider-chip"));

	it("shows one chip per provider it was given", () => {
		render(ProviderChips, {
			providers: ["claude-code", "codex"] as CliProviderId[],
		});
		expect(chips()).toHaveLength(2);
	});

	it("shows nothing for an empty list", () => {
		render(ProviderChips, { providers: [] });
		expect(chips()).toHaveLength(0);
	});

	/** The chips are logos, so the label is what the tooltip carries. */
	it("names each provider by its label, not its id", () => {
		render(ProviderChips, { providers: ["claude-code"] as CliProviderId[] });
		expect(chips()[0].getAttribute("title")).toBe("Claude Code");
	});

	/**
	 * The same agent can be reached through two paths, and a repeated key breaks
	 * a keyed list, so duplicates are collapsed.
	 */
	it("shows one chip for a provider named twice", () => {
		render(ProviderChips, {
			providers: ["codex", "codex"] as CliProviderId[],
		});
		expect(chips()).toHaveLength(1);
	});

	/** An id outside the registry has no chip to draw at all. */
	it("shows nothing for a provider it does not know", () => {
		render(ProviderChips, { providers: ["gone-away" as CliProviderId] });
		expect(chips()).toHaveLength(0);
	});

	it("shows the providers in registry order, not the order given", () => {
		render(ProviderChips, {
			providers: ["codex", "claude-code"] as CliProviderId[],
		});
		expect(chips().map((c) => c.getAttribute("title"))).toEqual([
			"Claude Code",
			"Codex",
		]);
	});
});
