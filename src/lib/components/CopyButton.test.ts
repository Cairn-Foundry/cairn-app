import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIPBOARD_CLEAR_DELAY } from "$lib/utils/timing";
import CopyButton from "./CopyButton.svelte";

const writeText = vi.fn();

beforeEach(() => {
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("CopyButton", () => {
	it("copies the value it was given", async () => {
		render(CopyButton, { value: "abc1234" });
		await userEvent.click(screen.getByRole("button"));
		expect(writeText).toHaveBeenCalledWith("abc1234");
	});

	it("copies a value with spaces and accents unchanged", async () => {
		render(CopyButton, { value: "dossier été/mon fichier.ts" });
		await userEvent.click(screen.getByRole("button"));
		expect(writeText).toHaveBeenCalledWith("dossier été/mon fichier.ts");
	});

	it("names itself for a screen reader before and after copying", async () => {
		render(CopyButton, { value: "abc" });
		const button = screen.getByRole("button");
		const before = button.getAttribute("aria-label");
		expect(before).toBeTruthy();

		await userEvent.click(button);
		expect(button.getAttribute("aria-label")).toBeTruthy();
		expect(button.getAttribute("aria-label")).not.toBe(before);
	});

	it("confirms the copy, then goes back to offering it", async () => {
		vi.useFakeTimers();
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(CopyButton, { value: "abc" });
		const button = screen.getByRole("button");

		await user.click(button);
		expect(button.classList.contains("copied")).toBe(true);

		await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY + 1);
		expect(button.classList.contains("copied")).toBe(false);
	});

	it("keeps confirming while the user copies again", async () => {
		vi.useFakeTimers();
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(CopyButton, { value: "abc" });
		const button = screen.getByRole("button");

		await user.click(button);
		await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY - 100);
		await user.click(button);
		await vi.advanceTimersByTimeAsync(200);

		expect(button.classList.contains("copied")).toBe(true);
	});

	/** The button sits inside rows that select on click; copying is not selecting. */
	it("does not let the click reach the row it sits in", async () => {
		const onRowClick = vi.fn();
		const { container } = render(CopyButton, { value: "abc" });
		container.addEventListener("click", onRowClick);
		await userEvent.click(screen.getByRole("button"));
		expect(onRowClick).not.toHaveBeenCalled();
	});

	it("never submits the form it may sit in", () => {
		render(CopyButton, { value: "abc" });
		expect(screen.getByRole("button").getAttribute("type")).toBe("button");
	});

	it("copies an empty value rather than refusing", async () => {
		render(CopyButton, { value: "" });
		await userEvent.click(screen.getByRole("button"));
		expect(writeText).toHaveBeenCalledWith("");
	});
});
