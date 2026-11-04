// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("#lib/utils/editor/mermaid", () => ({
	renderMermaid: vi.fn(async (host: HTMLElement) => {
		host.innerHTML = "<svg></svg>";
	}),
	pinSvgToViewBox: vi.fn(),
}));

const { default: MermaidViewer } = await import("./MermaidViewer.svelte");

describe("MermaidViewer", () => {
	it("hands over to the source when the source button is pressed", async () => {
		const onShowSource = vi.fn();
		render(MermaidViewer, { props: { source: "graph TD;", onShowSource } });
		await userEvent.click(screen.getByLabelText("Show the source"));
		expect(onShowSource).toHaveBeenCalledTimes(1);
	});

	it("closes on Escape and on the close button", async () => {
		const onClose = vi.fn();
		render(MermaidViewer, { props: { source: "graph TD;", onClose } });
		await userEvent.click(screen.getByLabelText("Close"));
		await userEvent.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("offers neither button when there is nothing to go back to", () => {
		render(MermaidViewer, { props: { source: "graph TD;" } });
		expect(screen.queryByLabelText("Show the source")).toBeNull();
		expect(screen.queryByLabelText("Close")).toBeNull();
	});
});
