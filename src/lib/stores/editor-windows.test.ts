// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { TabPayload } from "#lib/utils/files/tab-transfer";
import {
	incomingTabs,
	queueIncomingTabs,
	takeIncomingTabs,
} from "./editor-windows";

const tab = (path: string) => ({ path }) as unknown as TabPayload;
const pathOf = (t: TabPayload) => (t as unknown as { path: string }).path;

beforeEach(() => {
	incomingTabs.set([]);
});

describe("queueIncomingTabs", () => {
	it("appends the tabs behind the ones already waiting", () => {
		const [a, b, c] = [tab("a"), tab("b"), tab("c")];
		queueIncomingTabs([a]);
		queueIncomingTabs([b, c]);
		expect(get(incomingTabs)).toEqual([a, b, c]);
	});

	it("does not notify subscribers when there is nothing to queue", () => {
		let notifications = 0;
		const stop = incomingTabs.subscribe(() => notifications++);
		queueIncomingTabs([]);
		stop();
		expect(notifications).toBe(1);
		expect(get(incomingTabs)).toEqual([]);
	});
});

describe("takeIncomingTabs", () => {
	it("removes and returns the tabs the filter accepts, leaving the rest queued", () => {
		const [a, b, c] = [tab("a"), tab("b"), tab("c")];
		queueIncomingTabs([a, b, c]);
		const taken = takeIncomingTabs((t) => pathOf(t) !== "b");
		expect(taken).toEqual([a, c]);
		expect(get(incomingTabs)).toEqual([b]);
	});

	it("removes a single accepted tab from the queue", () => {
		const [a, b] = [tab("a"), tab("b")];
		queueIncomingTabs([a, b]);
		expect(takeIncomingTabs((t) => pathOf(t) === "a")).toEqual([a]);
		expect(get(incomingTabs)).toEqual([b]);
	});

	it("returns nothing and leaves the queue untouched when nothing is accepted", () => {
		const a = tab("a");
		queueIncomingTabs([a]);
		expect(takeIncomingTabs(() => false)).toEqual([]);
		expect(get(incomingTabs)).toEqual([a]);
	});

	it("does not notify subscribers when nothing is taken", () => {
		queueIncomingTabs([tab("a")]);
		let notifications = 0;
		const stop = incomingTabs.subscribe(() => notifications++);
		takeIncomingTabs(() => false);
		stop();
		expect(notifications).toBe(1);
	});

	it("empties the queue when everything is accepted", () => {
		queueIncomingTabs([tab("a"), tab("b")]);
		expect(takeIncomingTabs(() => true)).toHaveLength(2);
		expect(get(incomingTabs)).toEqual([]);
	});
});
