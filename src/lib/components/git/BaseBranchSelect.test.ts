import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import BaseBranchSelect from "./BaseBranchSelect.svelte";

const BRANCHES = ["main", "develop", "origin/main", "origin/v2.x", "feature/x"];

function mount(props: Record<string, unknown> = {}) {
	const change = vi.fn();
	const { container } = render(BaseBranchSelect, {
		props: { branches: BRANCHES, ...props },
		events: { change: (e: CustomEvent) => change(e.detail) },
	});
	return { container, change };
}

const trigger = (c: HTMLElement) =>
	c.querySelector(".bbs-trigger") as HTMLButtonElement;
const options = (c: HTMLElement) =>
	[...c.querySelectorAll(".bbs-item")] as HTMLButtonElement[];
const search = (c: HTMLElement) =>
	c.querySelector(".bbs-search") as HTMLInputElement | null;

async function open(c: HTMLElement) {
	await userEvent.click(trigger(c));
	await tick();
}

describe("BaseBranchSelect", () => {
	it("shows the selected branch on the trigger", () => {
		const { container } = mount({ value: "origin/v2.x" });
		expect(trigger(container).textContent).toContain("origin/v2.x");
	});

	it("keeps the list closed until it is asked for", async () => {
		const { container } = mount();
		expect(search(container)).toBeNull();
		await open(container);
		expect(search(container)).not.toBeNull();
	});

	it("offers every branch it was given", async () => {
		const { container } = mount();
		await open(container);
		const labels = options(container).map((o) => o.textContent?.trim());
		for (const branch of BRANCHES) {
			expect(labels.some((l) => l?.includes(branch))).toBe(true);
		}
	});

	/** A branch compared with itself has no diff, so it is never a candidate. */
	it("never offers the excluded branch", async () => {
		const { container } = mount({ exclude: "feature/x" });
		await open(container);
		const labels = options(container).map((o) => o.textContent?.trim());
		expect(labels.some((l) => l?.includes("feature/x"))).toBe(false);
		expect(labels.some((l) => l?.includes("main"))).toBe(true);
	});

	it("reports the branch that was chosen", async () => {
		const { container, change } = mount();
		await open(container);
		const target = options(container).find((o) =>
			o.textContent?.includes("develop"),
		) as HTMLButtonElement;
		await userEvent.click(target);
		expect(change).toHaveBeenCalledWith({ branch: "develop" });
	});

	it("says nothing when the branch picked is the one already set", async () => {
		const { container, change } = mount({ value: "develop" });
		await open(container);
		const target = options(container).find(
			(o) => o.textContent?.trim() === "develop",
		) as HTMLButtonElement;
		await userEvent.click(target);
		expect(change).not.toHaveBeenCalled();
	});

	it("narrows the list to what was typed", async () => {
		const { container } = mount();
		await open(container);
		await userEvent.type(search(container) as HTMLInputElement, "v2");
		await tick();
		const labels = options(container).map((o) => o.textContent?.trim());
		expect(labels.some((l) => l?.includes("origin/v2.x"))).toBe(true);
		expect(labels.some((l) => l?.includes("develop"))).toBe(false);
	});

	/** An instance may legitimately have no base, so clearing has to be possible. */
	it("offers to clear a base that is set, and reports it empty", async () => {
		const { container, change } = mount({ value: "main" });
		await open(container);
		const clear = container.querySelector(
			".bbs-item.clear",
		) as HTMLButtonElement;
		expect(clear).not.toBeNull();
		await userEvent.click(clear);
		expect(change).toHaveBeenCalledWith({ branch: "" });
	});

	it("offers nothing to clear when no base is set", async () => {
		const { container } = mount({ value: "" });
		await open(container);
		expect(container.querySelector(".bbs-item.clear")).toBeNull();
	});

	it("says so when nothing matches the search", async () => {
		const { container } = mount();
		await open(container);
		await userEvent.type(search(container) as HTMLInputElement, "zzzz");
		await tick();
		expect(options(container)).toHaveLength(0);
		expect(container.querySelector(".bbs-empty")).not.toBeNull();
	});

	it("shows the unset label in place of an empty value", () => {
		const { container } = mount({
			value: "",
			isUnset: true,
			unsetLabel: "No base",
		});
		expect(trigger(container).textContent).toContain("No base");
		expect(trigger(container).className).toContain("unset");
	});

	it("does not open while disabled", async () => {
		const { container } = mount({ disabled: true });
		await userEvent.click(trigger(container));
		await tick();
		expect(search(container)).toBeNull();
	});

	/**
	 * Inside a modal the panel would be clipped by the modal's own scroll
	 * container, which is what made the branch list unreachable. It is positioned
	 * in fixed coordinates so it escapes any overflow ancestor.
	 */
	it("positions the panel outside the flow of its container", async () => {
		const { container } = mount();
		await open(container);
		const panel = container.querySelector(".bbs-panel") as HTMLElement;
		expect(panel).not.toBeNull();
		// jsdom does not apply the scoped stylesheet, so the inline placement is
		// what proves the panel is driven by viewport coordinates rather than by
		// its position in the modal's flow.
		const style = panel.getAttribute("style") ?? "";
		expect(style).toMatch(/left:\s*-?\d/);
		expect(style).toMatch(/(top|bottom):\s*-?\d/);
		expect(style).toMatch(/width:\s*\d/);
	});

	it("closes when the surface behind it scrolls away", async () => {
		const { container } = mount();
		await open(container);
		expect(container.querySelector(".bbs-panel")).not.toBeNull();
		document.dispatchEvent(new Event("scroll", { bubbles: true }));
		await tick();
		expect(container.querySelector(".bbs-panel")).toBeNull();
	});

	it("keeps the panel open while the list itself is scrolled", async () => {
		const { container } = mount();
		await open(container);
		const list = container.querySelector(".bbs-list") as HTMLElement;
		list.dispatchEvent(new Event("scroll", { bubbles: true }));
		await tick();
		expect(container.querySelector(".bbs-panel")).not.toBeNull();
	});
});
