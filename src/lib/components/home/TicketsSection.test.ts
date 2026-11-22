// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "#lib/types/integrations";

const runOneShot = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/services/ai-assist-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	runOneShot: (...a: unknown[]) => runOneShot(...a),
}));

const ticketsByProject = writable<Record<string, unknown>>({});
const loadTicketsOverview = vi.fn();
vi.mock("#lib/stores/tickets-overview", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ticketsByProject: { subscribe: ticketsByProject.subscribe },
	loadTicketsOverview: (...a: unknown[]) => loadTicketsOverview(...a),
}));

const settingsState = writable<Record<string, unknown>>({});
vi.mock("#lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: { subscribe: settingsState.subscribe },
}));

const assistInstalled = writable(true);
vi.mock("#lib/stores/cli-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isAssistCliInstalled: {
		subscribe: (run: (v: (id: string) => boolean) => void) =>
			assistInstalled.subscribe((yes) => run(() => yes)),
	},
	loadCliProviders: vi.fn(),
}));

const { projects } = await import("#lib/stores/project");
const { project } = await import("../../../test/fixtures");
const { default: TicketsSection } = await import("./TicketsSection.svelte");

function ticket(): Ticket {
	return {
		id: "1",
		key: "CAIRN-42",
		title: "Fix the parser",
		description: "",
		status: "To do",
		statusCategory: "todo",
		kind: "bug",
		labels: [],
		assignees: [],
		url: "https://tracker/CAIRN-42",
		updatedAt: "2026-01-01T00:00:00Z",
	} as Ticket;
}

async function settle() {
	await tick();
	await tick();
}

const planButton = () =>
	document.querySelector<HTMLButtonElement>(".tk-plan .ai-btn");

beforeEach(() => {
	runOneShot.mockReset().mockResolvedValue("a plan");
	loadTicketsOverview.mockReset();
	projects.set([project("p1", { path: "/repo" })]);
	ticketsByProject.set({
		p1: { tickets: [ticket()], hasMore: false, error: null },
	});
	settingsState.set({ aiEnabled: true, aiFeatures: {} });
});

describe("TicketsSection", () => {
	/**
	 * The backlog is inlined in the prompt, so the run needs nothing of any
	 * project - it only borrows a directory to run in. Without this the
	 * argument can be dropped at this call site and no test notices.
	 */
	it("asks for a run with nothing of the project", async () => {
		render(TicketsSection);
		await settle();
		const button = planButton();
		expect(button).toBeTruthy();
		await userEvent.click(button as HTMLButtonElement);
		await settle();
		expect(runOneShot).toHaveBeenCalled();
		expect(runOneShot.mock.calls[0][3]).toMatchObject({ context: "prompt" });
	});

	it("counts the open tickets in the title", async () => {
		render(TicketsSection);
		await settle();
		expect(document.querySelector(".head-count")?.textContent).toBe("1");
	});

	it("says so when the search matches no ticket", async () => {
		render(TicketsSection);
		await settle();
		await userEvent.type(
			document.querySelector(".ag-search input") as HTMLInputElement,
			"nothing like it",
		);
		expect(document.querySelector(".search-empty h2")?.textContent).toBe(
			"No ticket matches",
		);
		expect(document.querySelector(".row")).toBeNull();
	});

	/** Nothing to fold under a project with no open ticket, so its header does not pretend. */
	it("draws a plain header for a project with no open ticket", async () => {
		ticketsByProject.set({ p1: { tickets: [], hasMore: false, error: null } });
		render(TicketsSection);
		await settle();
		const header = document.querySelector(".group-toggle");
		expect(header?.classList.contains("is-empty")).toBe(true);
		expect(header?.getAttribute("role")).toBeNull();
		expect(header?.querySelector(".chevron svg")).toBeNull();
	});

	it("keeps the toolbar and draws the list shape while the tickets load", async () => {
		ticketsByProject.set({});
		const { ticketsLoading } = await import("#lib/stores/tickets-overview");
		ticketsLoading.set(true);
		render(TicketsSection);
		await settle();
		expect(document.querySelector(".tk-bar")).not.toBeNull();
		expect(document.querySelectorAll(".tk-list .row").length).toBeGreaterThan(
			0,
		);
		expect(document.querySelector(".tk-empty")).toBeNull();
		ticketsLoading.set(false);
	});

	it("asks to link a tracker when no project has one", async () => {
		ticketsByProject.set({});
		render(TicketsSection);
		await settle();
		expect(document.querySelector(".tk-empty")).not.toBeNull();
	});
});
