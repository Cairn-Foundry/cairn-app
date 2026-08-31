// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CustomLanguageServer } from "$lib/services/settings-service";

const setLocale = vi.fn();
vi.mock("$lib/i18n", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, setLocale: (...a: unknown[]) => setLocale(...a) };
});

const { LOCALE_META } = await import("$lib/i18n");
const { default: CustomServerModal } = await import(
	"$lib/components/home/CustomServerModal.svelte"
);
const { default: LanguagesTab } = await import(
	"$lib/components/home/settings/LanguagesTab.svelte"
);

describe("CustomServerModal", () => {
	function mount(props: Record<string, unknown> = {}) {
		const onSave = vi.fn();
		const onClose = vi.fn();
		render(CustomServerModal, {
			props: { server: null, takenIds: [], ...props },
			events: {
				save: (e: CustomEvent) => onSave(e.detail),
				close: () => onClose(),
			},
		});
		return { onSave, onClose };
	}

	const fields = () =>
		Array.from(document.querySelectorAll<HTMLInputElement>(".cs-input"));
	const field = (index: number) => fields()[index];
	const saveButton = () =>
		document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;

	/** Name, binary, args, extensions, language ids, root markers, doc url. */
	const NAME = 0;
	const BINARY = 1;
	const ARGS = 2;
	const EXTENSIONS = 3;
	const LANGUAGE_IDS = 4;
	const ROOT_MARKERS = 5;

	async function fillMinimum() {
		await userEvent.type(field(NAME), "Elixir");
		await userEvent.type(field(BINARY), "lexical");
		await userEvent.type(field(EXTENSIONS), ".ex");
	}

	describe("what it requires", () => {
		it("refuses a server with nothing filled in", () => {
			mount();
			expect(saveButton().disabled).toBe(true);
		});

		/** A server needs a name, a binary to run, and something to run it on. */
		it("refuses a server missing any of the three essentials", async () => {
			mount();
			await userEvent.type(field(NAME), "Elixir");
			expect(saveButton().disabled).toBe(true);
			await userEvent.type(field(BINARY), "lexical");
			expect(saveButton().disabled).toBe(true);
			await userEvent.type(field(EXTENSIONS), ".ex");
			expect(saveButton().disabled).toBe(false);
		});

		it("refuses a name of spaces only", async () => {
			mount();
			await userEvent.type(field(NAME), "   ");
			await userEvent.type(field(BINARY), "lexical");
			await userEvent.type(field(EXTENSIONS), ".ex");
			expect(saveButton().disabled).toBe(true);
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("still refuses to save when the button is forced", async () => {
			const { onSave } = mount();
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			expect(onSave).not.toHaveBeenCalled();
		});
	});

	describe("what it makes of the input", () => {
		it("saves the fields it was given, trimmed", async () => {
			const { onSave } = mount();
			await userEvent.type(field(NAME), "  Elixir  ");
			await userEvent.type(field(BINARY), "  lexical  ");
			await userEvent.type(field(EXTENSIONS), ".ex");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0]).toMatchObject({
				name: "Elixir",
				binary: "lexical",
			});
		});

		/** Both separators, because both are what people type. */
		it("splits a list on spaces or on commas", async () => {
			const { onSave } = mount();
			await fillMinimum();
			await userEvent.type(field(ARGS), "--stdio, --verbose  -q");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].args).toEqual([
				"--stdio",
				"--verbose",
				"-q",
			]);
		});

		it("keeps an empty list empty rather than holding a blank entry", async () => {
			const { onSave } = mount();
			await fillMinimum();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].args).toEqual([]);
			expect(onSave.mock.calls[0][0].rootMarkers).toEqual([]);
		});

		/** An extension is stored with its dot, whether or not it was typed with one. */
		it("adds the leading dot to an extension typed without one", async () => {
			const { onSave } = mount();
			await userEvent.type(field(NAME), "Elixir");
			await userEvent.type(field(BINARY), "lexical");
			await userEvent.type(field(EXTENSIONS), "ex exs");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].extensions).toEqual([".ex", ".exs"]);
		});

		it("does not double the dot of one typed with it", async () => {
			const { onSave } = mount();
			await userEvent.type(field(NAME), "Elixir");
			await userEvent.type(field(BINARY), "lexical");
			await userEvent.type(field(EXTENSIONS), ".ex");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].extensions).toEqual([".ex"]);
		});

		it("lowercases the extensions", async () => {
			const { onSave } = mount();
			await userEvent.type(field(NAME), "Elixir");
			await userEvent.type(field(BINARY), "lexical");
			await userEvent.type(field(EXTENSIONS), ".EX .Exs");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].extensions).toEqual([".ex", ".exs"]);
		});

		it("saves the language ids and root markers as lists", async () => {
			const { onSave } = mount();
			await fillMinimum();
			await userEvent.type(field(LANGUAGE_IDS), "elixir");
			await userEvent.type(field(ROOT_MARKERS), "mix.exs .formatter.exs");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].languageIds).toEqual(["elixir"]);
			expect(onSave.mock.calls[0][0].rootMarkers).toEqual([
				"mix.exs",
				".formatter.exs",
			]);
		});
	});

	describe("editing an existing server", () => {
		const existing: CustomLanguageServer = {
			id: "elixir-lexical",
			name: "Elixir",
			binary: "lexical",
			args: ["--stdio"],
			languageIds: ["elixir"],
			extensions: [".ex", ".exs"],
			rootMarkers: ["mix.exs"],
			docUrl: "https://example.com",
		} as CustomLanguageServer;

		it("opens prefilled with what the server already is", () => {
			mount({ server: existing });
			expect(field(NAME).value).toBe("Elixir");
			expect(field(EXTENSIONS).value).toBe(".ex .exs");
			expect(field(ARGS).value).toBe("--stdio");
		});

		/** Editing keeps the id: a new one would leave the old server behind. */
		it("keeps the id of the server being edited", async () => {
			const { onSave } = mount({ server: existing });
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].id).toBe("elixir-lexical");
		});

		it("mints an id for a server being created", async () => {
			const { onSave } = mount({ server: null, takenIds: [] });
			await fillMinimum();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].id).toBeTruthy();
		});

		/** Two servers with the same name must not end up with the same id. */
		it("mints an id that is not already taken", async () => {
			const { onSave } = mount({ server: null, takenIds: ["elixir"] });
			await fillMinimum();
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].id).not.toBe("elixir");
		});
	});

	it("closes without saving", async () => {
		const { onSave, onClose } = mount();
		await userEvent.click(
			document.querySelector(".modal-foot .btn.ghost") as HTMLElement,
		);
		expect(onClose).toHaveBeenCalled();
		expect(onSave).not.toHaveBeenCalled();
	});
});

describe("LanguagesTab", () => {
	const rows = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".lang-row"));
	const names = () =>
		rows().map((r) => r.querySelector(".lang-native")?.textContent);
	const search = () =>
		document.querySelector(".lang-search-input") as HTMLInputElement;

	it("lists every language the app is translated into", () => {
		render(LanguagesTab, {});
		expect(rows()).toHaveLength(Object.keys(LOCALE_META).length);
	});

	it("shows each language in its own name", () => {
		render(LanguagesTab, {});
		expect(names()).toContain("Français");
	});

	/** Searchable in both directions: someone may know only the English name. */
	it("matches on the native name", async () => {
		render(LanguagesTab, {});
		await userEvent.type(search(), "Français");
		expect(names()).toEqual(["Français"]);
	});

	it("matches on the English name", async () => {
		render(LanguagesTab, {});
		await userEvent.type(search(), "French");
		expect(names()).toEqual(["Français"]);
	});

	it("matches on the locale code", async () => {
		render(LanguagesTab, {});
		await userEvent.type(search(), "fr");
		expect(names()).toContain("Français");
	});

	it("ignores case", async () => {
		render(LanguagesTab, {});
		await userEvent.type(search(), "FRENCH");
		expect(names()).toEqual(["Français"]);
	});

	it("lists everything again once the search is cleared", async () => {
		render(LanguagesTab, {});
		await userEvent.type(search(), "French");
		await userEvent.click(
			document.querySelector(".search-clear") as HTMLElement,
		);
		expect(rows()).toHaveLength(Object.keys(LOCALE_META).length);
	});

	it("switches to the language that was picked", async () => {
		setLocale.mockClear();
		render(LanguagesTab, {});
		const french = rows().find(
			(r) => r.querySelector(".lang-native")?.textContent === "Français",
		) as HTMLElement;
		await userEvent.click(french);
		expect(setLocale).toHaveBeenCalledWith("fr");
	});

	it("shows the code of each language", () => {
		render(LanguagesTab, {});
		expect(rows()[0].querySelector(".lang-code")?.textContent).toBeTruthy();
	});
});
