// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationConnection } from "#lib/types/integrations";

const bindings = writable<Record<string, unknown>>({});
const loadProjectIntegrations = vi.fn(async (..._a: unknown[]) => {});
vi.mock("#lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	bindingsByProject: { subscribe: bindings.subscribe },
	loadProjectIntegrations: (...a: unknown[]) => loadProjectIntegrations(...a),
}));

const { projects } = await import("#lib/stores/project");
const { project } = await import("../../../test/fixtures");
const { default: RemoveConnectionModal } = await import(
	"./RemoveConnectionModal.svelte"
);

function connection(
	overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
	return {
		id: "jira",
		kind: "jira",
		label: "Jira",
		baseUrl: "https://acme.atlassian.net",
		hasCredentials: true,
		identity: null,
		createdAt: 0,
		...overrides,
	};
}

function mount(overrides: Partial<IntegrationConnection> = {}) {
	render(RemoveConnectionModal, {
		connection: connection(overrides),
		icon: "jira",
		host: "acme.atlassian.net",
	});
}

async function settle() {
	await tick();
	await tick();
	await tick();
}

const projectRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".cm-list li"));

beforeEach(() => {
	loadProjectIntegrations.mockClear();
	projects.set([project("p1"), project("p2")]);
	bindings.set({
		p1: {
			tracker: { connectionId: "jira", projectKey: "A", label: "A" },
			forge: null,
			ci: null,
		},
		p2: {
			tracker: { connectionId: "other", projectKey: "B", label: "B" },
			forge: null,
			ci: null,
		},
	});
});

describe("RemoveConnectionModal", () => {
	it("reads the bindings of every project before listing them", async () => {
		mount();
		await settle();
		expect(loadProjectIntegrations).toHaveBeenCalledTimes(2);
	});

	/** Only the projects bound to this connection lose something. */
	it("lists the projects bound to the connection, with what they lose", async () => {
		mount();
		await settle();
		expect(projectRows()).toHaveLength(1);
		expect(projectRows()[0].querySelector(".rc-chip")?.textContent).toBe(
			"Tickets",
		);
	});

	it("says so when no project uses the connection", async () => {
		bindings.set({});
		mount();
		await settle();
		expect(document.querySelector(".rc-none")).not.toBeNull();
	});

	/** A connection without a token has none to delete, so the note would be false. */
	it("mentions the token only when one is stored", async () => {
		mount({ hasCredentials: false });
		await settle();
		expect(document.querySelector(".rc-token")).toBeNull();
	});
});
