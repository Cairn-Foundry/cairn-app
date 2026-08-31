// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import ProjectMenu from "$lib/components/home/ProjectMenu.svelte";

import IconPicker from "$lib/components/IconPicker.svelte";
import ShortcutReference from "$lib/components/ShortcutReference.svelte";
import type { ProjectFolder } from "$lib/types/project";

describe("IconPicker", () => {
	function mount(value = "play") {
		const onSelect = vi.fn();
		render(IconPicker, {
			props: { value },
			events: { select: (e: CustomEvent) => onSelect(e.detail) },
		});
		return { onSelect };
	}

	const trigger = () =>
		document.querySelector(".icon-trigger") as HTMLButtonElement;
	const panel = () => document.querySelector(".icon-panel");
	const search = () =>
		document.querySelector(".icon-search-input") as HTMLInputElement;
	const cells = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".icon-cell"));
	const names = () => cells().map((c) => c.getAttribute("title"));
	const groupLabels = () =>
		Array.from(document.querySelectorAll(".icon-group-label"));

	it("stays closed until it is opened", () => {
		mount();
		expect(panel()).toBeNull();
	});

	it("opens on the trigger, and closes again", async () => {
		mount();
		await userEvent.click(trigger());
		expect(panel()).not.toBeNull();
		await userEvent.click(trigger());
		expect(panel()).toBeNull();
	});

	it("takes the cursor so the user can search straight away", async () => {
		mount();
		await userEvent.click(trigger());
		expect(document.activeElement).toBe(search());
	});

	it("shows every icon, grouped", async () => {
		mount();
		await userEvent.click(trigger());
		expect(cells().length).toBeGreaterThan(10);
		expect(groupLabels().length).toBeGreaterThan(1);
	});

	it("marks the icon already chosen", async () => {
		mount("play");
		await userEvent.click(trigger());
		const active = cells().filter((c) => c.classList.contains("active"));
		expect(active).toHaveLength(1);
		expect(active[0].getAttribute("title")).toBe("play");
	});

	it("narrows the icons to what was searched", async () => {
		mount();
		await userEvent.click(trigger());
		const before = cells().length;
		await userEvent.type(search(), "fold");
		expect(cells().length).toBeLessThan(before);
		expect(names().every((n) => n?.includes("fold"))).toBe(true);
	});

	/** An empty group is not shown as a bare heading. */
	it("drops the groups a search leaves empty", async () => {
		mount();
		await userEvent.click(trigger());
		const before = groupLabels().length;
		await userEvent.type(search(), "fold");
		expect(groupLabels().length).toBeLessThan(before);
	});

	it("says so when nothing matches", async () => {
		mount();
		await userEvent.click(trigger());
		await userEvent.type(search(), "zzzznothing");
		expect(cells()).toHaveLength(0);
		expect(document.querySelector(".icon-empty")).not.toBeNull();
	});

	it("reports the icon that was picked, and closes", async () => {
		const { onSelect } = mount();
		await userEvent.click(trigger());
		const name = names()[3] as string;
		await userEvent.click(cells()[3]);
		expect(onSelect).toHaveBeenCalledWith(name);
		expect(panel()).toBeNull();
	});

	/** Reopening starts from a clean search rather than the last one. */
	it("forgets the previous search when reopened", async () => {
		mount();
		await userEvent.click(trigger());
		await userEvent.type(search(), "fold");
		await userEvent.click(trigger());
		await userEvent.click(trigger());
		expect(search().value).toBe("");
	});

	it("closes on Escape from the search field", async () => {
		mount();
		await userEvent.click(trigger());
		await userEvent.type(search(), "{Escape}");
		expect(panel()).toBeNull();
	});

	it("closes on a click outside", async () => {
		mount();
		await userEvent.click(trigger());
		await userEvent.click(document.body);
		expect(panel()).toBeNull();
	});

	/**
	 * The panel is positioned in fixed coordinates, clamped inside the window.
	 * Asserted on the exact clamped value: a trigger at 790 in an 800px window
	 * would still be "less than 800" unclamped, so a loose bound tests nothing.
	 * 800 - 232 (panel) - 8 (margin) = 560.
	 */
	it("keeps the panel inside the window when the trigger sits at the edge", async () => {
		mount();
		window.innerWidth = 800;
		trigger().getBoundingClientRect = () =>
			({ left: 790, right: 810, top: 100, bottom: 130 }) as DOMRect;
		await userEvent.click(trigger());
		expect((panel() as HTMLElement).style.left).toBe("560px");
	});

	it("leaves the panel where the trigger is when there is room", async () => {
		mount();
		window.innerWidth = 1400;
		trigger().getBoundingClientRect = () =>
			({ left: 300, right: 330, top: 100, bottom: 130 }) as DOMRect;
		await userEvent.click(trigger());
		expect((panel() as HTMLElement).style.left).toBe("300px");
	});

	it("opens upwards when the trigger sits near the bottom", async () => {
		mount();
		window.innerHeight = 600;
		trigger().getBoundingClientRect = () =>
			({ left: 10, right: 40, top: 540, bottom: 570 }) as DOMRect;
		await userEvent.click(trigger());
		const style = (panel() as HTMLElement).getAttribute("style") ?? "";
		expect(style).toContain("bottom:");
		expect(style).not.toContain("top:");
	});

	it("names the trigger for a screen reader", () => {
		mount();
		expect(trigger().getAttribute("aria-label")).toBeTruthy();
	});
});

describe("ProjectMenu", () => {
	function folder(id: string): ProjectFolder {
		return { id, name: id } as ProjectFolder;
	}

	function mount(props: Record<string, unknown> = {}) {
		const spies = {
			edit: vi.fn(),
			duplicate: vi.fn(),
			copyPath: vi.fn(),
			reveal: vi.fn(),
			moveToFolder: vi.fn(),
			removeFromFolder: vi.fn(),
			delete: vi.fn(),
		};
		render(ProjectMenu, {
			props: { folders: [], currentFolderId: null, ...props },
			events: Object.fromEntries(
				Object.entries(spies).map(([name, fn]) => [
					name,
					(e: CustomEvent) => fn(e.detail),
				]),
			),
		});
		return spies;
	}

	const items = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".card-menu-item"));
	const itemNamed = (pattern: RegExp) =>
		items().find((i) => pattern.test(i.textContent ?? "")) as HTMLElement;
	const submenuEntries = () =>
		Array.from(
			document.querySelectorAll<HTMLElement>(".submenu .card-menu-item"),
		);

	it("announces itself as a menu", () => {
		mount();
		expect(screen.getByRole("menu")).toBeTruthy();
		expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(3);
	});

	it("reports each ordinary action on its own entry", async () => {
		const spies = mount();
		for (const [pattern, spy] of [
			[/edit|modifier/i, spies.edit],
			[/duplicate|dupliquer/i, spies.duplicate],
			[/path|chemin/i, spies.copyPath],
			[/delete|supprimer/i, spies.delete],
		] as const) {
			await userEvent.click(itemNamed(pattern));
			expect(spy).toHaveBeenCalled();
		}
	});

	/** Only folders the project is not already in are worth moving it to. */
	it("offers every folder but the one the project is in", () => {
		mount({
			folders: [folder("a"), folder("b"), folder("c")],
			currentFolderId: "b",
		});
		const names = submenuEntries().map((e) => e.textContent?.trim());
		expect(names).toEqual(["a", "c"]);
	});

	it("offers no submenu when there is nowhere else to move it", () => {
		mount({ folders: [folder("a")], currentFolderId: "a" });
		expect(document.querySelector(".submenu")).toBeNull();
	});

	it("offers no submenu when there is no folder at all", () => {
		mount({ folders: [], currentFolderId: null });
		expect(document.querySelector(".submenu")).toBeNull();
	});

	it("reports the folder the project is moved to", async () => {
		const spies = mount({
			folders: [folder("a"), folder("b")],
			currentFolderId: "a",
		});
		await userEvent.click(submenuEntries()[0]);
		expect(spies.moveToFolder).toHaveBeenCalledWith("b");
	});

	/** Taking a project out of a folder only makes sense when it is in one. */
	it("offers to take the project out only when it is in a folder", () => {
		const { unmount } = render(ProjectMenu, {
			props: { folders: [folder("a")], currentFolderId: "a" },
		});
		expect(itemNamed(/remove|retirer/i)).toBeTruthy();
		unmount();

		render(ProjectMenu, {
			props: { folders: [folder("a")], currentFolderId: null },
		});
		expect(itemNamed(/remove|retirer/i)).toBeUndefined();
	});

	it("reports taking the project out of its folder", async () => {
		const spies = mount({ folders: [folder("a")], currentFolderId: "a" });
		await userEvent.click(itemNamed(/remove|retirer/i));
		expect(spies.removeFromFolder).toHaveBeenCalled();
	});

	/** The menu sits on a card that selects on click; acting is not selecting. */
	it("does not let a click reach the card behind it", async () => {
		const onCardClick = vi.fn();
		const { container } = render(ProjectMenu, {
			props: { folders: [], currentFolderId: null },
		});
		container.addEventListener("click", onCardClick);
		await userEvent.click(items()[0]);
		expect(onCardClick).not.toHaveBeenCalled();
	});
});

describe("ShortcutReference", () => {
	function mount() {
		const onClose = vi.fn();
		const onGoSettings = vi.fn();
		render(ShortcutReference, {
			props: {},
			events: { close: () => onClose(), goSettings: () => onGoSettings() },
		});
		return { onClose, onGoSettings };
	}

	const groups = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".group"));
	const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".row"));

	it("lists the shortcuts grouped by what they belong to", () => {
		mount();
		expect(groups().length).toBeGreaterThan(1);
		expect(rows().length).toBeGreaterThan(10);
	});

	it("shows the keys of each shortcut beside what it does", () => {
		mount();
		const withKeys = rows().filter(
			(r) =>
				(r.querySelector(".keys")?.querySelectorAll("kbd").length ?? 0) > 0,
		);
		expect(withKeys.length).toBeGreaterThan(5);
		expect(rows()[0].querySelector(".desc")?.textContent).toBeTruthy();
	});

	/** A combination reads as its keys joined, not as one run-on label. */
	it("separates the keys of a combination", () => {
		mount();
		const combo = rows().find(
			(r) => (r.querySelectorAll("kbd").length ?? 0) > 1,
		);
		expect(combo?.querySelector(".plus")).not.toBeNull();
	});

	/**
	 * Two editor keys are handled by CodeMirror rather than by a binding, so
	 * they are listed even though no ShortcutDef declares them.
	 */
	it("lists the editor keys that have no binding of their own", () => {
		mount();
		const labels = rows().map((r) => r.textContent ?? "");
		expect(labels.some((l) => l.includes("Tab"))).toBe(true);
		expect(labels.some((l) => l.includes("Enter"))).toBe(true);
	});

	it("closes on request", async () => {
		const { onClose } = mount();
		await userEvent.click(document.querySelector(".close-btn") as HTMLElement);
		expect(onClose).toHaveBeenCalled();
	});

	it("closes on Escape", () => {
		const { onClose } = mount();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onClose).toHaveBeenCalled();
	});

	it("closes on a click on the backdrop", async () => {
		const { onClose } = mount();
		await userEvent.click(document.querySelector(".backdrop") as HTMLElement);
		expect(onClose).toHaveBeenCalled();
	});

	/** Going to the settings closes the reference on the way. */
	it("goes to the settings and closes", async () => {
		const { onClose, onGoSettings } = mount();
		await userEvent.click(
			document.querySelector(".customize-btn") as HTMLElement,
		);
		expect(onGoSettings).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
		void tick;
	});
});
