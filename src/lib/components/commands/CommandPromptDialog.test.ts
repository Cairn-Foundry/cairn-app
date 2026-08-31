// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommandPromptDialog from "./CommandPromptDialog.svelte";

function mount(props: Record<string, unknown> = {}) {
	const onSubmit = vi.fn();
	const onClose = vi.fn();
	const result = render(CommandPromptDialog, {
		props: { commandName: "deploy", labels: ["Environment"], ...props },
		events: {
			submit: (e: CustomEvent) => onSubmit(e.detail),
			close: () => onClose(),
		},
	});
	return { ...result, onSubmit, onClose };
}

const fields = () =>
	Array.from(document.querySelectorAll<HTMLInputElement>(".cp-input"));
const fieldFor = (label: string) =>
	screen.getByLabelText(label) as HTMLInputElement;
const runButton = () => document.querySelector(".btn.primary") as HTMLElement;

describe("CommandPromptDialog", () => {
	describe("what it asks", () => {
		it("names the command it is about to run", () => {
			mount({ commandName: "deploy to staging" });
			expect(document.querySelector(".step-count")?.textContent?.trim()).toBe(
				"deploy to staging",
			);
		});

		it("asks one question per variable the command declares", () => {
			mount({ labels: ["Environment", "Version", "Ticket"] });
			expect(fields()).toHaveLength(3);
		});

		it("labels each field with the variable it stands for", () => {
			mount({ labels: ["Environment", "Version"] });
			expect(fieldFor("Environment")).toBeTruthy();
			expect(fieldFor("Version")).toBeTruthy();
		});

		it("starts every field empty", () => {
			mount({ labels: ["A", "B"] });
			expect(fields().map((f) => f.value)).toEqual(["", ""]);
		});

		it("puts the cursor in the first field", () => {
			mount({ labels: ["First", "Second"] });
			expect(document.activeElement).toBe(fieldFor("First"));
		});

		/** A command declaring no variable should not open an empty prompt. */
		it("asks nothing when the command declares no variable", () => {
			mount({ labels: [] });
			expect(fields()).toHaveLength(0);
		});
	});

	describe("answering", () => {
		it("reports the answers keyed by their label", async () => {
			const { onSubmit } = mount({ labels: ["Environment", "Version"] });
			await userEvent.type(fieldFor("Environment"), "staging");
			await userEvent.type(fieldFor("Version"), "1.2.3");
			await userEvent.click(runButton());
			expect(onSubmit).toHaveBeenCalledWith({
				Environment: "staging",
				Version: "1.2.3",
			});
		});

		it("runs on Enter without reaching for the button", async () => {
			const { onSubmit } = mount({ labels: ["Environment"] });
			await userEvent.type(fieldFor("Environment"), "prod{Enter}");
			expect(onSubmit).toHaveBeenCalledWith({ Environment: "prod" });
		});

		/** An empty answer is an answer: the variable is substituted with nothing. */
		it("submits an unanswered variable as an empty value", async () => {
			const { onSubmit } = mount({ labels: ["Optional"] });
			await userEvent.click(runButton());
			expect(onSubmit).toHaveBeenCalledWith({ Optional: "" });
		});

		it("keeps a value with spaces and accents as it was typed", async () => {
			const { onSubmit } = mount({ labels: ["Message"] });
			await userEvent.type(fieldFor("Message"), "  déployé en été  ");
			await userEvent.click(runButton());
			expect(onSubmit).toHaveBeenCalledWith({
				Message: "  déployé en été  ",
			});
		});

		it("submits an empty map for a command with no variable", async () => {
			const { onSubmit } = mount({ labels: [] });
			await userEvent.click(runButton());
			expect(onSubmit).toHaveBeenCalledWith({});
		});

		/**
		 * The same variable used twice is one question, and both occurrences take
		 * the one answer given - the map is keyed by label.
		 */
		it("asks once for a variable the command names twice", async () => {
			const { onSubmit } = mount({ labels: ["Env", "Env"] });
			await userEvent.type(fields()[0], "prod");
			await userEvent.click(runButton());
			expect(onSubmit).toHaveBeenCalledWith({ Env: "prod" });
		});
	});

	describe("giving up", () => {
		it("closes on Escape without running anything", async () => {
			const { onClose, onSubmit } = mount();
			await userEvent.type(fieldFor("Environment"), "{Escape}");
			expect(onClose).toHaveBeenCalled();
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it("closes on cancel", async () => {
			const { onClose, onSubmit } = mount();
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(onClose).toHaveBeenCalled();
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it("closes on the close button", async () => {
			const { onClose } = mount();
			await userEvent.click(
				screen.getByRole("button", { name: /close|fermer/i }),
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click on the backdrop", async () => {
			const { onClose } = mount();
			await userEvent.click(screen.getByRole("dialog"));
			expect(onClose).toHaveBeenCalled();
		});

		/** Clicking inside the form is not clicking away from it. */
		it("stays open on a click inside the form", async () => {
			const { onClose } = mount();
			await userEvent.click(fieldFor("Environment"));
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
