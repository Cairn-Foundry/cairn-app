import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "$lib/types/instance";

const instancesStore = writable<Instance[]>([]);
const instancesWithBaseStore = writable<Instance[]>([]);
const removeInstance = vi.fn(async (..._a: unknown[]) => {});
const duplicateInstance = vi.fn(async (..._a: unknown[]) => {});
const setInstanceStatus = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	instances: { subscribe: instancesStore.subscribe },
	instancesWithBase: { subscribe: instancesWithBaseStore.subscribe },
	removeInstance: (...a: unknown[]) => removeInstance(...a),
	duplicateInstance: (...a: unknown[]) => duplicateInstance(...a),
	setInstanceStatus: (...a: unknown[]) => setInstanceStatus(...a),
}));

const activateInstance = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activateInstance: (...a: unknown[]) => activateInstance(...a),
}));

const revealInFileManager = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/services/project-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	revealInFileManager: (...a: unknown[]) => revealInFileManager(...a),
}));

const { BASE_INSTANCE_ID } = await import("$lib/stores/instance");
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project, instance } = await import("./fixtures");
const { default: ManageInstances } = await import(
	"$lib/components/ManageInstances.svelte"
);

const base = () =>
	instance(BASE_INSTANCE_ID, "p1", { ticket: { id: "base", title: "Base" } });

function setInstances(list: Instance[]) {
	instancesStore.set(list);
	instancesWithBaseStore.set([base(), ...list]);
}

function mount(props: Record<string, unknown> = {}) {
	const onClose = vi.fn((..._a: unknown[]) => undefined);
	const onNewInstance = vi.fn((..._a: unknown[]) => undefined);
	render(ManageInstances, {
		props: { activeInstanceId: null, ...props },
		events: {
			close: () => onClose(),
			newInstance: () => onNewInstance(),
		},
	});
	return { onClose, onNewInstance };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mi-row"));
const titles = () =>
	rows().map((r) => r.querySelector(".mi-title")?.textContent?.trim());
const archivedRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mi-row-archived"));
const searchField = () =>
	document.querySelector(".mi-search-input") as HTMLInputElement;
const moreIn = (row: HTMLElement) =>
	row.querySelector(".row-btn.icon-only") as HTMLElement;
const menuItem = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>(".more-item")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLElement;
const menuItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".more-item")).map((b) =>
		b.textContent?.trim(),
	);
const indentOf = (row: HTMLElement) =>
	row.querySelector(".mi-child-indent")?.getAttribute("style") ?? null;

async function settle() {
	await tick();
	await tick();
}

/** Opens the row's overflow menu, which is where most actions live. */
async function openMenu(row: HTMLElement) {
	await userEvent.click(moreIn(row));
	await settle();
}

beforeEach(() => {
	removeInstance.mockClear();
	duplicateInstance.mockClear();
	setInstanceStatus.mockClear();
	activateInstance.mockClear();
	revealInFileManager.mockClear();
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	Object.assign(navigator, {
		clipboard: { writeText: vi.fn(async (..._a: unknown[]) => {}) },
	});
	setInstances([
		instance("i1", "p1", { ticket: { id: "T-1", title: "Login" } }),
		instance("i2", "p1", { ticket: { id: "T-2", title: "Signup" } }),
	]);
});

describe("ManageInstances", () => {
	describe("the list", () => {
		it("lists the base folder and every instance", () => {
			mount();
			expect(titles()).toEqual(["Base", "Login", "Signup"]);
		});

		it("says so when the project has no instance", () => {
			instancesStore.set([]);
			instancesWithBaseStore.set([]);
			mount();
			expect(document.querySelector(".mi-empty")).not.toBeNull();
		});

		/** An archived instance leaves the main list for its own group. */
		it("keeps the archived instances out of the main list", () => {
			setInstances([
				instance("i1", "p1", { ticket: { id: "T-1", title: "Login" } }),
				instance("i2", "p1", {
					ticket: { id: "T-2", title: "Signup" },
					status: "done",
				}),
			]);
			mount();
			expect(titles()).toEqual(["Base", "Login", "Signup"]);
			expect(archivedRows()).toHaveLength(1);
			expect(
				archivedRows()[0].querySelector(".mi-title")?.textContent?.trim(),
			).toBe("Signup");
		});

		it("shows no archived group when nothing is archived", () => {
			mount();
			expect(archivedRows()).toHaveLength(0);
		});

		/** A duplicate nests under the instance it came from. */
		it("nests a duplicate under its parent", () => {
			setInstances([
				instance("i1", "p1", { ticket: { id: "T-1", title: "Login" } }),
				instance("i2", "p1", {
					ticket: { id: "T-2", title: "Login copy" },
					parentInstanceId: "i1",
				}),
			]);
			mount();
			expect(titles()).toEqual(["Base", "Login", "Login copy"]);
			expect(indentOf(rows()[2])).not.toBeNull();
			expect(indentOf(rows()[1])).toBeNull();
		});

		/** A child whose parent is filtered away becomes a root of its own. */
		it("promotes a child whose parent the search hid", async () => {
			setInstances([
				instance("i1", "p1", { ticket: { id: "T-1", title: "Login" } }),
				instance("i2", "p1", {
					ticket: { id: "T-2", title: "Signup copy" },
					parentInstanceId: "i1",
				}),
			]);
			mount();
			await userEvent.type(searchField(), "Signup");
			await settle();
			expect(titles()).toEqual(["Base", "Signup copy"]);
			expect(indentOf(rows()[1])).toBeNull();
		});

		it("keeps the instances whose ticket matched", async () => {
			mount();
			await userEvent.type(searchField(), "T-2");
			await settle();
			expect(titles()).toEqual(["Base", "Signup"]);
		});

		/** The base folder is the project itself and never filters away. */
		it("keeps the base folder whatever the search", async () => {
			mount();
			await userEvent.type(searchField(), "zzzz");
			await settle();
			expect(titles()).toEqual(["Base"]);
		});

		it("filters the archived group too", async () => {
			setInstances([
				instance("i1", "p1", {
					ticket: { id: "T-1", title: "Login" },
					status: "done",
				}),
				instance("i2", "p1", {
					ticket: { id: "T-2", title: "Signup" },
					status: "done",
				}),
			]);
			mount();
			await userEvent.type(searchField(), "Login");
			await settle();
			expect(archivedRows()).toHaveLength(1);
		});

		it("clears the search on request", async () => {
			mount();
			await userEvent.type(searchField(), "Login");
			await settle();
			await userEvent.click(
				document.querySelector(".mi-search-clear") as HTMLElement,
			);
			await settle();
			expect(titles()).toEqual(["Base", "Login", "Signup"]);
		});

		it("offers no clear button with no search", () => {
			mount();
			expect(document.querySelector(".mi-search-clear")).toBeNull();
		});
	});

	describe("choosing an instance", () => {
		it("activates the instance that was clicked and closes", async () => {
			const { onClose } = mount();
			await userEvent.click(rows()[1]);
			await settle();
			expect(activateInstance).toHaveBeenCalledWith("p1", "i1");
			expect(onClose).toHaveBeenCalled();
		});

		/** Clicking the instance already active is a no-op, not a reactivation. */
		it("does not reactivate the instance already active", async () => {
			mount({ activeInstanceId: "i1" });
			await userEvent.click(rows()[1]);
			await settle();
			expect(activateInstance).not.toHaveBeenCalled();
		});
	});

	describe("the row menu", () => {
		it("reveals the worktree in the file manager", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/reveal|finder|afficher/i));
			expect(revealInFileManager).toHaveBeenCalledWith("/worktrees/p1/i1");
		});

		it("copies the worktree path", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/copy|copier/i));
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
				"/worktrees/p1/i1",
			);
		});

		it("closes the menu when the same row is asked again", async () => {
			mount();
			await openMenu(rows()[1]);
			await openMenu(rows()[1]);
			expect(document.querySelector(".more-menu")).toBeNull();
		});

		it("closes the menu on a click outside it", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(
				document.querySelector(".more-overlay") as HTMLElement,
			);
			expect(document.querySelector(".more-menu")).toBeNull();
		});

		/** The base folder is not a worktree: it cannot be duplicated or deleted. */
		it("offers neither duplicate nor delete on the base folder", async () => {
			mount();
			await openMenu(rows()[0]);
			expect(menuItems()).toHaveLength(2);
			expect(menuItem(/duplicate|dupliquer/i)).toBeUndefined();
			expect(menuItem(/delete|supprimer/i)).toBeUndefined();
		});

		it("offers them on a real instance", async () => {
			mount();
			await openMenu(rows()[1]);
			expect(menuItem(/duplicate|dupliquer/i)).not.toBeUndefined();
			expect(menuItem(/delete|supprimer/i)).not.toBeUndefined();
		});

		/** Opening a row's menu must not also activate that row. */
		it("does not activate the row whose menu was opened", async () => {
			mount();
			await openMenu(rows()[1]);
			expect(activateInstance).not.toHaveBeenCalled();
		});
	});

	describe("duplicating", () => {
		it("asks before duplicating", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/duplicate|dupliquer/i));
			await settle();
			expect(duplicateInstance).not.toHaveBeenCalled();
			expect(document.querySelectorAll(".modal-backdrop").length).toBe(2);
		});

		it("duplicates the instance once confirmed", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/duplicate|dupliquer/i));
			await settle();
			const confirm = Array.from(
				document.querySelectorAll<HTMLButtonElement>(".btn.primary"),
			).at(-1) as HTMLButtonElement;
			await userEvent.click(confirm);
			await settle();
			expect(duplicateInstance).toHaveBeenCalledTimes(1);
			expect((duplicateInstance.mock.calls[0][0] as Instance).id).toBe("i1");
		});
	});

	describe("deleting", () => {
		it("asks before deleting", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/delete|supprimer/i));
			await settle();
			expect(removeInstance).not.toHaveBeenCalled();
			expect(document.querySelectorAll(".modal-backdrop").length).toBe(2);
		});

		it("deletes nothing when the question is dismissed", async () => {
			mount();
			await openMenu(rows()[1]);
			await userEvent.click(menuItem(/delete|supprimer/i));
			await settle();
			const cancel = Array.from(
				document.querySelectorAll<HTMLButtonElement>(".btn.ghost"),
			).at(-1) as HTMLButtonElement;
			await userEvent.click(cancel);
			await settle();
			expect(removeInstance).not.toHaveBeenCalled();
			expect(document.querySelector(".mi-row")).not.toBeNull();
		});
	});

	describe("the archived group", () => {
		beforeEach(() => {
			setInstances([
				instance("i1", "p1", {
					ticket: { id: "T-1", title: "Login" },
					status: "done",
				}),
			]);
		});

		it("reopens an archived instance", async () => {
			mount();
			const reopen = archivedRows()[0].querySelector(
				".row-btn:not(.icon-only)",
			) as HTMLElement;
			await userEvent.click(reopen);
			await settle();
			expect(setInstanceStatus).toHaveBeenCalledWith("i1", "p1", "idle");
		});

		it("still offers its menu", async () => {
			mount();
			await openMenu(archivedRows()[0]);
			expect(menuItem(/delete|supprimer/i)).not.toBeUndefined();
		});
	});

	describe("closing", () => {
		it("closes on the close button", async () => {
			const { onClose } = mount();
			await userEvent.click(
				document.querySelector(".icon-btn.close") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click outside", async () => {
			const { onClose } = mount();
			await userEvent.click(
				document.querySelector(".modal-backdrop") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside", async () => {
			const { onClose } = mount();
			await userEvent.click(document.querySelector(".modal") as HTMLElement);
			expect(onClose).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			const { onClose } = mount();
			document
				.querySelector(".modal-backdrop")
				?.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			expect(onClose).toHaveBeenCalled();
		});

		/** Creating a new instance hands over to the create flow and closes. */
		it("asks for a new instance and closes", async () => {
			const { onClose, onNewInstance } = mount();
			await userEvent.click(
				document.querySelector(".modal-foot .btn.primary") as HTMLElement,
			);
			expect(onNewInstance).toHaveBeenCalled();
			expect(onClose).toHaveBeenCalled();
		});
	});
});
