import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SearchInput from "./SearchInput.svelte";

const field = () => screen.getByRole("textbox") as HTMLInputElement;
/** The clear button, or null while there is nothing to clear. */
const clearButton = () => screen.queryByRole("button");

describe("SearchInput", () => {
	it("shows the query it is given", () => {
		render(SearchInput, { value: "auth" });
		expect(field().value).toBe("auth");
	});

	it("starts empty when given nothing", () => {
		render(SearchInput);
		expect(field().value).toBe("");
	});

	it("takes what the user types", async () => {
		render(SearchInput);
		await userEvent.type(field(), "auth");
		expect(field().value).toBe("auth");
	});

	it("takes a query with accents", async () => {
		render(SearchInput);
		await userEvent.type(field(), "été");
		expect(field().value).toBe("été");
	});

	it("offers no way to clear an empty field", () => {
		render(SearchInput);
		expect(clearButton()).toBeNull();
	});

	it("offers to clear once there is something to clear", () => {
		render(SearchInput, { value: "auth" });
		expect(clearButton()).not.toBeNull();
	});

	it("empties the field when the user clears it", async () => {
		render(SearchInput, { value: "auth" });
		await userEvent.click(clearButton() as HTMLElement);
		expect(field().value).toBe("");
	});

	it("stops offering to clear once the field is empty again", async () => {
		render(SearchInput, { value: "auth" });
		await userEvent.click(clearButton() as HTMLElement);
		expect(clearButton()).toBeNull();
	});

	it("offers to clear as soon as the user types", async () => {
		render(SearchInput);
		expect(clearButton()).toBeNull();
		await userEvent.type(field(), "a");
		expect(clearButton()).not.toBeNull();
	});

	it("shows the placeholder it is given", () => {
		render(SearchInput, { placeholder: "Rechercher un fichier" });
		expect(field().placeholder).toBe("Rechercher un fichier");
	});

	it("names itself for a screen reader from its label", () => {
		render(SearchInput, { ariaLabel: "Rechercher", placeholder: "..." });
		expect(field().getAttribute("aria-label")).toBe("Rechercher");
	});

	it("falls back to the placeholder when no label is given", () => {
		render(SearchInput, { placeholder: "Rechercher un fichier" });
		expect(field().getAttribute("aria-label")).toBe("Rechercher un fichier");
	});

	it("names the clear button for a screen reader", () => {
		render(SearchInput, { value: "auth" });
		const button = clearButton() as HTMLElement;
		expect(button.getAttribute("aria-label")).toBeTruthy();
		expect(button.getAttribute("aria-label")).not.toMatch(/^common\./);
	});

	/** A query is data the user may want to copy, unlike interface chrome. */
	it("lets the query be selected", () => {
		render(SearchInput, { value: "auth" });
		expect(field().classList.contains("selectable")).toBe(true);
	});

	it("leaves spellcheck off, since a query is not prose", () => {
		render(SearchInput);
		expect(field().getAttribute("spellcheck")).toBe("false");
	});
});
