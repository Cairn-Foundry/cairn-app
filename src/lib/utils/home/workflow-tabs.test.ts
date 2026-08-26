import { describe, expect, it } from "vitest";
import { DEFAULT_WF_TABS } from "./workflow-tabs";

describe("DEFAULT_WF_TABS", () => {
	it("offers every workflow step the sidebar knows", () => {
		expect(DEFAULT_WF_TABS.map((t) => t.key).sort()).toEqual([
			"agent",
			"cicd",
			"files",
			"git",
			"review",
			"tests",
		]);
	});

	it("numbers the order contiguously from zero", () => {
		expect(DEFAULT_WF_TABS.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("stores the order rather than implying it from position", () => {
		const byOrder = [...DEFAULT_WF_TABS].sort((a, b) => a.order - b.order);
		expect(byOrder.map((t) => t.key)).toEqual(
			DEFAULT_WF_TABS.map((t) => t.key),
		);
	});

	it("enables every tab out of the box", () => {
		for (const tab of DEFAULT_WF_TABS) {
			expect(tab.enabled, tab.key).toBe(true);
		}
	});

	it("gives each tab an icon and no two tabs the same key", () => {
		const keys = DEFAULT_WF_TABS.map((t) => t.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const tab of DEFAULT_WF_TABS) {
			expect(tab.icon, tab.key).toMatch(/^[a-z0-9-]+$/);
		}
	});

	it("names each tab from i18n rather than leaving the key visible", () => {
		for (const tab of DEFAULT_WF_TABS) {
			expect(tab.name, tab.key).toBeTruthy();
			expect(tab.name, tab.key).not.toMatch(/^workflowTabs\./);
		}
	});

	it("opens on files, which is the step a project lands on", () => {
		expect(DEFAULT_WF_TABS.find((t) => t.order === 0)?.key).toBe("files");
	});
});
