import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEntry } from "$lib/services/usage-service";

const backfillUsage = vi.fn();
const clearUsage = vi.fn();
const loadUsage = vi.fn();
const usageEntries = writable<UsageEntry[]>([]);
const usageLoaded = writable(true);
vi.mock("$lib/stores/usage", () => ({
	usageEntries: { subscribe: usageEntries.subscribe },
	usageLoaded: { subscribe: usageLoaded.subscribe },
	backfillUsage: (...a: unknown[]) => backfillUsage(...a),
	clearUsage: (...a: unknown[]) => clearUsage(...a),
	loadUsage: (...a: unknown[]) => loadUsage(...a),
}));

const writeFile = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	writeFile: (...a: unknown[]) => writeFile(...a),
}));

const saveDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...a: unknown[]) => saveDialog(...a),
}));

const { default: UsageSection } = await import(
	"$lib/components/home/usage/UsageSection.svelte"
);

const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function entry(
	daysAgo: number,
	overrides: Partial<UsageEntry> = {},
): UsageEntry {
	return {
		id: `e${daysAgo}`,
		ts: NOW - daysAgo * DAY,
		projectId: "p1",
		projectName: "app",
		instanceId: "i1",
		instanceName: "i1",
		conversationId: "c1",
		conversationTitle: "c1",
		scope: "instance",
		providerId: "claude",
		model: "opus",
		agentId: "",
		agentName: "",
		inputTokens: 100,
		outputTokens: 50,
		cacheReadTokens: 10,
		cacheCreationTokens: 5,
		costUsd: 1,
		durationMs: 1000,
		numTurns: 1,
		backfilled: false,
		...overrides,
	};
}

const rangeButtons = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ranges .seg"));
const kpis = () => Array.from(document.querySelectorAll<HTMLElement>(".kpi"));
const kpiValues = () =>
	kpis().map((k) => k.querySelector(".kpi-value")?.textContent?.trim());
const emptyState = () => document.querySelector(".empty-state");
const loading = () => document.querySelector(".loading");
const notice = () => document.querySelector(".notice");
const ghostNamed = (pattern: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) =>
		pattern.test((b.textContent ?? "").trim()),
	) as HTMLElement;
const exportButton = () => ghostNamed(/export/i);

async function settle() {
	await tick();
	await tick();
	await tick();
}

/** userEvent needs the fake clock handed to it, or every click hangs. */
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	backfillUsage.mockReset().mockResolvedValue(0);
	clearUsage.mockReset().mockResolvedValue(undefined);
	loadUsage.mockReset().mockResolvedValue(undefined);
	writeFile.mockReset().mockResolvedValue(undefined);
	saveDialog.mockReset().mockResolvedValue("/tmp/usage.csv");
	usageEntries.set([]);
	usageLoaded.set(true);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("UsageSection", () => {
	describe("what it shows", () => {
		it("shows a placeholder while the ledger loads, not a word", () => {
			usageLoaded.set(false);
			render(UsageSection, {});
			expect(loading()).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		/** An empty ledger offers to recover what the conversations already hold. */
		it("offers to recover past turns when the ledger is empty", () => {
			render(UsageSection, {});
			expect(emptyState()).not.toBeNull();
			expect(kpis()).toHaveLength(0);
		});

		it("shows the figures once there is something to show", () => {
			usageEntries.set([entry(1), entry(2)]);
			render(UsageSection, {});
			expect(emptyState()).toBeNull();
			expect(kpis().length).toBeGreaterThan(2);
		});

		/** How many turns a recovery found is reported once it has run. */
		it("says how many turns a recovery found", async () => {
			backfillUsage.mockResolvedValue(42);
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			expect(notice()).toBeNull();

			await user.click(ghostNamed(/recover/i));
			await settle();
			expect(notice()?.textContent).toMatch(/42/);
		});

		it("says nothing until a recovery has run", () => {
			usageEntries.set([entry(1, { backfilled: true })]);
			render(UsageSection, {});
			expect(notice()).toBeNull();
		});
	});

	describe("the range", () => {
		it("offers every range", () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			expect(rangeButtons().length).toBeGreaterThan(2);
			expect(
				rangeButtons().filter((b) => b.classList.contains("active")),
			).toHaveLength(1);
		});

		/** Only the turns inside the chosen range count towards the figures. */
		it("counts only the turns inside the range", async () => {
			usageEntries.set([entry(1), entry(60)]);
			render(UsageSection, {});
			const withThirtyDays = kpiValues();

			// The last range is "all", which takes everything.
			await user.click(rangeButtons()[rangeButtons().length - 1]);
			await tick();
			expect(kpiValues()).not.toEqual(withThirtyDays);
		});

		it("marks the range that is showing", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(rangeButtons()[0]);
			await tick();
			expect(rangeButtons()[0].classList.contains("active")).toBe(true);
			expect(
				rangeButtons().filter((b) => b.classList.contains("active")),
			).toHaveLength(1);
		});
	});

	describe("recovering past turns", () => {
		it("asks the store to recover, from the empty state", async () => {
			render(UsageSection, {});
			await user.click(emptyState()?.querySelector(".primary") as HTMLElement);
			await settle();
			expect(backfillUsage).toHaveBeenCalled();
		});

		it("asks the store to recover, from the toolbar", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(ghostNamed(/recover|récupérer/i));
			await settle();
			expect(backfillUsage).toHaveBeenCalled();
		});

		it("refuses a second recovery while one is running", async () => {
			let hold: (n: number) => void = () => {};
			backfillUsage.mockReturnValue(
				new Promise<number>((resolve) => {
					hold = resolve;
				}),
			);
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			const button = ghostNamed(/recover|récupérer/i);
			await user.click(button);
			await tick();
			expect(button.hasAttribute("disabled")).toBe(true);
			hold(0);
		});
	});

	/**
	 * `wipe` also clears the confirming flag, but the confirmation is gone from
	 * the screen once the ledger is empty either way, so that assignment has no
	 * observable effect this suite can pin down.
	 */
	describe("clearing the ledger", () => {
		/** Wiping the figures is irreversible, so it asks first. */
		it("asks before wiping anything", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(ghostNamed(/clear|effacer|vider/i));
			await tick();
			expect(clearUsage).not.toHaveBeenCalled();
		});

		it("wipes the ledger once confirmed", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(ghostNamed(/clear|effacer|vider/i));
			await tick();
			const confirm = document.querySelector(
				"button.ghost.danger",
			) as HTMLElement;
			await user.click(confirm);
			await settle();
			expect(clearUsage).toHaveBeenCalled();
		});

		it("wipes nothing when the confirmation is dismissed", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(ghostNamed(/clear|effacer|vider/i));
			await tick();
			await user.click(ghostNamed(/cancel|annuler/i));
			await tick();
			expect(clearUsage).not.toHaveBeenCalled();
		});

		/** There is nothing to clear on an empty ledger. */
		it("offers no wipe when there is nothing recorded", () => {
			render(UsageSection, {});
			const clear = ghostNamed(/clear|effacer|vider/i);
			expect(clear === undefined || clear.hasAttribute("disabled")).toBe(true);
		});
	});

	describe("exporting", () => {
		/**
		 * A blob download never reaches the disk in the webview, so the export
		 * goes through the same save dialog as every other one.
		 */
		/**
		 * Seeded with a turn outside the range too: with everything in range the
		 * exported rows are the same whether or not the range is applied.
		 */
		it("writes a csv of the range that is showing", async () => {
			usageEntries.set([
				entry(1, { id: "a", projectName: "inrange" }),
				entry(400, { id: "b", projectName: "outofrange" }),
			]);
			render(UsageSection, {});
			await user.click(exportButton());
			await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
			const [path, csv] = writeFile.mock.calls[0] as [string, string];
			expect(path).toBe("/tmp/usage.csv");
			expect(csv).toContain("inrange");
			expect(csv).not.toContain("outofrange");
		});

		it("names the file after the range it exports", async () => {
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(exportButton());
			await vi.waitFor(() => expect(saveDialog).toHaveBeenCalled());
			const suggested = (saveDialog.mock.calls[0][0] as { defaultPath: string })
				.defaultPath;
			expect(suggested).toMatch(/^cairn-usage-.+\.csv$/);
		});

		it("writes nothing when no file is chosen", async () => {
			saveDialog.mockResolvedValue(null);
			usageEntries.set([entry(1)]);
			render(UsageSection, {});
			await user.click(exportButton());
			await vi.waitFor(() => expect(saveDialog).toHaveBeenCalled());
			await settle();
			expect(writeFile).not.toHaveBeenCalled();
		});

		/** Nothing in range is nothing to export. */
		it("offers no export with nothing in the range", () => {
			usageEntries.set([entry(400)]);
			render(UsageSection, {});
			const exportBtn = exportButton();
			expect(
				exportBtn === undefined || exportBtn.hasAttribute("disabled"),
			).toBe(true);
		});
	});
});
