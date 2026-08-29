import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	IntegrationConnection,
	IntegrationKindDescriptor,
	ProjectIntegrations,
} from "$lib/types/integrations";

const loadKinds = vi.fn();
const loadConnections = vi.fn();
const suggestProjectIntegrations = vi.fn();
const listTrackerProjects = vi.fn();
const listTrackerStatuses = vi.fn();

vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadKinds: (...a: unknown[]) => loadKinds(...a),
	loadConnections: (...a: unknown[]) => loadConnections(...a),
}));

vi.mock("$lib/services/integration-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	suggestProjectIntegrations: (...a: unknown[]) =>
		suggestProjectIntegrations(...a),
	listTrackerProjects: (...a: unknown[]) => listTrackerProjects(...a),
	trackerListStatuses: (...a: unknown[]) => listTrackerStatuses(...a),
}));

const { connections, kindDescriptors, EMPTY_BINDINGS } = await import(
	"$lib/stores/integrations"
);
const { default: IntegrationsFormHost } = await import(
	"./stubs/IntegrationsFormHost.svelte"
);

const PICKER_DEBOUNCE_MS = 250;

function connection(
	id: string,
	kind: string,
	label = id,
): IntegrationConnection {
	return {
		id,
		kind,
		label,
		baseUrl: "https://example.com",
		hasCredentials: true,
		identity: null,
		createdAt: 0,
	} as IntegrationConnection;
}

function descriptor(
	kind: string,
	provides: string[],
): IntegrationKindDescriptor {
	return {
		kind,
		label: kind,
		provides,
		terms: {},
		tokenHelpUrl: "",
		requiredScopes: [],
	} as unknown as IntegrationKindDescriptor;
}

function bindings(
	overrides: Partial<ProjectIntegrations> = {},
): ProjectIntegrations {
	return { ...EMPTY_BINDINGS, ...overrides };
}

/**
 * Rendered through a host that holds the two-way `bindings`, the way the real
 * parent does: the form writes the value back rather than dispatching it.
 */
function mount(props: Record<string, unknown> = {}) {
	let latest: ProjectIntegrations = bindings();
	const rendered = render(IntegrationsFormHost, {
		projectId: "p1",
		remoteUrl: "git@example.com:me/app.git",
		bindings: bindings(),
		onBindings: (value: ProjectIntegrations) => {
			latest = value;
		},
		...props,
	});
	return { ...rendered, current: () => latest };
}

const fields = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".pi-field"));
const selectIn = (index: number) =>
	fields()[index].querySelector(".select-trigger") as HTMLElement;
const suggestion = () => document.querySelector(".pi-suggest");
const suggestButtons = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".pi-suggest .btn"));

/** Picks an option out of the nth field's Select, by its visible label. */
async function pick(index: number, label: RegExp) {
	await userEvent.click(selectIn(index));
	await userEvent.click(screen.getByRole("option", { name: label }));
	await tick();
}

const TRACKER = 0;
const FORGE = 1;
const CI = 2;

async function settle() {
	await tick();
	await tick();
	await tick();
}

beforeEach(() => {
	loadKinds.mockReset().mockResolvedValue(undefined);
	loadConnections.mockReset().mockResolvedValue(undefined);
	suggestProjectIntegrations.mockReset().mockResolvedValue(EMPTY_BINDINGS);
	listTrackerProjects.mockReset().mockResolvedValue([]);
	listTrackerStatuses.mockReset().mockResolvedValue([]);
	connections.set([
		connection("gh", "github", "GitHub"),
		connection("jira", "jira", "Jira"),
	]);
	kindDescriptors.set([
		descriptor("github", ["forge", "ci", "tracker"]),
		descriptor("jira", ["tracker"]),
	]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("ProjectIntegrationsForm", () => {
	describe("the connections it offers", () => {
		it("loads the kinds and the connections on arrival", async () => {
			mount();
			await settle();
			expect(loadKinds).toHaveBeenCalled();
			expect(loadConnections).toHaveBeenCalled();
		});

		/** A capability is only offered by the connections that provide it. */
		it("offers only the connections providing each capability", async () => {
			mount();
			await settle();
			await userEvent.click(selectIn(FORGE));
			const labels = screen
				.getAllByRole("option")
				.map((o) => o.textContent?.trim());
			expect(labels).toContain("GitHub");
			expect(labels).not.toContain("Jira");
		});

		it("offers both where both provide the capability", async () => {
			mount();
			await settle();
			await userEvent.click(selectIn(TRACKER));
			const labels = screen
				.getAllByRole("option")
				.map((o) => o.textContent?.trim());
			expect(labels).toContain("GitHub");
			expect(labels).toContain("Jira");
		});

		/** Nothing bound is always an option, so a binding can be removed. */
		it("always offers to bind nothing", async () => {
			mount();
			await settle();
			await userEvent.click(selectIn(FORGE));
			expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
		});
	});

	describe("binding a capability", () => {
		it("binds the forge to the connection that was picked", async () => {
			const { current } = mount();
			await settle();
			await pick(FORGE, /github/i);
			expect(current().forge?.connectionId).toBe("gh");
		});

		/** The repository path is prefilled from the project's own remote. */
		it("prefills the repository path from the remote", async () => {
			const { current } = mount({
				remoteUrl: "git@example.com:me/app.git",
			});
			await settle();
			await pick(FORGE, /github/i);
			expect(current().forge?.repoPath).toBe("me/app");
		});

		it("unbinds when nothing is picked", async () => {
			const { current } = mount({
				bindings: bindings({ forge: { connectionId: "gh", repoPath: "x" } }),
			});
			await settle();
			await pick(FORGE, /none|aucun/i);
			expect(current().forge).toBeNull();
		});

		/**
		 * Forge and CI on one connection are one repository: binding the second
		 * takes the path the first already has rather than starting again.
		 */
		it("shares the repository path between forge and ci on one connection", async () => {
			const { current } = mount({
				bindings: bindings({
					forge: { connectionId: "gh", repoPath: "me/edited" },
				}),
			});
			await settle();
			await pick(CI, /github/i);
			expect(current().ci?.repoPath).toBe("me/edited");
		});

		it("binds a tracker that also provides the forge with the remote path", async () => {
			const { current } = mount();
			await settle();
			await pick(TRACKER, /github/i);
			expect(current().tracker?.projectKey).toBe("me/app");
		});

		/** A tracker with no forge of its own has no path to guess. */
		it("binds a tracker-only connection with no project key", async () => {
			const { current } = mount();
			await settle();
			await pick(TRACKER, /jira/i);
			expect(current().tracker?.projectKey).toBe("");
		});
	});

	describe("the suggestion", () => {
		const suggested: ProjectIntegrations = {
			...EMPTY_BINDINGS,
			forge: { connectionId: "gh", repoPath: "me/app" },
		};

		it("asks what the remote suggests", async () => {
			mount();
			await settle();
			expect(suggestProjectIntegrations).toHaveBeenCalledWith(
				"p1",
				"git@example.com:me/app.git",
			);
		});

		it("offers what it found", async () => {
			suggestProjectIntegrations.mockResolvedValue(suggested);
			mount();
			await settle();
			expect(suggestion()).not.toBeNull();
		});

		it("offers nothing when it found nothing", async () => {
			mount();
			await settle();
			expect(suggestion()).toBeNull();
		});

		/** Nothing is suggested over bindings the user already made. */
		it("offers nothing when the project is already bound", async () => {
			suggestProjectIntegrations.mockResolvedValue(suggested);
			mount({
				bindings: bindings({ forge: { connectionId: "gh", repoPath: "x" } }),
			});
			await settle();
			expect(suggestion()).toBeNull();
		});

		it("takes the suggestion on request", async () => {
			suggestProjectIntegrations.mockResolvedValue(suggested);
			const { current } = mount();
			await settle();
			await userEvent.click(suggestButtons()[0]);
			await tick();
			expect(current().forge?.connectionId).toBe("gh");
			expect(suggestion()).toBeNull();
		});

		/** Dismissing it leaves the bindings untouched and does not come back. */
		it("dismisses the suggestion without binding anything", async () => {
			suggestProjectIntegrations.mockResolvedValue(suggested);
			const { current } = mount();
			await settle();
			await userEvent.click(suggestButtons()[1]);
			await tick();
			expect(current().forge).toBeNull();
			expect(suggestion()).toBeNull();
		});

		it("offers nothing when the suggestion could not be fetched", async () => {
			suggestProjectIntegrations.mockRejectedValue(new Error("offline"));
			mount();
			await settle();
			expect(suggestion()).toBeNull();
		});

		/** A project with no remote has nothing to suggest from. */
		it("asks for nothing without a remote", async () => {
			mount({ remoteUrl: "" });
			await settle();
			expect(suggestProjectIntegrations).not.toHaveBeenCalled();
		});
	});

	describe("picking a tracker project", () => {
		const withTracker = () =>
			bindings({
				tracker: { connectionId: "jira", projectKey: "", label: "" },
			});

		/**
		 * The keystrokes are dispatched rather than typed: `userEvent` advances
		 * the fake timers between keys, which fires the debounce it is meant to
		 * be held back by.
		 */
		function typeInPicker(text: string) {
			const picker = document.querySelector(
				".pi-picker input",
			) as HTMLInputElement;
			for (let i = 1; i <= text.length; i++) {
				picker.value = text.slice(0, i);
				picker.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return picker;
		}

		it("waits for the typing to settle before searching", async () => {
			vi.useFakeTimers();
			mount({ bindings: withTracker() });
			await tick();
			const before = listTrackerProjects.mock.calls.length;

			typeInPicker("PROJ");
			expect(listTrackerProjects.mock.calls.length).toBe(before);

			await vi.advanceTimersByTimeAsync(PICKER_DEBOUNCE_MS);
			expect(listTrackerProjects).toHaveBeenLastCalledWith("jira", "PROJ");
		});

		/** Four keystrokes are one search, not four. */
		it("searches once for a burst of keystrokes", async () => {
			vi.useFakeTimers();
			mount({ bindings: withTracker() });
			await tick();
			const before = listTrackerProjects.mock.calls.length;

			typeInPicker("PROJ");
			await vi.advanceTimersByTimeAsync(PICKER_DEBOUNCE_MS);
			expect(listTrackerProjects.mock.calls.length).toBe(before + 1);
		});

		/** What is typed is the key, whether or not a project is picked from the list. */
		it("takes what is typed as the project key", async () => {
			const { current } = mount({ bindings: withTracker() });
			await tick();
			const picker = document.querySelector(
				".pi-picker input",
			) as HTMLInputElement;
			await userEvent.type(picker, "PROJ");
			expect(current().tracker?.projectKey).toBe("PROJ");
		});
	});
});
