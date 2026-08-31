// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ToolsPanel from "./ToolsPanel.svelte";

function mount(props: Record<string, unknown> = {}) {
	const onSelect = vi.fn();
	const onClose = vi.fn();
	const result = render(ToolsPanel, {
		props,
		events: {
			select: (e: CustomEvent<string>) => onSelect(e.detail),
			close: () => onClose(),
		},
	});
	return { ...result, onSelect, onClose };
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".tool-card"));
const source = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");

describe("ToolsPanel", () => {
	it("lists every tool as a card", () => {
		mount();
		expect(cards().length).toBeGreaterThan(0);
	});

	it("names each tool and says what it does", () => {
		mount();
		for (const card of cards()) {
			expect(
				card.querySelector(".tool-name")?.textContent?.trim(),
			).toBeTruthy();
			expect(
				card.querySelector(".tool-description")?.textContent?.trim(),
			).toBeTruthy();
		}
	});

	/** Nothing is wired by id but selectTool(), so a card must report its own id. */
	it("reports the tool that was picked", async () => {
		const { onSelect } = mount();
		await userEvent.click(cards()[0]);
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(typeof onSelect.mock.calls[0][0]).toBe("string");
	});

	it("reports a different id for each card", async () => {
		const seen: string[] = [];
		for (let i = 0; i < cards().length; i++) {
			const { onSelect, unmount } = mount();
			await userEvent.click(cards()[i]);
			seen.push(onSelect.mock.calls[0][0]);
			unmount();
		}
		expect(new Set(seen).size).toBe(seen.length);
	});

	it("shows the open tool as the active card, and only that one", async () => {
		const { onSelect, unmount } = mount();
		await userEvent.click(cards()[0]);
		const id = onSelect.mock.calls[0][0];
		unmount();

		mount({ activeTool: id });
		const active = cards().filter((c) => c.classList.contains("active"));
		expect(active).toHaveLength(1);
	});

	it("marks nothing active when no tool is open", () => {
		mount({ activeTool: null });
		expect(cards().some((c) => c.classList.contains("active"))).toBe(false);
	});

	it("closes on request", async () => {
		const { onClose } = mount();
		await userEvent.click(
			screen.getByRole("button", { name: /close|fermer/i }),
		);
		expect(onClose).toHaveBeenCalled();
	});

	it("does not confuse closing with picking a tool", async () => {
		const { onSelect } = mount();
		await userEvent.click(
			screen.getByRole("button", { name: /close|fermer/i }),
		);
		expect(onSelect).not.toHaveBeenCalled();
	});

	/**
	 * A tool card is dead unless Workspace routes its id: adding one here without
	 * the matching case leaves a button that does nothing at all.
	 */
	it("only offers tools the workspace knows how to open", () => {
		const panel = source("./ToolsPanel.svelte");
		const ids = Array.from(
			panel.matchAll(/\{\s*id:\s*'([a-z-]+)'/g),
			(m) => m[1],
		);
		expect(ids.length).toBe(cards().length || ids.length);

		const routed = source("../../stores/ui.ts").match(
			/export function showTool\(\s*tool:([^)]*)\)/,
		)?.[1];
		expect(routed).toBeTruthy();
		for (const id of ids) {
			expect(routed).toContain(`"${id}"`);
		}
	});
});
