import { readFileSync } from "node:fs";
import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { RESPONSE_STAT_FIELDS } = await import(
	"$lib/utils/agent/response-stats"
);
const { default: AgentTab } = await import(
	"$lib/components/home/settings/AgentTab.svelte"
);

describe("AgentTab", () => {
	const rows = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".settings-row"));
	const toggleIn = (row: HTMLElement) =>
		row.querySelector('input[type="checkbox"]') as HTMLInputElement;
	const dimmed = () => rows().filter((r) => r.classList.contains("dimmed"));
	const statChips = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".stat-chip"));
	const stored = () => {
		let value: Record<string, unknown> = {};
		settings.subscribe((s) => {
			value = s as unknown as Record<string, unknown>;
		})();
		return value;
	};

	beforeEach(async () => {
		await settings.save({
			agentShowLiveActivity: true,
			agentShowResponseStats: true,
			agentShowThinking: true,
			agentResponseStats: ["duration", "tokens"] as never,
		});
	});

	it("groups the settings under headings", () => {
		render(AgentTab, {});
		expect(
			document.querySelectorAll(".settings-group-title").length,
		).toBeGreaterThan(1);
		expect(rows().length).toBeGreaterThan(5);
	});

	it("shows each setting as it is stored", () => {
		render(AgentTab, {});
		const row = rows().find((r) => toggleIn(r) !== null) as HTMLElement;
		expect(toggleIn(row)).toBeTruthy();
	});

	it("stores a setting the moment it is toggled", async () => {
		render(AgentTab, {});
		const before = stored().agentShowThinking;
		const row = rows().find(
			(r) => toggleIn(r)?.checked === before,
		) as HTMLElement;
		await userEvent.click(toggleIn(row));
		await tick();
		expect(Object.values(stored())).toContain(!before);
	});

	/**
	 * The activity settings only mean something while live activity is shown,
	 * so they are dimmed and refused rather than silently having no effect.
	 *
	 * The refusal is what matters: a dimmed row whose toggle still answers a
	 * click looks disabled without being it, which is how this was found.
	 */
	it("dims the activity settings when live activity is off", async () => {
		render(AgentTab, {});
		expect(dimmed()).toHaveLength(0);

		await settings.save({ agentShowLiveActivity: false });
		await tick();
		expect(dimmed().length).toBeGreaterThan(0);
		const dimmedToggles = dimmed()
			.map(toggleIn)
			.filter((t): t is HTMLInputElement => t !== null);
		expect(dimmedToggles.length).toBeGreaterThan(0);
		expect(dimmedToggles.every((t) => t.disabled)).toBe(true);

		// Only the activity settings are dimmed, not the whole tab.
		expect(dimmed().length).toBeLessThan(rows().length);
	});

	it("gives them back when live activity is on again", async () => {
		await settings.save({ agentShowLiveActivity: false });
		render(AgentTab, {});
		expect(dimmed().length).toBeGreaterThan(0);
		await settings.save({ agentShowLiveActivity: true });
		await tick();
		expect(dimmed()).toHaveLength(0);
	});

	describe("the response figures", () => {
		it("offers a chip per figure once the stats are shown", () => {
			render(AgentTab, {});
			expect(statChips()).toHaveLength(RESPONSE_STAT_FIELDS.length);
		});

		it("offers none while the stats are hidden", async () => {
			await settings.save({ agentShowResponseStats: false });
			render(AgentTab, {});
			expect(statChips()).toHaveLength(0);
		});

		it("marks the figures already chosen", () => {
			render(AgentTab, {});
			const on = statChips().filter(
				(c) => c.getAttribute("aria-pressed") === "true",
			);
			expect(on).toHaveLength(2);
		});

		it("drops a figure that was on", async () => {
			render(AgentTab, {});
			const chip = statChips().find(
				(c) => c.getAttribute("aria-pressed") === "true",
			) as HTMLElement;
			await userEvent.click(chip);
			await tick();
			expect(stored().agentResponseStats).toHaveLength(1);
		});

		/**
		 * The chosen figures keep the order the registry declares, not the order
		 * they were clicked in - the row that shows them reads the same list.
		 */
		it("keeps the figures in the declared order, not the clicked one", async () => {
			await settings.save({ agentResponseStats: ["turns"] as never });
			render(AgentTab, {});
			const first = statChips()[0];
			await userEvent.click(first);
			await tick();
			const ids: string[] = RESPONSE_STAT_FIELDS.map((f) => f.id);
			const chosen = stored().agentResponseStats as string[];
			const positions = chosen.map((id) => ids.indexOf(id));
			expect(positions).toEqual([...positions].sort((a, b) => a - b));
		});

		it("keeps the figures already chosen when adding one", async () => {
			await settings.save({ agentResponseStats: ["duration"] as never });
			render(AgentTab, {});
			const off = statChips().find(
				(c) => c.getAttribute("aria-pressed") === "false",
			) as HTMLElement;
			await userEvent.click(off);
			await tick();
			expect(stored().agentResponseStats).toContain("duration");
			expect((stored().agentResponseStats as string[]).length).toBe(2);
		});
	});
});

/**
 * `Home` is the shell that routes a section to its view. Mounting it would pull
 * in every section of the app, so the routing is checked where it is declared:
 * a section with no branch is an entry in the sidebar that shows nothing.
 */
describe("Home section routing", () => {
	const read = (path: string) =>
		readFileSync(new URL(path, import.meta.url), "utf8");

	const home = read("../lib/components/Home.svelte");
	const sidebar = read("../lib/components/home/HomeSidebar.svelte");

	/** Every section the type declares. */
	const declared = (
		sidebar.match(/export type HomeSection =([^;]*);/)?.[1] ?? ""
	)
		.split("|")
		.map((s) => s.trim().replace(/^'|'$/g, ""))
		.filter(Boolean);

	/** Every section Home has a branch for. */
	const routed = Array.from(
		home.matchAll(/activeSection === '([a-z]+)'/g),
		(m) => m[1],
	);

	/** Every section the sidebar offers. */
	const offered = Array.from(
		sidebar.matchAll(/dispatch\('select', '([a-z]+)'\)/g),
		(m) => m[1],
	);

	it("declares the sections it routes", () => {
		expect(declared.length).toBeGreaterThan(5);
	});

	it("routes every section it declares", () => {
		const orphans = declared.filter((s) => !routed.includes(s));
		expect(orphans).toEqual([]);
	});

	it("offers every section it declares", () => {
		const missing = declared.filter((s) => !offered.includes(s));
		expect(missing).toEqual([]);
	});

	/** A sidebar entry with no branch is a button that shows nothing. */
	it("offers nothing it cannot route", () => {
		const unroutable = offered.filter((s) => !routed.includes(s));
		expect(unroutable).toEqual([]);
	});

	it("routes each section once", () => {
		expect(new Set(routed).size).toBe(routed.length);
	});

	/** The parent persists the section, so it has to be told when it changes. */
	it("echoes the section up so it can be persisted", () => {
		expect(home).toMatch(/dispatch\('sectionChange'/);
	});

	it("takes the section back down on restore", () => {
		expect(home).toMatch(/activeSection = openSection/);
	});
});
