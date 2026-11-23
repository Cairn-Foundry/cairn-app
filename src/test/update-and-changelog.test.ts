// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "#lib/stores/update";

const IDLE: UpdateState = {
	phase: "idle",
	version: null,
	notes: null,
	downloaded: 0,
	total: null,
	error: null,
	lastCheckedAt: null,
};

const updateState = writable<UpdateState>(IDLE);
const hasPendingUpdate = writable(false);
const openUpdateModal = vi.fn();
const closeUpdateModal = vi.fn();
const installUpdate = vi.fn();

vi.mock("#lib/stores/update", () => ({
	updateState: { subscribe: updateState.subscribe },
	hasPendingUpdate: { subscribe: hasPendingUpdate.subscribe },
	openUpdateModal: (...a: unknown[]) => openUpdateModal(...a),
	closeUpdateModal: (...a: unknown[]) => closeUpdateModal(...a),
	installUpdate: (...a: unknown[]) => installUpdate(...a),
}));

const { CHANGELOG } = await import("#lib/data/changelog");
const { default: ChangelogSection } = await import(
	"#lib/components/home/ChangelogSection.svelte"
);
const { default: UpdateCard } = await import(
	"#lib/components/layout/UpdateCard.svelte"
);
const { default: UpdateModal } = await import(
	"#lib/components/layout/UpdateModal.svelte"
);

function setUpdate(patch: Partial<UpdateState>) {
	updateState.set({ ...IDLE, ...patch });
}

beforeEach(() => {
	updateState.set(IDLE);
	hasPendingUpdate.set(false);
	openUpdateModal.mockReset();
	closeUpdateModal.mockReset();
	installUpdate.mockReset();
});

describe("UpdateCard", () => {
	const card = () => document.querySelector(".update-card");

	/** Nothing to announce means no card at all, not an empty one. */
	it("shows nothing when no update is pending", () => {
		hasPendingUpdate.set(false);
		render(UpdateCard, {});
		expect(card()).toBeNull();
	});

	it("announces the version that is waiting", () => {
		hasPendingUpdate.set(true);
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateCard, {});
		expect(card()?.textContent).toContain("1.2.3");
	});

	it("opens the update modal on request", async () => {
		hasPendingUpdate.set(true);
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateCard, {});
		await userEvent.click(document.querySelector(".action") as HTMLElement);
		expect(openUpdateModal).toHaveBeenCalled();
	});

	/** While it downloads, the progress replaces the invitation to open it. */
	it("shows the progress instead of the action while downloading", () => {
		hasPendingUpdate.set(true);
		setUpdate({
			phase: "downloading",
			version: "1.2.3",
			downloaded: 50,
			total: 100,
		});
		render(UpdateCard, {});
		expect(document.querySelector(".action")).toBeNull();
		expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
	});
});

describe("UpdateModal", () => {
	const closeButton = () => document.querySelector(".icon-btn.close");
	const laterButton = () => document.querySelector(".modal-foot .btn.ghost");
	const installButton = () =>
		document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
	const backdrop = () =>
		document.querySelector(".modal-backdrop") as HTMLElement;

	it("shows the version it is about to install", () => {
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateModal, {});
		expect(document.querySelector(".version.next")?.textContent).toBe("1.2.3");
	});

	it("shows the release notes when there are some", () => {
		setUpdate({ phase: "available", version: "1.2.3", notes: "Fixes things" });
		render(UpdateModal, {});
		expect(document.querySelector(".notes")?.textContent).toBe("Fixes things");
	});

	it("shows no notes section when there are none", () => {
		setUpdate({ phase: "available", version: "1.2.3", notes: null });
		render(UpdateModal, {});
		expect(document.querySelector(".notes")).toBeNull();
	});

	it("installs on request", async () => {
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateModal, {});
		await userEvent.click(installButton());
		expect(installUpdate).toHaveBeenCalled();
	});

	it("closes on request", async () => {
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateModal, {});
		await userEvent.click(closeButton() as HTMLElement);
		expect(closeUpdateModal).toHaveBeenCalled();
	});

	it("closes on the later button", async () => {
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateModal, {});
		await userEvent.click(laterButton() as HTMLElement);
		expect(closeUpdateModal).toHaveBeenCalled();
	});

	/**
	 * An update half written to disk must not be abandoned: every way out is
	 * withdrawn while it downloads or installs.
	 */
	it("offers no way out while it downloads", async () => {
		setUpdate({
			phase: "downloading",
			version: "1.2.3",
			downloaded: 10,
			total: 100,
		});
		render(UpdateModal, {});
		expect(closeButton()).toBeNull();
		expect(laterButton()).toBeNull();
		await userEvent.click(backdrop());
		expect(closeUpdateModal).not.toHaveBeenCalled();
	});

	it("offers no way out while it installs", async () => {
		setUpdate({ phase: "installing", version: "1.2.3" });
		render(UpdateModal, {});
		expect(closeButton()).toBeNull();
		await userEvent.click(backdrop());
		expect(closeUpdateModal).not.toHaveBeenCalled();
	});

	it("gives the way out back once it is no longer working", () => {
		setUpdate({ phase: "available", version: "1.2.3" });
		render(UpdateModal, {});
		expect(closeButton()).not.toBeNull();
	});

	it("shows how far the download went", () => {
		setUpdate({
			phase: "downloading",
			version: "1.2.3",
			downloaded: 5_000_000,
			total: 10_000_000,
		});
		render(UpdateModal, {});
		expect(document.querySelector(".progress")).not.toBeNull();
		expect(document.querySelector(".bytes")?.textContent).toMatch(/MB|Mo/i);
	});

	it("reports a failed update rather than closing on it", () => {
		setUpdate({ phase: "error", version: "1.2.3", error: "network is down" });
		render(UpdateModal, {});
		expect(document.querySelector(".error")?.textContent).toContain(
			"network is down",
		);
		expect(closeUpdateModal).not.toHaveBeenCalled();
	});

	it("refuses a second install while one is running", () => {
		setUpdate({ phase: "installing", version: "1.2.3" });
		render(UpdateModal, {});
		expect(installButton().disabled).toBe(true);
	});
});

describe("ChangelogSection", () => {
	const rows = () =>
		Array.from(
			document.querySelectorAll<HTMLElement>(".versions .version-row"),
		);
	const shownVersion = () =>
		document.querySelector(".detail-head h2")?.textContent ?? "";
	const kindSections = () => document.querySelectorAll(".kind-section");

	/** The changelog is real data, so these are invariants, not fixed content. */
	it("lists one row per release", () => {
		render(ChangelogSection, {});
		expect(rows()).toHaveLength(CHANGELOG.length);
	});

	it("opens on the newest release, and shows only that one", () => {
		render(ChangelogSection, {});
		expect(shownVersion()).toContain(CHANGELOG[0].version);
		expect(document.querySelectorAll(".release")).toHaveLength(1);
	});

	it("shows the release that was clicked", async () => {
		render(ChangelogSection, {});
		if (rows().length < 2) return;
		await userEvent.click(rows()[1]);
		expect(shownVersion()).toContain(CHANGELOG[1].version);
	});

	it("moves to the next release with the arrow keys", async () => {
		render(ChangelogSection, {});
		if (rows().length < 2) return;
		rows()[0].focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(shownVersion()).toContain(CHANGELOG[1].version);
		expect(document.activeElement).toBe(rows()[1]);
		await userEvent.keyboard("{ArrowUp}");
		expect(shownVersion()).toContain(CHANGELOG[0].version);
	});

	it("marks the selected row for a screen reader", async () => {
		render(ChangelogSection, {});
		const current = rows().filter(
			(n) => n.getAttribute("aria-current") === "true",
		);
		expect(current).toHaveLength(1);
		expect(current[0].dataset.version).toBe(CHANGELOG[0].version);
	});

	/** A version still being written has no date, and says so. */
	it("says a release with no date is still in development", () => {
		render(ChangelogSection, {});
		for (const entry of CHANGELOG.filter((e) => !e.date)) {
			const row = rows().find((n) => n.dataset.version === entry.version);
			expect(row?.textContent).toContain("In development");
		}
	});

	/**
	 * A kind with no change renders no section at all, and each count matches
	 * its list - checked on every release in turn.
	 */
	it("shows each release with its summary, its kinds and every change", async () => {
		render(ChangelogSection, {});
		for (const [i, entry] of CHANGELOG.entries()) {
			await userEvent.click(rows()[i]);
			expect(
				document.querySelector(".summary")?.textContent?.trim(),
			).toBeTruthy();
			const kinds = new Set(entry.changes.map((c) => c.kind));
			expect(kindSections()).toHaveLength(kinds.size);
			for (const section of kindSections()) {
				const count = Number(section.querySelector(".kind-count")?.textContent);
				expect(count).toBeGreaterThan(0);
				expect(count).toBe(section.querySelectorAll(".change").length);
			}
			expect(document.querySelectorAll(".change")).toHaveLength(
				entry.changes.length,
			);
		}
	});
});
