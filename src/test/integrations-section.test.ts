// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	IntegrationConnection,
	IntegrationKindDescriptor,
} from "$lib/types/integrations";

const loadKinds = vi.fn();
const loadConnections = vi.fn();
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadKinds: (...a: unknown[]) => loadKinds(...a),
	loadConnections: (...a: unknown[]) => loadConnections(...a),
}));

const saveIntegrationConnection = vi.fn();
const testIntegrationConnection = vi.fn();
const deleteIntegrationConnection = vi.fn();
vi.mock("$lib/services/integration-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveIntegrationConnection: (...a: unknown[]) =>
		saveIntegrationConnection(...a),
	testIntegrationConnection: (...a: unknown[]) =>
		testIntegrationConnection(...a),
	deleteIntegrationConnection: (...a: unknown[]) =>
		deleteIntegrationConnection(...a),
}));

const { connections, kindDescriptors, connectionsError } = await import(
	"$lib/stores/integrations"
);
const { default: IntegrationsSection } = await import(
	"$lib/components/home/IntegrationsSection.svelte"
);

function connection(
	id: string,
	overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
	return {
		id,
		kind: "github",
		label: id,
		baseUrl: "https://api.github.com",
		hasCredentials: true,
		identity: null,
		createdAt: 0,
		...overrides,
	} as IntegrationConnection;
}

function descriptor(kind = "github"): IntegrationKindDescriptor {
	return {
		kind,
		label: kind,
		provides: ["forge"],
		terms: {},
		tokenHelpUrl: "",
		tokenHelpPath: null,
		requiredScopes: [],
		credentialFields: [{ key: "token", label: "Token" }],
	} as unknown as IntegrationKindDescriptor;
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ag-item"));
const rowFor = (label: string) =>
	rows().find((r) =>
		r.querySelector(".ag-item-name")?.textContent?.trim().startsWith(label),
	) as HTMLElement;
const dotIn = (row: HTMLElement) => row.querySelector(".ag-dot") as HTMLElement;
const addButton = () =>
	document.querySelector(".master-actions .icon-btn:last-child") as HTMLElement;
const emptyNote = () => document.querySelector(".ag-master-empty");
const labelField = () =>
	document.querySelector(".ag-detail input") as HTMLInputElement;
const detailButtons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".ag-detail .btn"));
/** The form offers "Test" (which saves then tests) and "Save anyway". */
const detailButtonNamed = (pattern: RegExp) =>
	detailButtons().find((b) =>
		pattern.test((b.textContent ?? "").trim()),
	) as HTMLButtonElement;

async function settle() {
	await tick();
	await tick();
	await tick();
}

beforeEach(() => {
	loadKinds.mockReset().mockResolvedValue(undefined);
	loadConnections.mockReset().mockResolvedValue(undefined);
	saveIntegrationConnection.mockReset();
	testIntegrationConnection.mockReset();
	deleteIntegrationConnection.mockReset().mockResolvedValue(undefined);
	connections.set([]);
	kindDescriptors.set([descriptor()]);
	connectionsError.set(null);
});

describe("IntegrationsSection", () => {
	describe("the connection list", () => {
		it("loads the kinds and the connections on arrival", async () => {
			render(IntegrationsSection, {});
			await settle();
			expect(loadKinds).toHaveBeenCalled();
			expect(loadConnections).toHaveBeenCalled();
		});

		it("says so when nothing is connected", async () => {
			render(IntegrationsSection, {});
			await settle();
			expect(rows()).toHaveLength(0);
			expect(emptyNote()).not.toBeNull();
		});

		it("lists the connections that exist", async () => {
			connections.set([connection("a"), connection("b")]);
			render(IntegrationsSection, {});
			await settle();
			expect(rows()).toHaveLength(2);
		});

		it("shows the account a connection authenticated as", async () => {
			connections.set([
				connection("a", { identity: { login: "alice" } as never }),
			]);
			render(IntegrationsSection, {});
			await settle();
			expect(rows()[0].querySelector(".ag-item-sub")?.textContent).toBe(
				"alice",
			);
		});

		/** Without an identity the host stands in, so the row is never blank. */
		it("falls back to the host when it has no identity", async () => {
			connections.set([
				connection("a", { identity: null, baseUrl: "https://git.example.com" }),
			]);
			render(IntegrationsSection, {});
			await settle();
			expect(rows()[0].querySelector(".ag-item-sub")?.textContent).toBe(
				"git.example.com",
			);
		});

		it("narrows the list to what was searched", async () => {
			connections.set([connection("alpha"), connection("beta")]);
			render(IntegrationsSection, {});
			await settle();
			const search = document.querySelector(
				".ag-master input",
			) as HTMLInputElement;
			await userEvent.type(search, "alph");
			expect(rows()).toHaveLength(1);
		});

		it("says so when the search matches nothing", async () => {
			connections.set([connection("alpha")]);
			render(IntegrationsSection, {});
			await settle();
			const search = document.querySelector(
				".ag-master input",
			) as HTMLInputElement;
			await userEvent.type(search, "zzz");
			expect(rows()).toHaveLength(0);
			expect(emptyNote()).not.toBeNull();
		});
	});

	describe("the status of each connection", () => {
		it("shows a connection with a token as usable", async () => {
			connections.set([connection("a", { hasCredentials: true })]);
			render(IntegrationsSection, {});
			await settle();
			expect(dotIn(rows()[0]).classList.contains("ok")).toBe(true);
		});

		/** A connection with no token cannot be used, and says so. */
		it("shows a connection with no token apart", async () => {
			connections.set([connection("a", { hasCredentials: false })]);
			render(IntegrationsSection, {});
			await settle();
			expect(dotIn(rows()[0]).classList.contains("ok")).toBe(false);
			expect(dotIn(rows()[0]).classList.contains("ko")).toBe(false);
		});

		/**
		 * The regression this covers: the status was read through a plain
		 * function, so a connection whose test had just failed kept showing the
		 * status it had before the test.
		 */
		it("marks a connection whose test failed", async () => {
			connections.set([connection("a", { hasCredentials: true })]);
			saveIntegrationConnection.mockResolvedValue(
				connection("a", { hasCredentials: true }),
			);
			testIntegrationConnection.mockRejectedValue(new Error("bad token"));
			render(IntegrationsSection, {});
			await settle();
			expect(dotIn(rows()[0]).classList.contains("ok")).toBe(true);

			// The list row's own test button reaches runTest for that connection.
			const testButton = rows()[0].parentElement?.querySelector(
				".icon-btn:not(.delete)",
			) as HTMLElement;
			await userEvent.click(testButton);
			await settle();
			await settle();
			expect(dotIn(rowFor("a")).classList.contains("ko")).toBe(true);
		});
	});

	describe("adding a connection", () => {
		/** The form opens named after its kind, so it is never nameless. */
		it("opens a form prefilled from the kind", async () => {
			render(IntegrationsSection, {});
			await settle();
			await userEvent.click(addButton());
			await tick();
			expect(labelField()).not.toBeNull();
			expect(labelField().value).toBe("github");
		});

		/** A connection needs a label, a valid address and a token. */
		it("refuses a connection missing any of the three", async () => {
			render(IntegrationsSection, {});
			await settle();
			await userEvent.click(addButton());
			await tick();
			expect(detailButtonNamed(/^test$/i).disabled).toBe(true);
			expect(detailButtonNamed(/anyway|quand même/i).disabled).toBe(true);
		});

		/**
		 * Filled in completely except for the address, so the refusal can only
		 * come from the address check: a missing token would block it anyway.
		 */
		it("refuses an address that is not a url", async () => {
			render(IntegrationsSection, {});
			await settle();
			await userEvent.click(addButton());
			await tick();
			const inputs = Array.from(
				document.querySelectorAll<HTMLInputElement>(".ag-detail input"),
			);
			await userEvent.type(inputs[0], "My GitHub");
			await userEvent.type(inputs[2], "a-token");

			await userEvent.clear(inputs[1]);
			await userEvent.type(inputs[1], "https://api.github.com");
			expect(detailButtonNamed(/anyway|quand même/i).disabled).toBe(false);

			await userEvent.clear(inputs[1]);
			await userEvent.type(inputs[1], "not-a-url");
			expect(detailButtonNamed(/anyway|quand même/i).disabled).toBe(true);
		});

		/**
		 * The disabled button and the guard in the handler are two defences, and
		 * the address check is only in the first: forcing the click reaches both.
		 */
		it("still saves nothing incomplete when the button is forced", async () => {
			render(IntegrationsSection, {});
			await settle();
			await userEvent.click(addButton());
			await tick();
			const inputs = Array.from(
				document.querySelectorAll<HTMLInputElement>(".ag-detail input"),
			);
			await userEvent.clear(inputs[1]);
			await userEvent.type(inputs[1], "not-a-url");
			const save = detailButtonNamed(/anyway|quand même/i);
			save.disabled = false;
			await userEvent.click(save);
			await settle();
			expect(saveIntegrationConnection).not.toHaveBeenCalled();
		});

		it("closes the form without saving anything", async () => {
			render(IntegrationsSection, {});
			await settle();
			await userEvent.click(addButton());
			await tick();
			const cancel = detailButtons().find((b) =>
				b.classList.contains("ghost"),
			) as HTMLElement;
			await userEvent.click(cancel);
			await tick();
			expect(saveIntegrationConnection).not.toHaveBeenCalled();
		});
	});

	describe("removing a connection", () => {
		/** Removing is irreversible, so it asks first. */
		it("asks before removing anything", async () => {
			connections.set([connection("a")]);
			render(IntegrationsSection, {});
			await settle();
			const remove = rows()[0].parentElement?.querySelector(
				".icon-btn.delete",
			) as HTMLElement;
			await userEvent.click(remove);
			await tick();
			expect(deleteIntegrationConnection).not.toHaveBeenCalled();
		});

		it("removes the connection that was confirmed", async () => {
			connections.set([connection("a")]);
			render(IntegrationsSection, {});
			await settle();
			const remove = rows()[0].parentElement?.querySelector(
				".icon-btn.delete",
			) as HTMLElement;
			await userEvent.click(remove);
			await tick();
			const confirm = Array.from(
				document.querySelectorAll<HTMLElement>(".btn.danger"),
			).pop() as HTMLElement;
			await userEvent.click(confirm);
			await settle();
			expect(deleteIntegrationConnection).toHaveBeenCalledWith("a");
			expect(loadConnections).toHaveBeenCalledTimes(2);
		});
	});
});
