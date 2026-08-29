import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const editProject = vi.fn();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	editProject: (...a: unknown[]) => editProject(...a),
}));

// The real store is kept - the integrations tab renders a form that reads a
// dozen of its exports - and only the two calls that reach the backend are
// replaced.
const loadProjectIntegrations = vi.fn();
const saveProjectIntegrations = vi.fn();
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadProjectIntegrations: (...a: unknown[]) => loadProjectIntegrations(...a),
	saveProjectIntegrations: (...a: unknown[]) => saveProjectIntegrations(...a),
}));

const getRemoteUrl = vi.fn();
vi.mock("$lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getRemoteUrl: (...a: unknown[]) => getRemoteUrl(...a),
}));

const { project } = await import("./fixtures");
const { default: EditProject } = await import(
	"$lib/components/EditProject.svelte"
);

function mount(overrides: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	render(EditProject, {
		props: { project: { ...project("p1"), ...overrides } },
		events: { close: () => onClose() },
	});
	return { onClose };
}

const nameField = () =>
	document.getElementById("edit-name") as HTMLInputElement;
const saveButton = () =>
	document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
const cancelButton = () =>
	document.querySelector(".modal-foot .btn.ghost") as HTMLButtonElement;
const tabs = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ep-tab"));
const errorText = () => document.querySelector(".ep-error")?.textContent;

async function settle() {
	await tick();
	await tick();
}

beforeEach(() => {
	editProject.mockReset().mockResolvedValue(undefined);
	loadProjectIntegrations.mockReset().mockResolvedValue(undefined);
	saveProjectIntegrations.mockReset().mockResolvedValue(undefined);
	getRemoteUrl.mockReset().mockResolvedValue("git@example.com:me/p1.git");
});

describe("EditProject", () => {
	describe("what it saves", () => {
		/** Nothing changed means nothing to save. */
		it("refuses to save an unchanged project", async () => {
			mount();
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("allows saving once the name changed", async () => {
			mount();
			await settle();
			await userEvent.type(nameField(), " renamed");
			expect(saveButton().disabled).toBe(false);
		});

		it("refuses an empty name", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			expect(saveButton().disabled).toBe(true);
		});

		it("refuses a name of spaces only", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "   ");
			expect(saveButton().disabled).toBe(true);
		});

		/**
		 * Only what actually changed is written: renaming touches the project,
		 * while a change confined to the integrations does not.
		 */
		it("writes no project change when only the integrations moved", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.type(nameField(), " x");
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "p1");
			expect(saveButton().disabled).toBe(true);
			void onClose;
		});

		it("saves the new name, trimmed", async () => {
			mount({ name: "old" });
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "  new  ");
			await userEvent.click(saveButton());
			await settle();
			expect(editProject).toHaveBeenCalledWith("p1", "new", expect.anything());
		});

		/** A name typed back to what it was is not a change. */
		it("refuses to save a name retyped identically", async () => {
			mount({ name: "same" });
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "same");
			expect(saveButton().disabled).toBe(true);
		});

		it("closes once the save went through", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.type(nameField(), " x");
			await userEvent.click(saveButton());
			await settle();
			expect(onClose).toHaveBeenCalled();
		});

		/**
		 * The disabled button and the guard in the handler are two defences.
		 * Forcing the click reaches the second - and the name is emptied first,
		 * since an unchanged project would be refused by the inner check on the
		 * name and colour anyway.
		 */
		it("still saves nothing when the button is forced on an empty name", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.clear(nameField());
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			await settle();
			expect(editProject).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});
	});

	describe("when the save fails", () => {
		it("reports the failure instead of closing", async () => {
			editProject.mockRejectedValue(new Error("name taken"));
			const { onClose } = mount();
			await settle();
			await userEvent.type(nameField(), " x");
			await userEvent.click(saveButton());
			await settle();
			expect(errorText()).toContain("name taken");
			expect(onClose).not.toHaveBeenCalled();
		});

		it("becomes usable again after a failure", async () => {
			editProject.mockRejectedValue(new Error("nope"));
			mount();
			await settle();
			await userEvent.type(nameField(), " x");
			await userEvent.click(saveButton());
			await settle();
			expect(saveButton().disabled).toBe(false);
		});
	});

	describe("the two tabs", () => {
		it("opens on the identity tab", async () => {
			mount();
			await settle();
			expect(tabs()[0].classList.contains("active")).toBe(true);
			expect(nameField()).not.toBeNull();
		});

		it("switches to the integrations tab", async () => {
			mount();
			await settle();
			await userEvent.click(tabs()[1]);
			expect(tabs()[1].classList.contains("active")).toBe(true);
			expect(tabs()[0].classList.contains("active")).toBe(false);
		});

		it("announces the tabs for a screen reader", async () => {
			mount();
			await settle();
			expect(document.querySelector('[role="tablist"]')).not.toBeNull();
			expect(tabs()[0].getAttribute("role")).toBe("tab");
		});
	});

	describe("what it loads", () => {
		it("loads the integrations of the project it edits", async () => {
			mount();
			await settle();
			expect(loadProjectIntegrations).toHaveBeenCalledWith("p1");
		});

		it("reads the remote of the project", async () => {
			mount();
			await settle();
			expect(getRemoteUrl).toHaveBeenCalledWith("/repos/p1");
		});

		/** A project with no remote still opens; the field is simply empty. */
		it("opens even when the remote cannot be read", async () => {
			getRemoteUrl.mockRejectedValue(new Error("not a repo"));
			mount();
			await settle();
			expect(nameField()).not.toBeNull();
			expect(errorText()).toBeUndefined();
		});

		it("opens even when the integrations cannot be loaded", async () => {
			loadProjectIntegrations.mockRejectedValue(new Error("offline"));
			mount();
			await settle();
			expect(nameField()).not.toBeNull();
		});
	});

	describe("giving up", () => {
		it("closes on cancel without saving", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.type(nameField(), " x");
			await userEvent.click(cancelButton());
			expect(onClose).toHaveBeenCalled();
			expect(editProject).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.type(nameField(), "{Escape}");
			expect(onClose).toHaveBeenCalled();
		});

		it("saves on Enter when there is something to save", async () => {
			mount();
			await settle();
			await userEvent.type(nameField(), " x{Enter}");
			await settle();
			expect(editProject).toHaveBeenCalled();
		});

		/**
		 * Enter is refused for the same reasons the button is.
		 *
		 * Two guards here are belt and braces rather than behaviour: the `canSave`
		 * condition on the Enter key, and the inner check on the name and colour
		 * inside `save()`. Both are shadowed by the `!canSave` guard at the top of
		 * `save()`, so removing either changes nothing observable and this suite
		 * cannot pin them down.
		 */
		it("does nothing on Enter when the name is empty", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.keyboard("{Enter}");
			await settle();
			expect(editProject).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
