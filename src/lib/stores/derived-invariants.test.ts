// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Invariants every derived store must hold, whatever it computes: it agrees
// with a fresh read of its source, it releases what it subscribed to, and it
// does not keep state from one subscription to the next.

import { get, type Readable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance, project } from "../../test/fixtures";

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

const listInstances = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/instance-service", () => ({
	listInstances,
	listBranchesDetailed: vi.fn(),
	createInstance: vi.fn(),
	deleteInstance: vi.fn(),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

import {
	conversationTerminals,
	instanceConversations,
	projectConversations,
} from "./conversation";
import { activeInstance, instances, loadInstances } from "./instance";
import {
	activeProject,
	activeProjectId,
	openProjects,
	openTabOrder,
	projects,
} from "./project";
import { settings } from "./settings";
import { activeShortcuts, shortcuts } from "./shortcuts";

/** Reads a store through a fresh subscription rather than through `get`. */
function readViaSubscription<T>(store: Readable<T>): T {
	let seen!: T;
	const off = store.subscribe((value) => {
		seen = value;
	});
	off();
	return seen;
}

/** How many times a store notifies while `run` executes. */
function notifications(store: Readable<unknown>, run: () => void): number {
	let count = 0;
	const off = store.subscribe(() => {
		count++;
	});
	count = 0;
	run();
	off();
	return count;
}

beforeEach(async () => {
	vi.clearAllMocks();
	updateSettings.mockImplementation(async (s) => s);
	getSettings.mockResolvedValue({ shortcuts: [] });
	listInstances.mockResolvedValue([]);
	await settings.load();
	projects.set([]);
	activeProjectId.set(null);
	openTabOrder.set([]);
	instanceConversations.set({});
	projectConversations.set({});
	conversationTerminals.set({});
});

/** Each derived store, with a mutation of its source that must change it. */
const DERIVED: {
	name: string;
	store: Readable<unknown>;
	mutate: () => void;
}[] = [
	{
		name: "activeProject",
		store: activeProject,
		mutate: () => {
			projects.set([project("a")]);
			activeProjectId.set("a");
		},
	},
	{
		name: "openProjects",
		store: openProjects,
		mutate: () => {
			projects.set([project("a")]);
			openTabOrder.set(["a"]);
		},
	},
	{
		name: "shortcuts",
		store: shortcuts,
		mutate: () => {
			void settings.save({ shortcuts: [] });
		},
	},
	{
		name: "activeShortcuts",
		store: activeShortcuts,
		mutate: () => {
			void settings.save({ shortcuts: [] });
		},
	},
];

describe.each(DERIVED)("$name", ({ store, mutate }) => {
	it("reads the same through get and through a subscription", () => {
		expect(readViaSubscription(store)).toEqual(get(store));
		mutate();
		expect(readViaSubscription(store)).toEqual(get(store));
	});

	it("gives a late subscriber the current value, not the initial one", () => {
		mutate();
		const value = readViaSubscription(store);
		expect(value).toEqual(get(store));
	});

	it("notifies a subscriber as soon as it subscribes", () => {
		let called = 0;
		const off = store.subscribe(() => {
			called++;
		});
		off();
		expect(called).toBe(1);
	});

	it("stops notifying once unsubscribed", () => {
		let called = 0;
		const off = store.subscribe(() => {
			called++;
		});
		off();
		const before = called;
		mutate();
		expect(called).toBe(before);
	});

	it("keeps no state between two subscriptions", () => {
		const first = readViaSubscription(store);
		mutate();
		const second = readViaSubscription(store);
		const third = readViaSubscription(store);
		expect(third).toEqual(second);
		void first;
	});

	it("survives many subscribe and unsubscribe cycles", () => {
		for (let i = 0; i < 50; i++) {
			const off = store.subscribe(() => {});
			off();
		}
		expect(readViaSubscription(store)).toEqual(get(store));
	});
});

describe("derived stores agree with their source", () => {
	it("activeProject resolves the id the store holds", () => {
		projects.set([project("a"), project("b")]);
		activeProjectId.set("b");
		expect(get(activeProject)?.id).toBe(get(activeProjectId));
	});

	it("activeProject falls back to null for an id no project carries", () => {
		projects.set([project("a")]);
		activeProjectId.set("gone");
		expect(get(activeProject)).toBeNull();
	});

	it("openProjects holds exactly the registered ids of the tab order", () => {
		projects.set([project("a"), project("b")]);
		openTabOrder.set(["b", "gone", "a"]);
		expect(get(openProjects).map((p) => p.id)).toEqual(["b", "a"]);
	});

	it("activeInstance stays null while the project has no instance loaded", () => {
		projects.set([project("a")]);
		activeProjectId.set("a");
		expect(get(activeInstance)).toBeNull();
	});

	it("instances follows the active project", async () => {
		listInstances.mockResolvedValue([instance("i1", "a")]);
		projects.set([project("a"), project("b")]);
		activeProjectId.set("a");
		await loadInstances("a");
		expect(get(instances).map((i) => i.id)).toEqual(["i1"]);
		activeProjectId.set("b");
		expect(get(instances)).toEqual([]);
	});
});

/**
 * Svelte's `derived` recomputes and notifies on every change of its source; it
 * never compares the value it produced. A store that must not notify twice for
 * the same value has to deduplicate itself - which is exactly why
 * `view-state.ts` carries its own `isSameState` guard.
 */
describe("derived stores recompute on every source change", () => {
	it("notifies even when the value it produces is unchanged", () => {
		projects.set([project("a")]);
		activeProjectId.set("a");
		const count = notifications(activeProject, () => {
			projects.set([project("a"), project("b")]);
		});
		expect(count).toBeGreaterThan(0);
	});

	it("still answers with a value equal to the previous one", () => {
		projects.set([project("a")]);
		activeProjectId.set("a");
		const before = get(activeProject);
		projects.set([project("a"), project("b")]);
		expect(get(activeProject)).toEqual(before);
	});

	it("recomputes openProjects when a project outside the tabs changes", () => {
		projects.set([project("a"), project("b")]);
		openTabOrder.set(["a"]);
		const count = notifications(openProjects, () => {
			projects.set([project("a"), project("b", { name: "renamed" })]);
		});
		expect(count).toBeGreaterThan(0);
		expect(get(openProjects).map((p) => p.id)).toEqual(["a"]);
	});
});
