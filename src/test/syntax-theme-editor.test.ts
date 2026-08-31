// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntaxTheme } from "$lib/utils/editor/syntax-tokens";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { SYNTAX_TOKEN_KEYS, defaultSyntaxTokens } = await import(
	"$lib/utils/editor/syntax-tokens"
);
const { default: SyntaxThemeEditor } = await import(
	"$lib/components/home/settings/SyntaxThemeEditor.svelte"
);

/**
 * `tokens` is a full map on the type but a partial override in practice: the
 * editor merges whatever it holds over the defaults of the app theme.
 */
function theme(
	overrides: Partial<Omit<SyntaxTheme, "tokens">> & {
		tokens?: Record<string, unknown>;
	} = {},
): SyntaxTheme {
	return {
		id: "custom",
		name: "My theme",
		tokens: {},
		...overrides,
	} as unknown as SyntaxTheme;
}

function mount(props: Record<string, unknown> = {}) {
	const onSave = vi.fn();
	const onClose = vi.fn();
	render(SyntaxThemeEditor, {
		props: { theme: theme(), ...props },
		events: {
			save: (e: CustomEvent) => onSave(e.detail),
			close: () => onClose(),
		},
	});
	return { onSave, onClose };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".token-row"));
const rowFor = (key: string) => rows()[SYNTAX_TOKEN_KEYS.indexOf(key as never)];
const colorIn = (row: HTMLElement) =>
	row.querySelector('input[type="color"]') as HTMLInputElement;
const togglesIn = (row: HTMLElement) =>
	Array.from(row.querySelectorAll<HTMLElement>(".style-toggle"));
const labelIn = (row: HTMLElement) =>
	row.querySelector(".token-label") as HTMLElement;
const nameField = () =>
	document.querySelector(
		".modal input:not([type='color'])",
	) as HTMLInputElement;
const saveButton = () =>
	document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
/** Both ghost buttons live in the footer, so they are told apart by name. */
const ghostNamed = (pattern: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>(".btn.ghost")).find((b) =>
		pattern.test((b.textContent ?? "").trim()),
	) as HTMLElement;
const resetAllButton = () => ghostNamed(/reset|réinitialiser/i);
const cancelButton = () => ghostNamed(/cancel|annuler/i);
const previewSegments = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".preview-host span"));

/** The four style toggles of a row, in the order they are laid out. */
const BOLD = 0;
const ITALIC = 1;
const UNDERLINE = 2;
const RESET = 3;

beforeEach(async () => {
	await settings.save({ theme: "default" });
});

describe("SyntaxThemeEditor", () => {
	describe("the token list", () => {
		it("shows a row per token the editor colours", () => {
			mount();
			expect(rows()).toHaveLength(SYNTAX_TOKEN_KEYS.length);
		});

		/**
		 * A theme that sets nothing starts from the defaults of the app theme.
		 * The swatch carries a hex conversion, since a colour input takes no
		 * other form, so the declared colour is read off the label instead.
		 */
		it("starts from the defaults for a theme with no tokens", () => {
			mount({ theme: theme({ tokens: {} }) });
			const defaults = defaultSyntaxTokens("default");
			const first = SYNTAX_TOKEN_KEYS[0];
			expect(labelIn(rowFor(first)).getAttribute("style")).toContain(
				defaults[first].color,
			);
			expect(colorIn(rowFor(first)).value).toMatch(/^#[0-9a-f]{6}$/i);
		});

		it("keeps what the theme already sets", () => {
			const first = SYNTAX_TOKEN_KEYS[0];
			mount({
				theme: theme({ tokens: { [first]: { color: "#ff0000", bold: true } } }),
			});
			expect(colorIn(rowFor(first)).value).toBe("#ff0000");
			expect(togglesIn(rowFor(first))[BOLD].classList.contains("on")).toBe(
				true,
			);
		});

		/** Each label is drawn in its own token's style, so the effect is visible. */
		it("draws each label in the style of its own token", () => {
			const first = SYNTAX_TOKEN_KEYS[0];
			mount({
				theme: theme({
					tokens: { [first]: { color: "#ff0000", italic: true } },
				}),
			});
			expect(labelIn(rowFor(first)).getAttribute("style")).toContain("italic");
		});
	});

	describe("changing a token", () => {
		const first = () => SYNTAX_TOKEN_KEYS[0];

		it("takes a new colour", async () => {
			const { onSave } = mount();
			const input = colorIn(rowFor(first()));
			input.value = "#123456";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].tokens[first()].color).toBe("#123456");
		});

		/**
		 * Each toggle flips its own style. Read against what the token starts
		 * as rather than assuming all three are off: `kw` ships italic, so a
		 * click there turns italic off, not on.
		 */
		it("flips bold, italic and underline independently", async () => {
			const before = defaultSyntaxTokens("default")[first()];
			const { onSave } = mount();
			for (const index of [BOLD, ITALIC, UNDERLINE]) {
				await userEvent.click(togglesIn(rowFor(first()))[index]);
				await tick();
			}
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].tokens[first()]).toMatchObject({
				bold: !before.bold,
				italic: !before.italic,
				underline: !before.underline,
			});
		});

		it("flips a style back on a second click", async () => {
			const before = defaultSyntaxTokens("default")[first()];
			const { onSave } = mount();
			await userEvent.click(togglesIn(rowFor(first()))[BOLD]);
			await tick();
			await userEvent.click(togglesIn(rowFor(first()))[BOLD]);
			await tick();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].tokens[first()].bold).toBe(
				Boolean(before.bold),
			);
		});

		it("marks a style that is on", async () => {
			mount();
			const bold = () => togglesIn(rowFor(first()))[BOLD];
			expect(bold().classList.contains("on")).toBe(false);
			await userEvent.click(bold());
			await tick();
			expect(bold().classList.contains("on")).toBe(true);
		});

		/** Changing one token leaves the others alone. */
		it("changes only the token it was asked to", async () => {
			const { onSave } = mount();
			await userEvent.click(togglesIn(rowFor(first()))[BOLD]);
			await tick();
			await userEvent.click(saveButton());
			const saved = onSave.mock.calls[0][0].tokens;
			expect(saved[SYNTAX_TOKEN_KEYS[1]].bold).toBeFalsy();
		});

		it("puts one token back to its default", async () => {
			const { onSave } = mount({
				theme: theme({
					tokens: { [SYNTAX_TOKEN_KEYS[0]]: { color: "#ff0000", bold: true } },
				}),
			});
			await userEvent.click(togglesIn(rowFor(first()))[RESET]);
			await tick();
			await userEvent.click(saveButton());
			const defaults = defaultSyntaxTokens("default");
			expect(onSave.mock.calls[0][0].tokens[first()]).toEqual(
				defaults[first()],
			);
		});

		it("puts every token back at once", async () => {
			const { onSave } = mount({
				theme: theme({
					tokens: {
						[SYNTAX_TOKEN_KEYS[0]]: { color: "#ff0000" },
						[SYNTAX_TOKEN_KEYS[1]]: { color: "#00ff00" },
					},
				}),
			});
			await userEvent.click(resetAllButton());
			await tick();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].tokens).toEqual(
				defaultSyntaxTokens("default"),
			);
		});
	});

	describe("the preview", () => {
		it("shows the sample lines", () => {
			mount();
			expect(previewSegments().length).toBeGreaterThan(3);
		});

		/** The preview follows the tokens as they are edited. */
		it("follows a token being changed", async () => {
			mount();
			const styledBefore = previewSegments().map((s) =>
				s.getAttribute("style"),
			);
			await userEvent.click(togglesIn(rowFor(SYNTAX_TOKEN_KEYS[0]))[BOLD]);
			await tick();
			expect(previewSegments().map((s) => s.getAttribute("style"))).not.toEqual(
				styledBefore,
			);
		});
	});

	describe("saving", () => {
		it("saves the theme under its name, trimmed", async () => {
			const { onSave } = mount({ theme: theme({ name: "old" }) });
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "  new name  ");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].name).toBe("new name");
		});

		it("keeps the id of the theme being edited", async () => {
			const { onSave } = mount({ theme: theme({ id: "keep-me" }) });
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].id).toBe("keep-me");
		});

		it("refuses a theme with no name", async () => {
			mount();
			await userEvent.clear(nameField());
			expect(saveButton().disabled).toBe(true);
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("still saves nothing when the button is forced", async () => {
			const { onSave } = mount();
			await userEvent.clear(nameField());
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			expect(onSave).not.toHaveBeenCalled();
		});

		it("closes without saving", async () => {
			const { onSave, onClose } = mount();
			await userEvent.click(cancelButton());
			expect(onClose).toHaveBeenCalled();
			expect(onSave).not.toHaveBeenCalled();
		});
	});
});
