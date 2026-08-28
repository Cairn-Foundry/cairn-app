import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import Select from "./Select.svelte";

const OPTIONS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Bravo" },
	{ value: "c", label: "Charlie" },
];

function mount(props: Record<string, unknown> = {}) {
	const onChange = vi.fn();
	const result = render(Select, {
		props: { value: "a", options: OPTIONS, ...props },
		events: { change: (e: CustomEvent<string>) => onChange(e.detail) },
	});
	return { ...result, onChange };
}

const anyTrigger = () =>
	document.querySelector(".select-trigger") as HTMLButtonElement;
const list = () => screen.queryByRole("listbox");
const optionNamed = (label: string) =>
	screen.getByRole("option", { name: new RegExp(label) });
const highlighted = () =>
	document.querySelector(".select-option.highlighted")?.textContent?.trim();

describe("Select", () => {
	describe("what it shows", () => {
		it("names the current choice on the trigger", () => {
			mount({ value: "b" });
			expect(anyTrigger().textContent).toContain("Bravo");
		});

		it("shows nothing rather than a stale label when the value is unknown", () => {
			mount({ value: "gone" });
			expect(anyTrigger().textContent?.trim()).toBe("");
		});

		it("stays closed until it is asked to open", () => {
			mount();
			expect(list()).toBeNull();
			expect(anyTrigger().getAttribute("aria-expanded")).toBe("false");
		});

		it("marks the chosen option for a screen reader", async () => {
			mount({ value: "b" });
			await userEvent.click(anyTrigger());
			expect(optionNamed("Bravo").getAttribute("aria-selected")).toBe("true");
			expect(optionNamed("Alpha").getAttribute("aria-selected")).toBe("false");
		});

		it("closes again on a second click", async () => {
			mount();
			await userEvent.click(anyTrigger());
			expect(list()).not.toBeNull();
			await userEvent.click(anyTrigger());
			expect(list()).toBeNull();
		});
	});

	describe("choosing", () => {
		it("reports the option that was clicked", async () => {
			const { onChange } = mount();
			await userEvent.click(anyTrigger());
			await userEvent.click(optionNamed("Charlie"));
			expect(onChange).toHaveBeenCalledWith("c");
		});

		it("shows the new choice and closes", async () => {
			mount();
			await userEvent.click(anyTrigger());
			await userEvent.click(optionNamed("Charlie"));
			expect(list()).toBeNull();
			expect(anyTrigger().textContent).toContain("Charlie");
		});

		/** Re-picking what is already chosen changes nothing, so nobody is told. */
		it("stays silent when the same option is picked again", async () => {
			const { onChange } = mount({ value: "b" });
			await userEvent.click(anyTrigger());
			await userEvent.click(optionNamed("Bravo"));
			expect(onChange).not.toHaveBeenCalled();
			expect(list()).toBeNull();
		});
	});

	describe("the keyboard", () => {
		it("opens on Enter, on space and on ArrowDown", async () => {
			for (const key of ["{Enter}", " ", "{ArrowDown}"]) {
				const { unmount } = mount();
				anyTrigger().focus();
				await userEvent.keyboard(key);
				expect(list()).not.toBeNull();
				unmount();
			}
		});

		it("opens on the option in use, not on the first one", async () => {
			mount({ value: "c" });
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}");
			expect(highlighted()).toContain("Charlie");
		});

		it("falls back to the first option when the value matches none", async () => {
			mount({ value: "gone" });
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}");
			expect(highlighted()).toContain("Alpha");
		});

		it("walks down the list and wraps around the end", async () => {
			mount();
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}{ArrowDown}");
			expect(highlighted()).toContain("Bravo");
			await userEvent.keyboard("{ArrowDown}{ArrowDown}");
			expect(highlighted()).toContain("Alpha");
		});

		it("walks up the list and wraps around the start", async () => {
			mount();
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}{ArrowUp}");
			expect(highlighted()).toContain("Charlie");
		});

		it("chooses what Enter lands on", async () => {
			const { onChange } = mount();
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}{ArrowDown}{Enter}");
			expect(onChange).toHaveBeenCalledWith("b");
			expect(list()).toBeNull();
		});

		it("closes on Escape without choosing", async () => {
			const { onChange } = mount();
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}{ArrowDown}{Escape}");
			expect(list()).toBeNull();
			expect(onChange).not.toHaveBeenCalled();
		});

		/** The list scrolls under the pointer as well as under the arrows. */
		it("follows the pointer moving over an option", async () => {
			mount();
			await userEvent.click(anyTrigger());
			await userEvent.hover(optionNamed("Charlie"));
			expect(highlighted()).toContain("Charlie");
		});
	});

	describe("when disabled", () => {
		it("does not open on a click", async () => {
			mount({ disabled: true });
			await userEvent.click(anyTrigger());
			expect(list()).toBeNull();
		});

		it("does not open from the keyboard", async () => {
			mount({ disabled: true });
			anyTrigger().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await tick();
			expect(list()).toBeNull();
		});
	});

	describe("staying attached to its trigger", () => {
		/** A panel positioned in fixed coordinates drifts when the page scrolls under it. */
		it("closes when the page scrolls beneath it", async () => {
			mount();
			await userEvent.click(anyTrigger());
			document.body.dispatchEvent(new Event("scroll", { bubbles: true }));
			await tick();
			expect(list()).toBeNull();
		});

		it("stays open while the list itself is scrolled", async () => {
			mount();
			await userEvent.click(anyTrigger());
			(list() as HTMLElement).dispatchEvent(
				new Event("scroll", { bubbles: true }),
			);
			await tick();
			expect(list()).not.toBeNull();
		});

		it("closes on a click outside", async () => {
			mount();
			await userEvent.click(anyTrigger());
			await userEvent.click(document.body);
			expect(list()).toBeNull();
		});

		it("places the panel over the trigger, at its width", async () => {
			mount();
			anyTrigger().getBoundingClientRect = () =>
				({
					left: 40,
					right: 240,
					top: 100,
					bottom: 130,
					width: 200,
				}) as DOMRect;
			await userEvent.click(anyTrigger());
			const style = (list() as HTMLElement).getAttribute("style") ?? "";
			expect(style).toContain("left: 40px");
			expect(style).toContain("width: 200px");
		});

		/** No room below, room above: the list opens upwards rather than off-screen. */
		it("opens upwards when the trigger sits near the bottom", async () => {
			mount();
			window.innerHeight = 600;
			anyTrigger().getBoundingClientRect = () =>
				({ left: 0, right: 100, top: 540, bottom: 570, width: 100 }) as DOMRect;
			await userEvent.click(anyTrigger());
			const style = (list() as HTMLElement).getAttribute("style") ?? "";
			expect(style).toContain("bottom:");
			expect(style).not.toContain("top:");
		});

		it("opens downwards when there is room", async () => {
			mount();
			window.innerHeight = 600;
			anyTrigger().getBoundingClientRect = () =>
				({ left: 0, right: 100, top: 20, bottom: 50, width: 100 }) as DOMRect;
			await userEvent.click(anyTrigger());
			const style = (list() as HTMLElement).getAttribute("style") ?? "";
			expect(style).toContain("top: 54px");
		});
	});

	describe("with no options", () => {
		it("opens an empty list rather than breaking", async () => {
			mount({ options: [], value: "" });
			await userEvent.click(anyTrigger());
			expect(list()).not.toBeNull();
			expect(screen.queryAllByRole("option")).toHaveLength(0);
		});

		it("survives the arrow keys with nothing to walk", async () => {
			const { onChange } = mount({ options: [], value: "" });
			anyTrigger().focus();
			await userEvent.keyboard("{Enter}{ArrowDown}{Enter}");
			expect(onChange).not.toHaveBeenCalled();
		});
	});
});
