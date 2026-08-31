// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "$lib/stores/update";

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

vi.mock("$lib/stores/update", () => ({
	updateState: { subscribe: updateState.subscribe },
	hasPendingUpdate: { subscribe: hasPendingUpdate.subscribe },
	openUpdateModal: (...a: unknown[]) => openUpdateModal(...a),
	closeUpdateModal: (...a: unknown[]) => closeUpdateModal(...a),
	installUpdate: (...a: unknown[]) => installUpdate(...a),
}));

const { CHANGELOG } = await import("$lib/data/changelog");
const { default: ChangelogSection } = await import(
	"$lib/components/home/ChangelogSection.svelte"
);
const { default: UpdateCard } = await import(
	"$lib/components/layout/UpdateCard.svelte"
);
const { default: UpdateModal } = await import(
	"$lib/components/layout/UpdateModal.svelte"
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
	const nodes = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".timeline .node"));
	const releases = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".release"));
	const active = () => releases().filter((r) => r.classList.contains("active"));

	/** The changelog is real data, so these are invariants, not fixed content. */
	it("shows one timeline entry per release", () => {
		render(ChangelogSection, {});
		expect(nodes()).toHaveLength(CHANGELOG.length);
		expect(releases()).toHaveLength(CHANGELOG.length);
	});

	it("opens on the newest release", () => {
		render(ChangelogSection, {});
		expect(active()).toHaveLength(1);
		expect(active()[0].id).toContain(CHANGELOG[0].version);
	});

	it("selects the release that was clicked", async () => {
		render(ChangelogSection, {});
		if (nodes().length < 2) return;
		await userEvent.click(nodes()[1]);
		expect(active()[0].id).toContain(CHANGELOG[1].version);
	});

	it("marks the selected entry for a screen reader", async () => {
		render(ChangelogSection, {});
		const current = nodes().filter(
			(n) => n.getAttribute("aria-current") === "true",
		);
		expect(current).toHaveLength(1);
	});

	/** A version still being written has no date, and says so. */
	it("says a release with no date is still in development", () => {
		render(ChangelogSection, {});
		const undated = CHANGELOG.filter((e) => !e.date);
		for (const entry of undated) {
			const node = nodes().find((n) =>
				n.textContent?.includes(`v${entry.version}`),
			);
			expect(node?.querySelector(".marker")?.classList).toContain("unreleased");
		}
	});

	/**
	 * A kind with no change renders no section at all - the view groups by kind
	 * and an empty group would be a bare heading.
	 */
	it("shows only the kinds a release actually has", () => {
		render(ChangelogSection, {});
		for (const article of releases()) {
			const sections = article.querySelectorAll(".kind-section");
			for (const section of sections) {
				expect(section.querySelectorAll(".change").length).toBeGreaterThan(0);
			}
		}
	});

	it("counts the changes of each kind", () => {
		render(ChangelogSection, {});
		for (const section of document.querySelectorAll(".kind-section")) {
			const count = Number(
				section.querySelector(".kind-count")?.textContent ?? "0",
			);
			expect(count).toBe(section.querySelectorAll(".change").length);
		}
	});

	it("shows every change of every release", () => {
		render(ChangelogSection, {});
		const total = CHANGELOG.reduce((sum, e) => sum + e.changes.length, 0);
		expect(document.querySelectorAll(".change")).toHaveLength(total);
	});

	it("shows the summary of each release", () => {
		render(ChangelogSection, {});
		expect(document.querySelectorAll(".summary")).toHaveLength(
			CHANGELOG.length,
		);
		for (const s of document.querySelectorAll(".summary")) {
			expect(s.textContent?.trim()).toBeTruthy();
		}
	});
});
