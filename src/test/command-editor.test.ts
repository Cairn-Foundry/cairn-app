import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandEditor from "$lib/components/commands/CommandEditor.svelte";
import type { CustomCommand } from "$lib/services/custom-command-service";

function command(overrides: Partial<CustomCommand> = {}): CustomCommand {
	return {
		id: "c1",
		name: "deploy",
		icon: "play",
		color: "#8ab",
		steps: ["npm ci", "npm run build"],
		stopOnError: true,
		cwd: "worktree",
		pinned: false,
		autoClose: false,
		confirm: false,
		...overrides,
	} as CustomCommand;
}

function mount(props: Record<string, unknown> = {}) {
	const onSave = vi.fn();
	const onClose = vi.fn();
	render(CommandEditor, {
		props: { command: command(), scope: "project", ...props },
		events: {
			save: (e: CustomEvent) => onSave(e.detail),
			close: () => onClose(),
		},
	});
	return { onSave, onClose };
}

const stepRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ce-step"));
const stepInputs = () =>
	stepRows().map((r) => r.querySelector("input") as HTMLInputElement);
const stepValues = () => stepInputs().map((i) => i.value);
const nameField = () =>
	document.getElementById("command-name") as HTMLInputElement;
const addStep = () => document.querySelector(".ce-add") as HTMLElement;
const removeIn = (row: HTMLElement) =>
	row.querySelector(".ce-step-btn") as HTMLElement;
const gripIn = (row: HTMLElement) =>
	row.querySelector(".ce-step-grip") as HTMLElement;
const tokens = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ce-token"));
const portError = () => document.querySelector(".ce-error")?.textContent;
const dropIndicators = () => document.querySelectorAll(".ce-step-drop");
const saveButton = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".btn")).find((b) =>
		b.classList.contains("primary"),
	) as HTMLButtonElement;

function pointer(type: string, x: number, y: number) {
	return new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		pointerId: 1,
	});
}

/** Stacks the step rows vertically so a drag can pick an insert position. */
function layOutSteps() {
	const list = document.querySelector(".ce-steps") as HTMLElement;
	list.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
	stepRows().forEach((row, i) => {
		row.getBoundingClientRect = () =>
			({ top: i * 40, bottom: i * 40 + 40, height: 40 }) as DOMRect;
	});
}

beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	document.body.classList.remove("dragging");
});

describe("CommandEditor", () => {
	describe("the steps", () => {
		it("opens with the steps the command already has", () => {
			mount();
			expect(stepValues()).toEqual(["npm ci", "npm run build"]);
		});

		/** A command with no step still shows one empty line to type into. */
		it("shows one empty step for a command with none", () => {
			mount({ command: command({ steps: [] }) });
			expect(stepValues()).toEqual([""]);
		});

		it("adds a step on request", async () => {
			mount();
			await userEvent.click(addStep());
			expect(stepRows()).toHaveLength(3);
		});

		it("removes the step that was asked for", async () => {
			mount();
			await userEvent.click(removeIn(stepRows()[0]));
			expect(stepValues()).toEqual(["npm run build"]);
		});

		/** Removing the last step leaves an empty line rather than nothing. */
		it("keeps one empty step when the last is removed", async () => {
			mount({ command: command({ steps: ["only"] }) });
			await userEvent.click(removeIn(stepRows()[0]));
			expect(stepValues()).toEqual([""]);
		});
	});

	describe("reordering the steps", () => {
		it("moves a step down the list", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[0]);
			grip.dispatchEvent(pointer("pointerdown", 0, 10));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 110));
			grip.dispatchEvent(pointer("pointerup", 0, 110));
			await tick();
			expect(stepValues()).toEqual(["b", "c", "a"]);
		});

		it("moves a step up the list", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[2]);
			grip.dispatchEvent(pointer("pointerdown", 0, 90));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 5));
			grip.dispatchEvent(pointer("pointerup", 0, 5));
			await tick();
			expect(stepValues()).toEqual(["c", "a", "b"]);
		});

		/**
		 * Under the threshold the gesture is a click, not a drag - even when
		 * those few pixels already cross into the next step, which they do on a
		 * grip pressed near a row boundary. A move that stays inside the same
		 * slot would land in the same place either way and test nothing.
		 */
		it("ignores a movement too small to be a drag", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[1]);
			grip.dispatchEvent(pointer("pointerdown", 0, 22));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 18));
			grip.dispatchEvent(pointer("pointerup", 0, 18));
			await tick();
			expect(stepValues()).toEqual(["a", "b", "c"]);
		});

		/** Just past the threshold, the same gesture reorders. */
		it("starts the drag once the movement passes the threshold", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[1]);
			grip.dispatchEvent(pointer("pointerdown", 0, 22));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 12));
			grip.dispatchEvent(pointer("pointerup", 0, 12));
			await tick();
			expect(stepValues()).toEqual(["b", "a", "c"]);
		});

		it("shows where the step would land while it is dragged", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[0]);
			grip.dispatchEvent(pointer("pointerdown", 0, 10));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 110));
			await tick();
			expect(dropIndicators().length).toBeGreaterThan(0);
			expect(stepRows()[0].classList.contains("dragging")).toBe(true);
		});

		it("clears the indicator once the step is dropped", async () => {
			mount({ command: command({ steps: ["a", "b", "c"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[0]);
			grip.dispatchEvent(pointer("pointerdown", 0, 10));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 110));
			grip.dispatchEvent(pointer("pointerup", 0, 110));
			await tick();
			expect(dropIndicators()).toHaveLength(0);
		});

		it("leaves the body cursor alone once the drag ends", async () => {
			mount({ command: command({ steps: ["a", "b"] }) });
			layOutSteps();
			const grip = gripIn(stepRows()[0]);
			grip.dispatchEvent(pointer("pointerdown", 0, 10));
			layOutSteps();
			grip.dispatchEvent(pointer("pointermove", 0, 90));
			expect(document.body.classList.contains("dragging")).toBe(true);
			grip.dispatchEvent(pointer("pointerup", 0, 90));
			expect(document.body.classList.contains("dragging")).toBe(false);
		});

		it("captures the pointer on the grip that was pressed", () => {
			mount({ command: command({ steps: ["a", "b"] }) });
			layOutSteps();
			gripIn(stepRows()[0]).dispatchEvent(pointer("pointerdown", 0, 10));
			expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
		});
	});

	describe("the variable tokens", () => {
		it("offers a token per variable the command may use", () => {
			mount();
			expect(tokens().length).toBeGreaterThan(2);
		});

		it("inserts the token into the step being edited", async () => {
			mount({ command: command({ steps: ["echo "] }) });
			const input = stepInputs()[0];
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			await userEvent.click(tokens()[0]);
			expect(stepValues()[0]).toMatch(/^echo \{\{.+\}\}$/);
		});

		it("inserts into the step that has the focus, not the first", async () => {
			mount({ command: command({ steps: ["first", "second"] }) });
			const input = stepInputs()[1];
			input.focus();
			await userEvent.click(tokens()[0]);
			expect(stepValues()[0]).toBe("first");
			expect(stepValues()[1]).toContain("{{");
		});
	});

	describe("what it refuses to save", () => {
		it("refuses a command with no name", async () => {
			mount();
			await userEvent.clear(nameField());
			expect(saveButton().disabled).toBe(true);
		});

		it("refuses a command whose steps are all blank", async () => {
			mount({ command: command({ steps: ["   "] }) });
			expect(saveButton().disabled).toBe(true);
		});

		/**
		 * A port token whose base is not a number would fail at run time, so it
		 * is refused while it is being written instead.
		 */
		it("refuses a step with a malformed port token", async () => {
			mount({ command: command({ steps: ["serve --port {{port:abc}}"] }) });
			expect(portError()).toBeTruthy();
			expect(saveButton().disabled).toBe(true);
		});

		it("accepts a well formed port token", () => {
			mount({ command: command({ steps: ["serve --port {{port:3000}}"] }) });
			expect(portError()).toBeUndefined();
			expect(saveButton().disabled).toBe(false);
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("still refuses to save when the button is forced", async () => {
			const { onSave } = mount();
			await userEvent.clear(nameField());
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			expect(onSave).not.toHaveBeenCalled();
		});
	});

	describe("saving", () => {
		it("saves the command with its steps trimmed", async () => {
			const { onSave } = mount({
				command: command({ steps: ["  npm ci  ", "npm test"] }),
			});
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].command.steps).toEqual([
				"npm ci",
				"npm test",
			]);
		});

		/** A blank line is not a step, so it is dropped rather than run. */
		it("drops the blank steps", async () => {
			const { onSave } = mount({
				command: command({ steps: ["npm ci", "   ", "npm test"] }),
			});
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].command.steps).toEqual([
				"npm ci",
				"npm test",
			]);
		});

		it("trims the name", async () => {
			const { onSave } = mount();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "  deploy  ");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].command.name).toBe("deploy");
		});

		it("keeps the id of the command being edited", async () => {
			const { onSave } = mount({ command: command({ id: "keep-me" }) });
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].command.id).toBe("keep-me");
		});

		it("saves into the scope it was opened in", async () => {
			const { onSave } = mount({ scope: "global" });
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].scope).toBe("global");
		});

		it("closes without saving", async () => {
			const { onSave, onClose } = mount();
			const cancel = Array.from(
				document.querySelectorAll<HTMLElement>(".btn"),
			).find((b) => b.classList.contains("ghost")) as HTMLElement;
			await userEvent.click(cancel);
			expect(onClose).toHaveBeenCalled();
			expect(onSave).not.toHaveBeenCalled();
		});
	});
});
