// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import ExportModal from "$lib/components/formatting/ExportModal.svelte";
import ImportModal from "$lib/components/formatting/ImportModal.svelte";
import StyleField from "$lib/components/formatting/StyleField.svelte";
import type {
	FormatterStatus,
	ImportReport,
	StyleOptionInfo,
	StyleSet,
} from "$lib/services/formatting-service";

const body = () => document.querySelector(".modal") as HTMLElement;
const footButtons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".modal-foot .btn"));

describe("StyleField", () => {
	function option(overrides: Partial<StyleOptionInfo> = {}): StyleOptionInfo {
		return {
			id: "indentSize",
			kind: "number",
			choices: [],
			min: 1,
			max: 16,
			default: 2,
			languages: [],
			...overrides,
		};
	}

	function mount(props: Record<string, unknown> = {}) {
		const onChange = vi.fn();
		render(StyleField, {
			props: { option: option(), ...props },
			events: { change: (e: CustomEvent) => onChange(e.detail) },
		});
		return { onChange };
	}

	const numberField = () =>
		document.querySelector('input[type="number"]') as HTMLInputElement;
	const toggle = () =>
		document.querySelector('input[type="checkbox"]') as HTMLInputElement;

	describe("a number option", () => {
		it("shows the value set here", () => {
			mount({ value: 4 });
			expect(numberField().value).toBe("4");
		});

		/** Nothing set here means the value comes from the level above. */
		it("shows the inherited value when nothing is set here", () => {
			mount({ value: undefined, inherited: 8 });
			expect(numberField().value).toBe("8");
		});

		it("prefers the value set here over the inherited one", () => {
			mount({ value: 4, inherited: 8 });
			expect(numberField().value).toBe("4");
		});

		it("shows nothing when neither is set", () => {
			mount({ value: undefined, inherited: undefined });
			expect(numberField().value).toBe("");
		});

		it("reports a number, not the string that was typed", async () => {
			const { onChange } = mount({ value: 2 });
			await userEvent.clear(numberField());
			await userEvent.type(numberField(), "4");
			numberField().dispatchEvent(new Event("change", { bubbles: true }));
			expect(onChange).toHaveBeenLastCalledWith(4);
		});

		/**
		 * Emptying the field clears the override rather than setting it to zero.
		 * The cleared value arrives as null: a CustomEvent detail of `undefined`
		 * is normalised to null by the DOM, so that is what the parent sees.
		 */
		it("clears the override when the field is emptied", async () => {
			const { onChange } = mount({ value: 4 });
			await userEvent.clear(numberField());
			numberField().dispatchEvent(new Event("change", { bubbles: true }));
			expect(onChange).toHaveBeenCalled();
			expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toBeNull();
		});

		it("does not read an emptied field as zero", async () => {
			const { onChange } = mount({ value: 4 });
			await userEvent.clear(numberField());
			numberField().dispatchEvent(new Event("change", { bubbles: true }));
			expect(onChange).not.toHaveBeenLastCalledWith(0);
		});

		it("carries the bounds the option declares", () => {
			mount({ option: option({ min: 1, max: 16 }) });
			expect(numberField().min).toBe("1");
			expect(numberField().max).toBe("16");
		});
	});

	describe("a boolean option", () => {
		const boolOption = option({ id: "finalNewline", kind: "boolean" });

		it("shows the value that applies", () => {
			mount({ option: boolOption, value: undefined, inherited: true });
			expect(toggle().checked).toBe(true);
		});

		it("reports the new value when toggled", async () => {
			const { onChange } = mount({ option: boolOption, value: false });
			await userEvent.click(toggle());
			expect(onChange).toHaveBeenLastCalledWith(true);
		});

		it("names itself for a screen reader", () => {
			mount({ option: boolOption });
			expect(
				document.querySelector(".settings-toggle")?.getAttribute("aria-label"),
			).toBeTruthy();
		});
	});

	describe("an enum option", () => {
		const enumOption = option({
			id: "indentStyle",
			kind: "enum",
			choices: ["space", "tab"],
		});

		it("offers every choice the option declares", async () => {
			mount({ option: enumOption, value: "space" });
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			expect(screen.getAllByRole("option")).toHaveLength(2);
		});

		it("reports the choice that was picked", async () => {
			const { onChange } = mount({ option: enumOption, value: "space" });
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			await userEvent.click(screen.getAllByRole("option")[1]);
			expect(onChange).toHaveBeenLastCalledWith("tab");
		});
	});
});

describe("ExportModal", () => {
	const STYLE: StyleSet = {
		indentStyle: "space",
		indentSize: 2,
		lineWidth: 100,
		quoteStyle: "double",
		semicolons: true,
	} as unknown as StyleSet;

	function formatter(id: string, supported: string[]): FormatterStatus {
		return {
			id,
			name: id,
			binary: id,
			languageIds: ["typescript"],
			extensions: [".ts"],
			supported,
			configFiles: [],
			docUrl: "",
			toolchain: false,
			installed: true,
			binaryPath: null,
			version: null,
			projectLocal: false,
			installOptions: [],
			uninstallOptions: [],
			updateOptions: [],
		};
	}

	function mount(props: Record<string, unknown> = {}) {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(ExportModal, {
			props: {
				style: STYLE,
				languageId: "typescript",
				formatters: [formatter("prettier", ["indentStyle", "indentSize"])],
				...props,
			},
			events: {
				confirm: (e: CustomEvent) => onConfirm(e.detail),
				close: () => onClose(),
			},
		});
		return { onConfirm, onClose };
	}

	const warning = () => document.querySelector(".exp-warn")?.textContent;
	const pickTarget = async (index: number) => {
		await userEvent.click(
			document.querySelector(".select-trigger") as HTMLElement,
		);
		await userEvent.click(screen.getAllByRole("option")[index]);
		await tick();
	};

	it("offers the formats it can write to", async () => {
		mount();
		await userEvent.click(
			document.querySelector(".select-trigger") as HTMLElement,
		);
		expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
	});

	/**
	 * Cairn's own format holds everything, so nothing is ever dropped.
	 *
	 * Note: `kept` is computed for the cairn target too, but `dropped` returns
	 * an empty list for it without consulting `kept`, so that branch has no
	 * observable effect and this suite cannot pin it down.
	 */
	it("drops nothing when writing Cairn's own format", () => {
		mount();
		expect(warning()).toBeUndefined();
	});

	it("exports to the format that was chosen", async () => {
		const { onConfirm } = mount();
		await userEvent.click(footButtons()[footButtons().length - 1]);
		expect(onConfirm).toHaveBeenCalledWith({ target: "cairn" });
	});

	/**
	 * What a format cannot express is worked out before the write, not reported
	 * after it: choosing a target is the moment the answer matters.
	 */
	it("warns about what another format cannot express", async () => {
		mount();
		await pickTarget(1);
		expect(warning()).toBeTruthy();
	});

	it("warns about nothing a format covers entirely", async () => {
		mount({
			formatters: [formatter("prettier", Object.keys(STYLE))],
			style: STYLE,
		});
		await pickTarget(1);
		expect(warning()).toBeUndefined();
	});

	it("closes without exporting", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.click(footButtons()[0]);
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});

describe("ImportModal", () => {
	function report(overrides: Partial<ImportReport> = {}): ImportReport {
		return {
			source: ".prettierrc",
			style: { indentSize: 4, indentStyle: "space" } as unknown as StyleSet,
			mapped: [
				["tabWidth", "indentSize"],
				["useTabs", "indentStyle"],
			],
			unsupported: [],
			unknown: [],
			...overrides,
		} as ImportReport;
	}

	function mount(overrides: Partial<ImportReport> = {}) {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(ImportModal, {
			props: { report: report(overrides) },
			events: { confirm: () => onConfirm(), close: () => onClose() },
		});
		return { onConfirm, onClose };
	}

	const rows = () => document.querySelectorAll(".imp-row");
	const groups = () => document.querySelectorAll(".imp-group");

	/** What was read, what was ignored, and why: the import is shown before it applies. */
	it("lists every option it read and mapped", () => {
		mount();
		expect(rows()).toHaveLength(2);
		expect(body().textContent).toContain("tabWidth");
	});

	it("shows the value each mapped option takes", () => {
		mount();
		expect(body().textContent).toContain("4");
	});

	it("names the options it could not honour", () => {
		mount({ unsupported: ["printWidth"] });
		expect(body().textContent).toContain("printWidth");
	});

	it("names the keys it did not recognise", () => {
		mount({ unknown: ["someVendorKey"] });
		expect(body().textContent).toContain("someVendorKey");
	});

	/** An empty category is not shown as an empty heading. */
	it("shows only the categories that have something", () => {
		mount({ unsupported: [], unknown: [] });
		expect(groups()).toHaveLength(1);
	});

	it("shows all three categories when all have something", () => {
		mount({ unsupported: ["a"], unknown: ["b"] });
		expect(groups()).toHaveLength(3);
	});

	it("applies the import on request", async () => {
		const { onConfirm } = mount();
		await userEvent.click(footButtons()[footButtons().length - 1]);
		expect(onConfirm).toHaveBeenCalled();
	});

	it("closes without applying anything", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.click(footButtons()[0]);
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("shows an import that read nothing at all", () => {
		mount({ mapped: [] });
		expect(rows()).toHaveLength(0);
		expect(groups()).toHaveLength(1);
	});
});
