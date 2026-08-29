import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "$lib/services/custom-command-service";

const saveProjectCommands = vi.fn(async (..._a: unknown[]) => {});
const saveGlobalCommands = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/services/custom-command-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getProjectCommands: vi.fn(async () => ({ commands: [] })),
	getGlobalCommands: vi.fn(async () => ({ commands: [] })),
	saveProjectCommands: (...a: unknown[]) => saveProjectCommands(...a),
	saveGlobalCommands: (...a: unknown[]) => saveGlobalCommands(...a),
}));

const commandRuns = writable<Record<string, unknown>>({});
const requestCommandLaunch = vi.fn(async (..._a: unknown[]) => {});
const stopCommand = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/command-run", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	commandRuns: { subscribe: commandRuns.subscribe },
	requestCommandLaunch: (...a: unknown[]) => requestCommandLaunch(...a),
	stopCommand: (...a: unknown[]) => stopCommand(...a),
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const { globalCommands, projectCommands } = await import(
	"$lib/stores/custom-command"
);
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: CommandsView } = await import(
	"$lib/components/commands/CommandsView.svelte"
);

function command(overrides: Partial<CustomCommand> = {}): CustomCommand {
	return {
		id: "c1",
		name: "deploy",
		icon: "play",
		steps: ["npm ci"],
		stopOnError: true,
		cwd: "worktree",
		pinned: false,
		autoClose: false,
		confirm: false,
		source: "manual",
		...overrides,
	} as CustomCommand;
}

const sections = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".cmd-section"));
const rowsIn = (section: HTMLElement) =>
	Array.from(section.querySelectorAll<HTMLElement>(".cmd-row"));
const allRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".cmd-row"));
const namesIn = (section: HTMLElement) =>
	rowsIn(section).map((r) => r.querySelector(".cmd-name")?.textContent?.trim());
const globalSection = () => sections()[0];
const projectSection = () => sections()[1];
const actionIn = (row: HTMLElement, title: RegExp) =>
	Array.from(row.querySelectorAll<HTMLButtonElement>(".cmd-action")).find((b) =>
		title.test(b.getAttribute("title") ?? ""),
	) as HTMLButtonElement;
const dropIndicators = () => document.querySelectorAll(".cmd-drop");
const editorOpen = () => document.querySelector(".ce-steps") !== null;

function pointer(type: string, y: number) {
	return new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: 0,
		clientY: y,
		pointerId: 1,
	});
}

/**
 * jsdom gives every element a zero rect, so the two lists and their rows are
 * laid out by hand: global rows at y 0-80, project rows at y 200-280.
 */
function layOut() {
	const lists = Array.from(document.querySelectorAll<HTMLElement>(".cmd-list"));
	lists[0].getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
	lists[1].getBoundingClientRect = () => ({ top: 200, bottom: 300 }) as DOMRect;
	lists.forEach((list, listIndex) => {
		const base = listIndex === 0 ? 0 : 200;
		Array.from(list.querySelectorAll<HTMLElement>(".cmd-row")).forEach(
			(row, i) => {
				row.getBoundingClientRect = () =>
					({
						top: base + i * 40,
						bottom: base + i * 40 + 40,
						height: 40,
					}) as DOMRect;
			},
		);
	});
}

/** Drags the row at `from` to the pointer position `toY` and drops it. */
async function drag(row: HTMLElement, toY: number) {
	row.dispatchEvent(pointer("pointerdown", 0));
	await tickTwice();
	layOut();
	row.dispatchEvent(pointer("pointermove", toY));
	await tickTwice();
	row.dispatchEvent(pointer("pointerup", toY));
	await tickTwice();
}

async function tickTwice() {
	const { tick } = await import("svelte");
	await tick();
	await tick();
}

function mount() {
	return render(CommandsView, { props: {} });
}

beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn((..._a: unknown[]) => undefined);
	Element.prototype.releasePointerCapture = vi.fn(
		(..._a: unknown[]) => undefined,
	);
	document.body.classList.remove("dragging");
	saveProjectCommands.mockClear();
	saveGlobalCommands.mockClear();
	requestCommandLaunch.mockClear();
	stopCommand.mockClear();
	commandRuns.set({});
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstance.set({ id: "i1", projectId: "p1" });
	globalCommands.set([command({ id: "g1", name: "lint" })]);
	projectCommands.set({
		p1: [
			command({ id: "c1", name: "deploy" }),
			command({ id: "c2", name: "seed" }),
		],
	});
});

describe("CommandsView", () => {
	describe("the two lists", () => {
		it("shows the global commands apart from the project ones", () => {
			mount();
			expect(namesIn(globalSection())).toEqual(["lint"]);
			expect(namesIn(projectSection())).toEqual(["deploy", "seed"]);
		});

		/** A project's commands belong to that project alone. */
		it("shows nothing from another project", () => {
			projectCommands.set({
				p1: [command({ id: "c1", name: "deploy" })],
				p2: [command({ id: "c9", name: "elsewhere" })],
			});
			mount();
			expect(namesIn(projectSection())).toEqual(["deploy"]);
		});

		it("shows no project command when no project is open", () => {
			activeProjectId.set(null);
			mount();
			expect(namesIn(projectSection())).toEqual([]);
		});

		it("shows the steps of each command", () => {
			projectCommands.set({
				p1: [command({ id: "c1", steps: ["a", "b"] })],
			});
			mount();
			expect(
				projectSection().querySelector(".cmd-steps")?.textContent,
			).toContain("a && b");
		});
	});

	describe("running a command", () => {
		it("launches the command that was asked for", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[1], /run|lancer|exécuter/i));
			expect(requestCommandLaunch).toHaveBeenCalledTimes(1);
			expect((requestCommandLaunch.mock.calls[0][0] as CustomCommand).id).toBe(
				"c1",
			);
		});

		/** A command needs an instance to run in. */
		it("cannot be run with no instance selected", async () => {
			activeInstance.set(null);
			mount();
			expect(actionIn(allRows()[0], /run|lancer|exécuter/i).disabled).toBe(
				true,
			);
		});

		it("launches nothing with no instance even when forced", async () => {
			activeInstance.set(null);
			mount();
			const button = actionIn(allRows()[0], /run|lancer|exécuter/i);
			button.disabled = false;
			await userEvent.click(button);
			expect(requestCommandLaunch).not.toHaveBeenCalled();
		});

		/** A running command offers to be stopped instead of started again. */
		it("offers to stop the command that is running", async () => {
			commandRuns.set({
				"p1:i1:c1": { projectId: "p1", instanceId: "i1", commandId: "c1" },
			});
			mount();
			await userEvent.click(actionIn(allRows()[1], /stop|arrêter/i));
			expect(stopCommand).toHaveBeenCalledWith("p1:i1:c1");
		});

		it("marks only the running command as running", () => {
			commandRuns.set({
				"p1:i1:c1": { projectId: "p1", instanceId: "i1", commandId: "c1" },
			});
			mount();
			expect(allRows()[1].querySelector(".cmd-dot.running")).not.toBeNull();
			expect(allRows()[2].querySelector(".cmd-dot.running")).toBeNull();
		});

		/** A run belonging to another instance is not this instance's run. */
		it("ignores a run from another instance", () => {
			commandRuns.set({
				"p1:i2:c1": { projectId: "p1", instanceId: "i2", commandId: "c1" },
			});
			mount();
			expect(document.querySelector(".cmd-dot.running")).toBeNull();
		});

		it("ignores a run from another project", () => {
			commandRuns.set({
				"p2:i1:c1": { projectId: "p2", instanceId: "i1", commandId: "c1" },
			});
			mount();
			expect(document.querySelector(".cmd-dot.running")).toBeNull();
		});
	});

	describe("the row actions", () => {
		it("pins the command that was asked for", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[1], /pin|épingl/i));
			expect(get(projectCommands).p1[0].pinned).toBe(true);
			expect(get(projectCommands).p1[1].pinned).toBe(false);
		});

		it("unpins a pinned command", async () => {
			projectCommands.set({
				p1: [command({ id: "c1", name: "deploy", pinned: true })],
			});
			mount();
			await userEvent.click(actionIn(allRows()[1], /pin|épingl|désép/i));
			expect(get(projectCommands).p1[0].pinned).toBe(false);
		});

		it("duplicates the command that was asked for", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[1], /duplicat|dupliqu/i));
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"deploy",
				"seed",
				"deploy 2",
			]);
		});

		it("deletes the command that was asked for", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[1], /delete|supprim/i));
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual(["seed"]);
		});

		it("deletes a global command from the global list only", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[0], /delete|supprim/i));
			expect(get(globalCommands)).toEqual([]);
			expect(get(projectCommands).p1).toHaveLength(2);
		});

		/** The row itself opens the editor; its buttons must not. */
		it("does not open the editor when a row action is used", async () => {
			mount();
			await userEvent.click(actionIn(allRows()[1], /duplicat|dupliqu/i));
			expect(editorOpen()).toBe(false);
		});

		it("opens the editor on the row itself", async () => {
			mount();
			await userEvent.click(allRows()[1]);
			expect(editorOpen()).toBe(true);
		});
	});

	describe("dragging a command", () => {
		/** Below the threshold the gesture is a click, not a drag. */
		it("treats a small movement as a click on the row", async () => {
			mount();
			layOut();
			const row = allRows()[1];
			row.dispatchEvent(pointer("pointerdown", 0));
			await tickTwice();
			row.dispatchEvent(pointer("pointermove", 3));
			await tickTwice();
			row.dispatchEvent(pointer("pointerup", 3));
			await tickTwice();
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"deploy",
				"seed",
			]);
		});

		it("reorders within the project list", async () => {
			mount();
			layOut();
			await drag(allRows()[1], 290);
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"seed",
				"deploy",
			]);
		});

		/** Dragging across the sections moves the command to the other scope. */
		it("moves a project command to the global list", async () => {
			mount();
			layOut();
			await drag(allRows()[1], 10);
			expect(get(globalCommands).map((c) => c.name)).toEqual([
				"deploy",
				"lint",
			]);
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual(["seed"]);
		});

		it("moves a global command to the project list", async () => {
			mount();
			layOut();
			await drag(allRows()[0], 290);
			expect(get(globalCommands)).toEqual([]);
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"deploy",
				"seed",
				"lint",
			]);
		});

		it("moves it to the position it was dropped at", async () => {
			mount();
			layOut();
			await drag(allRows()[0], 205);
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"lint",
				"deploy",
				"seed",
			]);
		});

		/** Dropping a row back where it started changes nothing. */
		it("leaves the order alone when dropped on itself", async () => {
			mount();
			layOut();
			await drag(allRows()[1], 210);
			expect(get(projectCommands).p1.map((c) => c.name)).toEqual([
				"deploy",
				"seed",
			]);
		});

		it("shows no drop line for a drop that changes nothing", async () => {
			mount();
			layOut();
			const row = allRows()[1];
			row.dispatchEvent(pointer("pointerdown", 0));
			await tickTwice();
			layOut();
			row.dispatchEvent(pointer("pointermove", 210));
			await tickTwice();
			expect(dropIndicators()).toHaveLength(0);
		});

		it("shows a drop line where the command would land", async () => {
			mount();
			layOut();
			const row = allRows()[1];
			row.dispatchEvent(pointer("pointerdown", 0));
			await tickTwice();
			layOut();
			row.dispatchEvent(pointer("pointermove", 290));
			await tickTwice();
			expect(dropIndicators()).toHaveLength(1);
		});

		it("clears the dragging cursor once dropped", async () => {
			mount();
			layOut();
			await drag(allRows()[1], 290);
			expect(document.body.classList.contains("dragging")).toBe(false);
		});

		/**
		 * The click the browser fires after the drop must not double as a
		 * selection opening the editor.
		 */
		it("does not open the editor on the click that follows a drag", async () => {
			mount();
			layOut();
			const row = allRows()[1];
			await drag(row, 290);
			row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await tickTwice();
			expect(editorOpen()).toBe(false);
		});

		/** That suppression lasts one click only; the next one still selects. */
		it("opens the editor on the next click after a drag", async () => {
			mount();
			layOut();
			const row = allRows()[1];
			await drag(row, 290);
			row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await tickTwice();
			allRows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await tickTwice();
			expect(editorOpen()).toBe(true);
		});

		/** A drag starting on a button is that button's press, not a drag. */
		it("ignores a drag started on a row action", async () => {
			mount();
			layOut();
			const button = actionIn(allRows()[1], /duplicat|dupliqu/i);
			button.dispatchEvent(pointer("pointerdown", 0));
			await tickTwice();
			layOut();
			allRows()[1].dispatchEvent(pointer("pointermove", 290));
			await tickTwice();
			expect(dropIndicators()).toHaveLength(0);
		});
	});

	describe("creating a command", () => {
		it("opens an empty editor", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".btn.primary") as HTMLElement,
			);
			expect(editorOpen()).toBe(true);
			expect(
				(document.querySelector(".ce-steps input") as HTMLInputElement).value,
			).toBe("");
		});

		it("cannot create one with no project open", () => {
			activeProjectId.set(null);
			mount();
			expect(
				(document.querySelector(".btn.primary") as HTMLButtonElement).disabled,
			).toBe(true);
		});
	});
});
