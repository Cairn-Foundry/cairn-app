import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitProfile } from "$lib/services/settings-service";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { default: GitTab } = await import(
	"$lib/components/home/settings/GitTab.svelte"
);

function profile(id: string, overrides: Partial<GitProfile> = {}): GitProfile {
	return {
		id,
		label: id,
		name: `Name ${id}`,
		email: `${id}@example.com`,
		...overrides,
	};
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".profile-row"));
const labels = () =>
	rows().map((r) => r.querySelector(".profile-avatar")?.textContent);
const addButton = () =>
	document.querySelector(".add-profile-btn") as HTMLElement;
const modalInputs = () =>
	Array.from(
		document.querySelectorAll<HTMLInputElement>(".profile-modal-input"),
	);
const labelField = () => modalInputs()[0];
const nameField = () => modalInputs()[1];
const emailField = () => modalInputs()[2];
const modal = () => document.querySelector(".profile-modal-input");
const saveButton = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".btn")).find((b) =>
		b.classList.contains("primary"),
	) as HTMLButtonElement;
const dangerButtons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".btn.danger"));
const stored = () => {
	let value: GitProfile[] = [];
	settings.subscribe((s) => {
		value = s.gitProfiles;
	})();
	return value;
};

async function fill(label: string, name: string, email: string) {
	if (label) await userEvent.type(labelField(), label);
	await userEvent.clear(nameField());
	await userEvent.type(nameField(), name);
	await userEvent.clear(emailField());
	await userEvent.type(emailField(), email);
}

beforeEach(async () => {
	await settings.save({ gitProfiles: [] });
});

describe("GitTab profiles", () => {
	describe("the list", () => {
		it("says so when there is no profile yet", async () => {
			render(GitTab, {});
			expect(rows()).toHaveLength(0);
			expect(document.querySelector(".profile-empty")).not.toBeNull();
		});

		it("lists the profiles that exist", async () => {
			await settings.save({
				gitProfiles: [profile("work"), profile("perso")],
			});
			render(GitTab, {});
			expect(rows()).toHaveLength(2);
			expect(document.querySelector(".profile-empty")).toBeNull();
		});

		/** The avatar stands in for the profile, so it carries its initial. */
		it("shows the initial of each profile", async () => {
			await settings.save({ gitProfiles: [profile("work")] });
			render(GitTab, {});
			expect(labels()[0]?.toLowerCase()).toBe("w");
		});
	});

	describe("creating a profile", () => {
		it("opens an empty form", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			expect(modal()).not.toBeNull();
			expect(modalInputs().map((i) => i.value)).toEqual(["", "", ""]);
		});

		it("stores the profile that was filled in", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("Work", "Alice", "alice@example.com");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()).toHaveLength(1);
			expect(stored()[0]).toMatchObject({
				label: "Work",
				name: "Alice",
				email: "alice@example.com",
			});
		});

		/** A profile without a label is named by its author, not left blank. */
		it("falls back to the author name when no label is given", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("", "Alice", "alice@example.com");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()[0].label).toBe("Alice");
		});

		it("trims what it stores", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("  Work  ", "  Alice  ", "  alice@example.com  ");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()[0]).toMatchObject({
				label: "Work",
				name: "Alice",
				email: "alice@example.com",
			});
		});

		/** A profile needs both an author and an address to be usable. */
		it("refuses a profile missing the name or the address", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			expect(saveButton().disabled).toBe(true);
			await userEvent.type(nameField(), "Alice");
			expect(saveButton().disabled).toBe(true);
			await userEvent.type(emailField(), "alice@example.com");
			expect(saveButton().disabled).toBe(false);
		});

		it("still stores nothing when the button is forced", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			await tick();
			expect(stored()).toHaveLength(0);
		});

		it("keeps the profiles that already existed", async () => {
			await settings.save({ gitProfiles: [profile("old")] });
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("New", "Bob", "bob@example.com");
			await userEvent.click(saveButton());
			await tick();
			expect(stored().map((p) => p.label)).toEqual(["old", "New"]);
		});

		it("closes without storing anything on cancel", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("Work", "Alice", "alice@example.com");
			const cancel = Array.from(
				document.querySelectorAll<HTMLElement>(".btn.ghost"),
			).pop() as HTMLElement;
			await userEvent.click(cancel);
			await tick();
			expect(stored()).toHaveLength(0);
			expect(modal()).toBeNull();
		});
	});

	describe("editing a profile", () => {
		beforeEach(async () => {
			await settings.save({
				gitProfiles: [
					profile("work", { name: "Alice", email: "alice@example.com" }),
					profile("perso"),
				],
			});
		});

		const editButton = (row: HTMLElement) =>
			row.querySelector(".btn.ghost") as HTMLElement;

		it("opens prefilled with what the profile already is", async () => {
			render(GitTab, {});
			await userEvent.click(editButton(rows()[0]));
			await tick();
			expect(modalInputs().map((i) => i.value)).toEqual([
				"work",
				"Alice",
				"alice@example.com",
			]);
		});

		/** Editing replaces that profile in place, it does not add another. */
		it("updates the profile rather than adding one", async () => {
			render(GitTab, {});
			await userEvent.click(editButton(rows()[0]));
			await tick();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "Alice B");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()).toHaveLength(2);
			expect(stored()[0].name).toBe("Alice B");
		});

		it("keeps the id of the profile being edited", async () => {
			render(GitTab, {});
			await userEvent.click(editButton(rows()[0]));
			await tick();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "Alice B");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()[0].id).toBe("work");
		});

		/**
		 * Asserted on the untouched profile's own fields, not just its id: an
		 * edit applied to every entry would keep the ids and still be wrong.
		 */
		it("leaves the other profiles alone", async () => {
			render(GitTab, {});
			const before = { ...stored()[1] };
			await userEvent.click(editButton(rows()[0]));
			await tick();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "Alice B");
			await userEvent.click(saveButton());
			await tick();
			expect(stored()[1]).toEqual(before);
		});
	});

	/**
	 * `confirmDelete` guards against a missing target, but the confirmation only
	 * exists while one is set, so that branch has no reachable path here.
	 */
	describe("deleting a profile", () => {
		beforeEach(async () => {
			await settings.save({
				gitProfiles: [profile("work"), profile("perso")],
			});
		});

		/** Deleting is irreversible, so it asks first. */
		it("asks before deleting", async () => {
			render(GitTab, {});
			await userEvent.click(dangerButtons()[0]);
			await tick();
			expect(stored()).toHaveLength(2);
		});

		it("deletes the profile that was confirmed", async () => {
			render(GitTab, {});
			await userEvent.click(dangerButtons()[0]);
			await tick();
			const confirm = dangerButtons().pop() as HTMLElement;
			await userEvent.click(confirm);
			await tick();
			expect(stored().map((p) => p.id)).toEqual(["perso"]);
		});

		it("deletes nothing when the confirmation is refused", async () => {
			render(GitTab, {});
			await userEvent.click(dangerButtons()[0]);
			await tick();
			const cancel = Array.from(
				document.querySelectorAll<HTMLElement>(".btn.ghost"),
			).pop() as HTMLElement;
			await userEvent.click(cancel);
			await tick();
			expect(stored()).toHaveLength(2);
		});
	});

	describe("the keyboard", () => {
		it("closes the form on Escape without storing", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("Work", "Alice", "alice@example.com");
			await userEvent.keyboard("{Escape}");
			await tick();
			expect(modal()).toBeNull();
			expect(stored()).toHaveLength(0);
		});

		it("saves on the platform shortcut", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("Work", "Alice", "alice@example.com");
			await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
			await tick();
			expect(stored()).toHaveLength(1);
		});

		/**
		 * A plain Enter is a newline in the form, not a save: only the platform
		 * shortcut commits it.
		 */
		it("does not save on a plain Enter", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await fill("Work", "Alice", "alice@example.com");
			await userEvent.keyboard("{Enter}");
			await tick();
			expect(stored()).toHaveLength(0);
			expect(modal()).not.toBeNull();
		});

		/** The shortcut is refused for the same reason the button is. */
		it("saves nothing on the shortcut with an empty form", async () => {
			render(GitTab, {});
			await userEvent.click(addButton());
			await tick();
			await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
			await tick();
			expect(stored()).toHaveLength(0);
		});
	});
});
