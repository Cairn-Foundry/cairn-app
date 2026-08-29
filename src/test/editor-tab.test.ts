import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntaxTheme } from "$lib/utils/editor/syntax-tokens";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readFile: (...a: unknown[]) => readFile(...a),
	writeFile: (...a: unknown[]) => writeFile(...a),
}));

const saveDialog = vi.fn();
const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...a: unknown[]) => saveDialog(...a),
	open: (...a: unknown[]) => openDialog(...a),
}));

const { settings } = await import("$lib/stores/settings");
const { serializeSyntaxTheme } = await import("$lib/utils/home/syntax-theme");
const { default: EditorTab } = await import(
	"$lib/components/home/settings/EditorTab.svelte"
);

function theme(id: string, name = id): SyntaxTheme {
	return { id, name, tokens: {} } as unknown as SyntaxTheme;
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".syntax-card"));
const cardNamed = (name: string) =>
	cards().find(
		(c) => c.querySelector(".syntax-card-name")?.textContent === name,
	) as HTMLElement;
const wrapFor = (name: string) =>
	cardNamed(name).closest(".syntax-card-wrap") as HTMLElement;
const actionIn = (wrap: HTMLElement, index: number) =>
	Array.from(wrap.querySelectorAll<HTMLElement>(".syntax-action"))[index];
const errorText = () => document.querySelector(".syntax-error")?.textContent;
const ghostNamed = (pattern: RegExp) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(".syntax-buttons .btn"),
	).find((b) => pattern.test((b.textContent ?? "").trim())) as HTMLElement;
const stored = () => {
	let value = { syntaxThemes: [] as SyntaxTheme[], activeSyntaxThemeId: "" };
	settings.subscribe((s) => {
		value = {
			syntaxThemes: s.syntaxThemes,
			activeSyntaxThemeId: s.activeSyntaxThemeId,
		};
	})();
	return value;
};

/** The four actions of a theme card, in the order they are laid out. */
const EDIT = 0;
const DUPLICATE = 1;
const EXPORT = 2;
const DELETE = 3;

async function settle() {
	await tick();
	await tick();
	await tick();
}

beforeEach(async () => {
	readFile.mockReset();
	writeFile.mockReset().mockResolvedValue(undefined);
	saveDialog.mockReset().mockResolvedValue("/tmp/theme.json");
	openDialog.mockReset().mockResolvedValue("/tmp/theme.json");
	await settings.save({
		theme: "default",
		syntaxThemes: [],
		activeSyntaxThemeId: "",
	});
});

describe("EditorTab syntax themes", () => {
	describe("the library", () => {
		/** The built-in theme is always there, alongside the custom ones. */
		it("always offers the built-in theme", () => {
			render(EditorTab, {});
			expect(cards().length).toBeGreaterThanOrEqual(1);
		});

		it("lists the custom themes beside it", async () => {
			await settings.save({ syntaxThemes: [theme("a"), theme("b")] });
			render(EditorTab, {});
			expect(cardNamed("a")).toBeTruthy();
			expect(cardNamed("b")).toBeTruthy();
		});

		it("marks the theme in use, and only that one", async () => {
			await settings.save({
				syntaxThemes: [theme("a"), theme("b")],
				activeSyntaxThemeId: "b",
			});
			render(EditorTab, {});
			const active = cards().filter((c) => c.classList.contains("active"));
			expect(active).toHaveLength(1);
			expect(active[0].querySelector(".syntax-card-name")?.textContent).toBe(
				"b",
			);
		});

		it("marks the built-in one when no custom theme is chosen", async () => {
			await settings.save({
				syntaxThemes: [theme("a")],
				activeSyntaxThemeId: "",
			});
			render(EditorTab, {});
			expect(cards()[0].classList.contains("active")).toBe(true);
		});

		it("switches to the theme that was picked", async () => {
			await settings.save({ syntaxThemes: [theme("a"), theme("b")] });
			render(EditorTab, {});
			await userEvent.click(cardNamed("b"));
			await tick();
			expect(stored().activeSyntaxThemeId).toBe("b");
		});
	});

	describe("duplicating and deleting", () => {
		beforeEach(async () => {
			await settings.save({
				syntaxThemes: [theme("a"), theme("b")],
				activeSyntaxThemeId: "a",
			});
		});

		/** A copy is added and taken into use, so the effect is immediate. */
		it("adds the copy and switches to it", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("a"), DUPLICATE));
			await tick();
			expect(stored().syntaxThemes).toHaveLength(3);
			expect(stored().activeSyntaxThemeId).not.toBe("a");
		});

		it("deletes the theme it was asked to", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("b"), DELETE));
			await tick();
			expect(stored().syntaxThemes.map((x) => x.id)).toEqual(["a"]);
		});

		/**
		 * Deleting the theme in use leaves the editor with nothing selected
		 * rather than pointing at a theme that no longer exists.
		 */
		it("clears the selection when the theme in use is deleted", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("a"), DELETE));
			await tick();
			expect(stored().activeSyntaxThemeId).toBe("");
		});

		it("leaves the selection alone when another theme is deleted", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("b"), DELETE));
			await tick();
			expect(stored().activeSyntaxThemeId).toBe("a");
		});
	});

	describe("exporting", () => {
		beforeEach(async () => {
			await settings.save({ syntaxThemes: [theme("a", "My Theme")] });
		});

		it("writes the theme to the file that was chosen", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("My Theme"), EXPORT));
			await settle();
			expect(writeFile).toHaveBeenCalledWith(
				"/tmp/theme.json",
				serializeSyntaxTheme(theme("a", "My Theme")),
			);
		});

		/** The suggested filename is the theme's name, made safe for a path. */
		it("suggests a filename made from the theme name", async () => {
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("My Theme"), EXPORT));
			await settle();
			const suggested = (saveDialog.mock.calls[0][0] as { defaultPath: string })
				.defaultPath;
			expect(suggested).not.toContain(" ");
			expect(suggested).toMatch(/\.json$/);
		});

		it("writes nothing when no file is chosen", async () => {
			saveDialog.mockResolvedValue(null);
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("My Theme"), EXPORT));
			await settle();
			expect(writeFile).not.toHaveBeenCalled();
		});
	});

	describe("importing", () => {
		it("adds the imported theme and switches to it", async () => {
			readFile.mockResolvedValue(
				JSON.stringify({ name: "Imported", tokens: {} }),
			);
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/import/i));
			await settle();
			expect(stored().syntaxThemes).toHaveLength(1);
			expect(stored().activeSyntaxThemeId).toBe(stored().syntaxThemes[0].id);
		});

		it("reads nothing when no file is chosen", async () => {
			openDialog.mockResolvedValue(null);
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/import/i));
			await settle();
			expect(readFile).not.toHaveBeenCalled();
		});

		/** A file that is not a theme is reported inline rather than swallowed. */
		it("reports a file it cannot read as a theme", async () => {
			readFile.mockResolvedValue("not a theme at all");
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/import/i));
			await settle();
			expect(errorText()).toBeTruthy();
			expect(stored().syntaxThemes).toHaveLength(0);
		});

		it("clears the previous failure on the next try", async () => {
			readFile.mockResolvedValue("bad");
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/import/i));
			await settle();
			expect(errorText()).toBeTruthy();

			readFile.mockResolvedValue(JSON.stringify({ name: "Good", tokens: {} }));
			await userEvent.click(ghostNamed(/import/i));
			await settle();
			expect(errorText()).toBeUndefined();
		});
	});

	describe("creating and editing", () => {
		it("opens an editor for a new theme", async () => {
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/new|nouveau/i));
			await tick();
			expect(document.querySelector(".token-row")).not.toBeNull();
		});

		/** A new theme is not stored until it is saved. */
		it("stores nothing until the new theme is saved", async () => {
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/new|nouveau/i));
			await tick();
			expect(stored().syntaxThemes).toHaveLength(0);
		});

		it("opens the editor on an existing theme", async () => {
			await settings.save({ syntaxThemes: [theme("a", "Mine")] });
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("Mine"), EDIT));
			await tick();
			expect(document.querySelector(".token-row")).not.toBeNull();
		});

		it("adds a brand new theme on save, and takes it into use", async () => {
			render(EditorTab, {});
			await userEvent.click(ghostNamed(/new|nouveau/i));
			await tick();
			const save = document.querySelector(
				".modal-foot .btn.primary",
			) as HTMLElement;
			await userEvent.click(save);
			await tick();
			expect(stored().syntaxThemes).toHaveLength(1);
			expect(stored().activeSyntaxThemeId).toBe(stored().syntaxThemes[0].id);
		});

		/** Editing an existing theme replaces it rather than adding a second. */
		it("replaces the theme being edited rather than adding one", async () => {
			await settings.save({ syntaxThemes: [theme("a", "Mine")] });
			render(EditorTab, {});
			await userEvent.click(actionIn(wrapFor("Mine"), EDIT));
			await tick();
			const save = document.querySelector(
				".modal-foot .btn.primary",
			) as HTMLElement;
			await userEvent.click(save);
			await tick();
			expect(stored().syntaxThemes).toHaveLength(1);
			expect(stored().syntaxThemes[0].id).toBe("a");
		});
	});
});
