// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PipelineSkeleton from "$lib/components/cicd/PipelineSkeleton.svelte";
import ProviderLogo from "$lib/components/home/agents/ProviderLogo.svelte";
import InstallProgress from "$lib/components/InstallProgress.svelte";
import CairnLogo from "$lib/components/layout/CairnLogo.svelte";
import LazyView from "$lib/components/layout/LazyView.svelte";
import LoadingScreen from "$lib/components/layout/LoadingScreen.svelte";
import ProjectColorPicker from "$lib/components/ProjectColorPicker.svelte";
import ProjectPreviewPill from "$lib/components/ProjectPreviewPill.svelte";
import Skeleton from "$lib/components/Skeleton.svelte";
import Spinner from "$lib/components/Spinner.svelte";

/**
 * The presentational primitives. What is worth pinning down here is not their
 * markup - which will change - but the few decisions they actually make: how
 * many shapes they draw, whether they scale to the size asked for, and that
 * they never claim a state they were not given.
 */

describe("Spinner", () => {
	const svg = () => document.querySelector("svg.spinner") as SVGElement;

	it("draws at the size it was asked for", () => {
		render(Spinner, { size: 24 });
		expect(svg().getAttribute("width")).toBe("24");
		expect(svg().getAttribute("height")).toBe("24");
	});

	it("has a default size, so it can be dropped in anywhere", () => {
		render(Spinner, {});
		expect(Number(svg().getAttribute("width"))).toBeGreaterThan(0);
	});

	/**
	 * The arc is drawn in a fixed viewBox and scaled, so its stroke has to be
	 * converted: a spinner asked for at 10px with a 2px stroke must not draw a
	 * 2/24th hairline.
	 */
	it("scales the stroke with the size, rather than drawing a hairline", () => {
		render(Spinner, { size: 12, stroke: 2 });
		const arc = svg().querySelector("circle:last-of-type") as SVGCircleElement;
		expect(Number(arc.getAttribute("stroke-width"))).toBeGreaterThan(2);
	});

	it("takes the colours it was given", () => {
		render(Spinner, { size: 16, color: "red", trackColor: "blue" });
		const html = svg().outerHTML;
		expect(html).toContain("red");
		expect(html).toContain("blue");
	});
});

describe("Skeleton", () => {
	const lines = () => document.querySelectorAll(".sk-line, .skeleton-line");

	it("draws one line by default", () => {
		render(Skeleton, {});
		expect(lines()).toHaveLength(1);
	});

	it("draws as many lines as asked for", () => {
		render(Skeleton, { lines: 5 });
		expect(lines()).toHaveLength(5);
	});

	it("draws nothing when asked for nothing", () => {
		render(Skeleton, { lines: 0 });
		expect(lines()).toHaveLength(0);
	});

	it("takes the height and gap it was given", () => {
		render(Skeleton, { lines: 2, height: 20, gap: 14 });
		const first = lines()[0] as HTMLElement;
		expect(first.style.cssText).toContain("20px");
	});
});

describe("PipelineSkeleton", () => {
	const cards = () => document.querySelectorAll(".skeleton-card");

	it("draws as many placeholder cards as asked for", () => {
		render(PipelineSkeleton, { cards: 4 });
		expect(cards().length).toBeGreaterThan(0);
		expect(cards()).toHaveLength(4);
	});

	it("draws a default number of them", () => {
		render(PipelineSkeleton, {});
		expect(cards().length).toBeGreaterThan(0);
	});
});

describe("CairnLogo", () => {
	it("draws at the size it was asked for", () => {
		render(CairnLogo, { size: 40 });
		const svg = document.querySelector("svg") as SVGElement;
		expect(svg.getAttribute("width")).toBe("40");
	});
});

describe("LoadingScreen", () => {
	/** The app's own first screen: an animation, never the word "loading". */
	it("shows an animation rather than a word", () => {
		render(LoadingScreen, {});
		expect(document.querySelector("svg")).not.toBeNull();
		expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
	});
});

describe("ProjectPreviewPill", () => {
	it("shows the project name", () => {
		render(ProjectPreviewPill, { name: "my-project", color: "#f00" });
		expect(document.body.textContent).toContain("my-project");
	});

	/** jsdom normalises a hex colour to rgb(), so the value is read back parsed. */
	it("carries the project colour on its dot and its label", () => {
		render(ProjectPreviewPill, { name: "p", color: "#123456" });
		const dot = document.querySelector(".preview-dot") as HTMLElement;
		const label = document.querySelector(".preview-label") as HTMLElement;
		expect(dot.style.background).toBe("rgb(18, 52, 86)");
		expect(label.style.color).toBe("rgb(18, 52, 86)");
	});

	it("draws a different pill for a different colour", () => {
		const { unmount } = render(ProjectPreviewPill, {
			name: "p",
			color: "#123456",
		});
		const first = (document.querySelector(".preview-dot") as HTMLElement).style
			.background;
		unmount();
		render(ProjectPreviewPill, { name: "p", color: "#654321" });
		expect(
			(document.querySelector(".preview-dot") as HTMLElement).style.background,
		).not.toBe(first);
	});
});

describe("ProviderLogo", () => {
	it("draws the brand mark of a provider it knows", () => {
		render(ProviderLogo, { id: "anthropic", size: 20 });
		const svg = document.querySelector("svg") as SVGElement;
		expect(svg).not.toBeNull();
		expect(svg.getAttribute("width")).toBe("20");
	});

	/** An unknown provider still needs a mark, so the fallback stands in. */
	it("falls back to the initial for a provider it does not know", () => {
		render(ProviderLogo, { id: "nothing-known", size: 20, fallback: "N" });
		expect(document.body.textContent).toContain("N");
	});
});

describe("ProjectColorPicker", () => {
	const swatches = () =>
		Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
	const custom = () =>
		Array.from(
			document.querySelectorAll<HTMLInputElement>('input[type="color"]'),
		);

	it("offers a choice of preset colours", () => {
		render(ProjectColorPicker, { color: "#000000" });
		expect(swatches().length).toBeGreaterThan(1);
	});

	it("offers a free colour beside the presets", () => {
		render(ProjectColorPicker, { color: "#000000" });
		expect(custom()).toHaveLength(1);
	});

	/**
	 * Two pickers on one screen must not share an input id, or the label of one
	 * would drive the other.
	 */
	it("keeps two pickers on one screen apart", () => {
		render(ProjectColorPicker, { color: "#000000", idSuffix: "a" });
		render(ProjectColorPicker, { color: "#000000", idSuffix: "b" });
		const ids = new Set(custom().map((c) => c.id));
		expect(ids.size).toBe(2);
	});

	/** `color` is bound, so picking a preset writes it back to the caller. */
	it("picks the preset that was clicked", async () => {
		render(ProjectColorPicker, { color: "#000000" });
		expect(custom()[0].value).toBe("#000000");
		await userEvent.click(swatches()[1]);
		await tick();
		expect(custom()[0].value).not.toBe("#000000");
	});
});

describe("InstallProgress", () => {
	const NOW = 1_700_000_000_000;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const elapsed = () => document.querySelector(".elapsed")?.textContent;

	it("shows the last line of output", () => {
		render(InstallProgress, { line: "unpacking...", startedAt: NOW });
		expect(document.querySelector(".line")?.textContent).toBe("unpacking...");
	});

	it("counts in seconds under a minute", () => {
		render(InstallProgress, { line: "", startedAt: NOW - 42_000 });
		expect(elapsed()).toBe("42s");
	});

	it("counts in minutes and seconds past a minute", () => {
		render(InstallProgress, { line: "", startedAt: NOW - 125_000 });
		expect(elapsed()).toBe("2m 05s");
	});

	it("never counts backwards", () => {
		render(InstallProgress, { line: "", startedAt: NOW + 5_000 });
		expect(elapsed()).toBe("0s");
	});

	/** The elapsed time ticks on its own, without the caller re-rendering. */
	it("ticks the elapsed time by itself", async () => {
		render(InstallProgress, { line: "", startedAt: NOW });
		expect(elapsed()).toBe("0s");
		await vi.advanceTimersByTimeAsync(3000);
		await tick();
		expect(elapsed()).toBe("3s");
	});

	/** An install with no way to stop it must not show a dead button. */
	it("offers to cancel only where the caller can", () => {
		const { unmount } = render(InstallProgress, { line: "", startedAt: NOW });
		expect(document.querySelector(".cancel")).toBeNull();
		unmount();

		render(InstallProgress, { line: "", startedAt: NOW, onCancel: vi.fn() });
		expect(document.querySelector(".cancel")).not.toBeNull();
	});

	it("cancels on request", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const onCancel = vi.fn();
		render(InstallProgress, { line: "", startedAt: NOW, onCancel });
		await user.click(document.querySelector(".cancel") as HTMLElement);
		expect(onCancel).toHaveBeenCalled();
	});

	/** The interval must not outlive the banner. */
	it("stops ticking once it is gone", async () => {
		const { unmount } = render(InstallProgress, { line: "", startedAt: NOW });
		unmount();
		await vi.advanceTimersByTimeAsync(5000);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("LazyView", () => {
	/** The shape LazyView expects of its `load` prop. */
	type LoadFn = ComponentProps<typeof LazyView>["load"];

	/**
	 * Every view imported statically put xterm and the git panels in the first
	 * chunk, paid for at startup even by someone who only opens Files. So a view
	 * is loaded the first time it is shown - and never twice.
	 */
	it("loads nothing until it is shown", () => {
		const load = vi.fn();
		render(LazyView, { load, active: false });
		expect(load).not.toHaveBeenCalled();
	});

	it("loads the view the first time it is shown", async () => {
		const load = vi.fn().mockResolvedValue({
			default: (await import("./stubs/DiffEditorStub.svelte")).default,
		});
		render(LazyView, { load, active: true });
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
	});

	/** A load that resolves in a few ms shows nothing at all: the spinner is
	    held back 150 ms so a fast open never flashes a loading state. */
	it("shows a spinner rather than a word once the load drags on", async () => {
		render(LazyView, { load: () => new Promise(() => {}), active: true });
		expect(document.querySelector(".lazy-pending .spinner")).toBeNull();
		await vi.waitFor(() =>
			expect(document.querySelector(".lazy-pending .spinner")).not.toBeNull(),
		);
		expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
	});

	/** Once mounted the view stays mounted, so its state survives a tab switch. */
	it("keeps the view mounted when it is hidden again", async () => {
		const load = vi.fn().mockResolvedValue({
			default: (await import("./stubs/DiffEditorStub.svelte")).default,
		});
		const { rerender } = render(LazyView, { load, active: true });
		await vi.waitFor(() =>
			expect(document.querySelector("[data-diff]")).not.toBeNull(),
		);

		await rerender({ load, active: false });
		expect(document.querySelector("[data-diff]")).not.toBeNull();
		await rerender({ load, active: true });
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("does not load twice while the first load is still running", async () => {
		type Loaded = Awaited<ReturnType<LoadFn>>;
		let settle: (v: Loaded) => void = () => {};
		const load = vi.fn(
			() =>
				new Promise<Loaded>((resolve) => {
					settle = resolve;
				}),
		);
		const { rerender } = render(LazyView, { load, active: true });
		await rerender({ load, active: false });
		await rerender({ load, active: true });
		expect(load).toHaveBeenCalledTimes(1);
		settle({
			default: (await import("./stubs/DiffEditorStub.svelte")).default,
		});
	});
});
