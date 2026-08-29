import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProviderId } from "$lib/services/cli-provider-service";
import type { UsageGroup } from "$lib/utils/home/usage-stats";

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
const { default: UsageBreakdown } = await import(
	"$lib/components/home/usage/UsageBreakdown.svelte"
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
		mount("usage");
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
			},
			{ id: "codex", label: "Codex", hasLocalScope: false, installed: true },
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

describe("UsageBreakdown", () => {
	function group(key: string, overrides: Partial<UsageGroup> = {}): UsageGroup {
		return {
			key,
			label: key,
			turns: 10,
			inputTokens: 1000,
			outputTokens: 500,
			cacheReadTokens: 200,
			tokens: 1700,
			costUsd: 1.5,
			durationMs: 1000,
			share: 0.25,
			...overrides,
		} as UsageGroup;
	}

	function mount(props: Record<string, unknown> = {}) {
		render(UsageBreakdown, {
			title: "By model",
			icon: "sparkles",
			groups: [],
			emptyLabel: "nothing yet",
			...props,
		});
	}

	const rows = () => Array.from(document.querySelectorAll("li"));
	const values = () =>
		rows().map((r) => r.querySelector(".value")?.textContent?.trim());
	const bars = () =>
		rows().map((r) => (r.querySelector(".fill") as HTMLElement).style.width);
	const moreButton = () =>
		document.querySelector(".more") as HTMLElement | null;

	it("says so when there is nothing to break down", () => {
		mount({ groups: [] });
		expect(document.querySelector(".empty")?.textContent).toBe("nothing yet");
		expect(rows()).toHaveLength(0);
	});

	it("counts the groups it was given", () => {
		mount({ groups: [group("a"), group("b")] });
		expect(document.querySelector(".count")?.textContent).toBe("2");
	});

	it("shows the cost of each group by default", () => {
		mount({ groups: [group("a", { costUsd: 2.5 })] });
		expect(values()[0]).toMatch(/2/);
	});

	it("shows tokens instead when asked to", () => {
		mount({
			groups: [group("a", { tokens: 12345, costUsd: 2.5 })],
			metric: "tokens",
		});
		expect(values()[0]).not.toMatch(/\$/);
	});

	it("draws each group's share as a bar", () => {
		mount({ groups: [group("a", { share: 0.4 })] });
		expect(bars()[0]).toBe("40%");
	});

	/**
	 * A group that barely registers still gets a sliver, not a hairline: the
	 * bar is floored at 1%, so a share below that is drawn at 1% rather than at
	 * its own value.
	 */
	it("floors the bar of a share too small to see", () => {
		mount({ groups: [group("a", { share: 0.0001 })] });
		expect(bars()[0]).toBe("1%");
	});

	it("draws a share above the floor at its own value", () => {
		mount({ groups: [group("a", { share: 0.5 })] });
		expect(bars()[0]).toBe("50%");
	});

	/** Long lists are cut, with the rest available on request. */
	it("shows only the first few groups", () => {
		mount({
			groups: Array.from({ length: 10 }, (_, i) => group(`g${i}`)),
			limit: 6,
		});
		expect(rows()).toHaveLength(6);
		expect(moreButton()?.textContent).toMatch(/4/);
	});

	it("shows the rest on request, and folds them away again", async () => {
		mount({
			groups: Array.from({ length: 10 }, (_, i) => group(`g${i}`)),
			limit: 6,
		});
		await userEvent.click(moreButton() as HTMLElement);
		expect(rows()).toHaveLength(10);
		await userEvent.click(moreButton() as HTMLElement);
		expect(rows()).toHaveLength(6);
	});

	it("offers nothing to expand when everything already fits", () => {
		mount({ groups: [group("a"), group("b")], limit: 6 });
		expect(moreButton()).toBeNull();
	});

	it("shows the turns and the share of each group", () => {
		mount({ groups: [group("a", { turns: 42, share: 0.33 })] });
		const meta = rows()[0].querySelector(".meta")?.textContent ?? "";
		expect(meta).toMatch(/42/);
		expect(meta).toMatch(/33%/);
	});

	/**
	 * Cache reads are input the user paid for, so they count as input. Read
	 * against a group whose cache reads dominate, and against the exact
	 * formatted figure: 1 000 alone reads "1 000" where the sum reads "1.0M",
	 * so a loose match would accept either.
	 */
	it("counts the cache reads with the input tokens", () => {
		mount({
			groups: [
				group("a", {
					inputTokens: 1_000,
					cacheReadTokens: 999_000,
					outputTokens: 1,
				}),
			],
		});
		const meta = rows()[0].querySelector(".meta")?.textContent ?? "";
		expect(meta).toContain("1.0M in");
	});
});
