import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import KeyValueEditor from "./KeyValueEditor.svelte";

function mount(props: Record<string, unknown> = {}) {
	const onChange = vi.fn();
	const result = render(KeyValueEditor, {
		props: {
			pairs: {},
			keyPlaceholder: "Name",
			valuePlaceholder: "Value",
			...props,
		},
		events: { change: (e: CustomEvent) => onChange(e.detail) },
	});
	return { ...result, onChange };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".kv-row"));
/** The last row is the empty one that adds a pair; the others are the pairs. */
const pairRows = () => rows().slice(0, -1);
const addRow = () => rows()[rows().length - 1];
const inputsOf = (row: HTMLElement) =>
	Array.from(row.querySelectorAll<HTMLInputElement>("input"));
const lastChange = (onChange: ReturnType<typeof vi.fn>) =>
	onChange.mock.calls[onChange.mock.calls.length - 1][0];

describe("KeyValueEditor", () => {
	describe("showing the pairs", () => {
		it("shows one row per pair, plus the row that adds one", () => {
			mount({ pairs: { A: "1", B: "2" } });
			expect(pairRows()).toHaveLength(2);
			expect(inputsOf(pairRows()[0]).map((i) => i.value)).toEqual(["A", "1"]);
		});

		it("shows only the adding row when there is nothing yet", () => {
			mount({ pairs: {} });
			expect(pairRows()).toHaveLength(0);
			expect(addRow()).toBeTruthy();
		});

		it("keeps the pairs in the order they were given", () => {
			mount({ pairs: { Z: "1", A: "2", M: "3" } });
			expect(pairRows().map((r) => inputsOf(r)[0].value)).toEqual([
				"Z",
				"A",
				"M",
			]);
		});

		it("names both fields for a screen reader", () => {
			mount({ pairs: { A: "1" } });
			expect(screen.getAllByLabelText("Name").length).toBeGreaterThan(0);
			expect(screen.getAllByLabelText("Value").length).toBeGreaterThan(0);
		});
	});

	describe("adding a pair", () => {
		it("adds what was typed", async () => {
			const { onChange } = mount({ pairs: { A: "1" } });
			const [key, value] = inputsOf(addRow());
			await userEvent.type(key, "TOKEN");
			await userEvent.type(value, "abc");
			await userEvent.click(addRow().querySelector("button") as HTMLElement);
			expect(lastChange(onChange)).toEqual({ A: "1", TOKEN: "abc" });
		});

		it("adds on Enter from either field", async () => {
			for (const index of [0, 1]) {
				const { onChange, unmount } = mount();
				const fields = inputsOf(addRow());
				await userEvent.type(fields[0], "K");
				await userEvent.type(fields[index], "{Enter}");
				expect(lastChange(onChange)).toEqual({ K: "" });
				unmount();
			}
		});

		it("refuses a pair with no name", async () => {
			const { onChange } = mount();
			const [, value] = inputsOf(addRow());
			await userEvent.type(value, "orphan");
			await userEvent.click(addRow().querySelector("button") as HTMLElement);
			expect(onChange).not.toHaveBeenCalled();
		});

		it("disables the button until a name is typed", async () => {
			mount();
			const button = addRow().querySelector("button") as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			await userEvent.type(inputsOf(addRow())[0], "K");
			expect(button.disabled).toBe(false);
		});

		it("refuses a name of spaces only", async () => {
			const { onChange } = mount();
			await userEvent.type(inputsOf(addRow())[0], "   ");
			await userEvent.type(inputsOf(addRow())[0], "{Enter}");
			expect(onChange).not.toHaveBeenCalled();
		});

		it("trims the name it adds", async () => {
			const { onChange } = mount();
			await userEvent.type(inputsOf(addRow())[0], "  K  ");
			await userEvent.type(inputsOf(addRow())[0], "{Enter}");
			expect(Object.keys(lastChange(onChange))).toEqual(["K"]);
		});

		it("accepts a pair with an empty value", async () => {
			const { onChange } = mount();
			await userEvent.type(inputsOf(addRow())[0], "EMPTY");
			await userEvent.type(inputsOf(addRow())[0], "{Enter}");
			expect(lastChange(onChange)).toEqual({ EMPTY: "" });
		});

		it("empties its own fields once the pair is added", async () => {
			mount();
			await userEvent.type(inputsOf(addRow())[0], "K");
			await userEvent.type(inputsOf(addRow())[1], "V{Enter}");
			expect(inputsOf(addRow()).map((i) => i.value)).toEqual(["", ""]);
		});

		/** Adding under an existing name replaces its value rather than duplicating it. */
		it("overwrites a name that already exists", async () => {
			const { onChange } = mount({ pairs: { A: "old" } });
			await userEvent.type(inputsOf(addRow())[0], "A");
			await userEvent.type(inputsOf(addRow())[1], "new{Enter}");
			expect(lastChange(onChange)).toEqual({ A: "new" });
		});
	});

	describe("editing a pair", () => {
		it("reports a new value as it is typed", async () => {
			const { onChange } = mount({ pairs: { A: "1" } });
			await userEvent.type(inputsOf(pairRows()[0])[1], "2");
			expect(lastChange(onChange)).toEqual({ A: "12" });
		});

		/** Renaming in place keeps the row where it was, rather than moving it last. */
		it("renames a key without moving it", async () => {
			const { onChange } = mount({ pairs: { A: "1", B: "2", C: "3" } });
			const key = inputsOf(pairRows()[1])[0];
			await userEvent.clear(key);
			await userEvent.type(key, "RENAMED");
			await userEvent.tab();
			expect(Object.keys(lastChange(onChange))).toEqual(["A", "RENAMED", "C"]);
		});

		it("keeps the value through a rename", async () => {
			const { onChange } = mount({ pairs: { A: "keep" } });
			const key = inputsOf(pairRows()[0])[0];
			await userEvent.clear(key);
			await userEvent.type(key, "B");
			await userEvent.tab();
			expect(lastChange(onChange)).toEqual({ B: "keep" });
		});

		it("says nothing when a key is retyped identically", async () => {
			const { onChange } = mount({ pairs: { A: "1" } });
			const key = inputsOf(pairRows()[0])[0];
			await userEvent.clear(key);
			await userEvent.type(key, "A");
			await userEvent.tab();
			expect(onChange).not.toHaveBeenCalled();
		});

		it("drops the pair rather than keeping one with no name", async () => {
			const { onChange } = mount({ pairs: { A: "1", B: "2" } });
			const key = inputsOf(pairRows()[0])[0];
			await userEvent.clear(key);
			await userEvent.tab();
			expect(lastChange(onChange)).toEqual({ B: "2" });
		});

		it("removes a pair on request", async () => {
			const { onChange } = mount({ pairs: { A: "1", B: "2" } });
			const remove = pairRows()[0].querySelector(".danger") as HTMLElement;
			await userEvent.click(remove);
			expect(lastChange(onChange)).toEqual({ B: "2" });
		});

		it("removes the last pair, leaving an empty map", async () => {
			const { onChange } = mount({ pairs: { A: "1" } });
			await userEvent.click(
				pairRows()[0].querySelector(".danger") as HTMLElement,
			);
			expect(lastChange(onChange)).toEqual({});
		});
	});

	describe("secret values", () => {
		it("masks the values when the caller asks for it", () => {
			mount({ pairs: { TOKEN: "abc" }, secret: true });
			expect(inputsOf(pairRows()[0])[1].type).toBe("password");
		});

		it("shows them plainly otherwise", () => {
			mount({ pairs: { TOKEN: "abc" }, secret: false });
			expect(inputsOf(pairRows()[0])[1].type).toBe("text");
		});

		/** Nothing is hidden by masking an empty field, and it reads as broken. */
		it("does not mask an empty value", () => {
			mount({ pairs: { TOKEN: "" }, secret: true });
			expect(inputsOf(pairRows()[0])[1].type).toBe("text");
		});

		it("reveals one value on request, leaving the others masked", async () => {
			mount({ pairs: { A: "1", B: "2" }, secret: true });
			const reveal = pairRows()[0].querySelector(
				".kv-btn:not(.danger)",
			) as HTMLElement;
			await userEvent.click(reveal);
			expect(inputsOf(pairRows()[0])[1].type).toBe("text");
			expect(inputsOf(pairRows()[1])[1].type).toBe("password");
		});

		it("offers no reveal button when nothing is secret", () => {
			mount({ pairs: { A: "1" }, secret: false });
			expect(
				pairRows()[0].querySelectorAll(".kv-btn:not(.danger)"),
			).toHaveLength(0);
		});
	});
});
