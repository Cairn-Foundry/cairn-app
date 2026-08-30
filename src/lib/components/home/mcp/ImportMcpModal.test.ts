import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importMcpServers = vi.fn();
vi.mock("$lib/services/mcp-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	importMcpServers: (...args: unknown[]) => importMcpServers(...args),
}));
vi.mock("$lib/stores/cli-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadCliProviders: vi.fn().mockResolvedValue(undefined),
}));

const { cliProviders } = await import("$lib/stores/cli-providers");
const { projects } = await import("$lib/stores/project");
const { project } = await import("../../../../test/fixtures");
const { default: ImportMcpModal } = await import("./ImportMcpModal.svelte");

function mount() {
	const onImported = vi.fn();
	const onClose = vi.fn();
	const result = render(ImportMcpModal, {
		props: {},
		events: {
			imported: (e: CustomEvent) => onImported(e.detail),
			close: () => onClose(),
		},
	});
	return { ...result, onImported, onClose };
}

const json = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const confirm = () =>
	document.querySelector(".btn.primary") as HTMLButtonElement;
const banner = () => document.querySelector(".banner.bad")?.textContent;
const selects = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".select-trigger"));

/**
 * Picks an option out of the nth Select by its position in the list. All three
 * scope labels read "... project ...", so a name match is ambiguous; the order
 * is the one the component declares: user, local, project.
 */
async function pick(selectIndex: number, optionIndex: number) {
	await userEvent.click(selects()[selectIndex]);
	await userEvent.click(screen.getAllByRole("option")[optionIndex]);
}

const SCOPE = { user: 0, local: 1, project: 2 } as const;

const VALID = '{"mcpServers":{"a":{"command":"npx"}}}';

/** Pasted rather than typed: userEvent.type reads "{" as a key descriptor. */
async function paste(text: string) {
	json().focus();
	await userEvent.paste(text);
}

beforeEach(() => {
	importMcpServers.mockReset();
	importMcpServers.mockResolvedValue(["a"]);
	cliProviders.set([
		{
			id: "claude-code",
			label: "claude-code",
			hasLocalScope: true,
			installed: true,
			configured: true,
			path: null,
			version: null,
			resumable: true,
		},
		{
			id: "codex",
			label: "codex",
			hasLocalScope: false,
			installed: true,
			configured: true,
			path: null,
			version: null,
			resumable: true,
		},
	]);
	projects.set([project("p1"), project("p2")]);
});

describe("ImportMcpModal", () => {
	describe("before anything can be imported", () => {
		it("refuses an empty paste", () => {
			mount();
			expect(confirm().disabled).toBe(true);
		});

		it("refuses a paste of whitespace only", async () => {
			mount();
			await paste("   ");
			expect(confirm().disabled).toBe(true);
		});

		it("accepts once something is pasted", async () => {
			mount();
			await paste(VALID);
			expect(confirm().disabled).toBe(false);
		});

		/** Importing for nobody would write nothing anywhere. */
		it("refuses when no agent is targeted", async () => {
			mount();
			await paste(VALID);
			await userEvent.click(document.querySelector(".target") as HTMLElement);
			expect(confirm().disabled).toBe(true);
		});
	});

	describe("the scope it imports into", () => {
		it("offers only the user scope when no project is registered", async () => {
			projects.set([]);
			mount();
			await userEvent.click(selects()[0]);
			expect(screen.getAllByRole("option")).toHaveLength(1);
		});

		it("offers the project scopes once a project exists", async () => {
			mount();
			await userEvent.click(selects()[0]);
			expect(screen.getAllByRole("option")).toHaveLength(3);
		});

		it("asks for no project in the user scope", () => {
			mount();
			expect(selects()).toHaveLength(1);
		});

		it("asks which project once the scope is not the user one", async () => {
			mount();
			await pick(0, SCOPE.project);
			expect(selects()).toHaveLength(2);
		});

		/** A user-scope import belongs to no project, so it carries no path. */
		it("sends no project and no path for a user import", async () => {
			mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(importMcpServers).toHaveBeenCalledWith(
				"user",
				"",
				"",
				["claude-code"],
				VALID,
			);
		});

		it("sends the project and its path for a project import", async () => {
			mount();
			await paste(VALID);
			await pick(0, SCOPE.project);
			await userEvent.click(confirm());
			expect(importMcpServers).toHaveBeenCalledWith(
				"project",
				"p1",
				"/repos/p1",
				["claude-code"],
				VALID,
			);
		});

		it("sends the project the user chose, not the first one", async () => {
			mount();
			await paste(VALID);
			await pick(0, SCOPE.project);
			await pick(1, 1);
			await userEvent.click(confirm());
			expect(importMcpServers).toHaveBeenCalledWith(
				"project",
				"p2",
				"/repos/p2",
				["claude-code"],
				VALID,
			);
		});

		/**
		 * Only Claude Code keeps a per-project private list, so the local scope
		 * offers no one else - stated as a reason on the tile, not by hiding it.
		 */
		it("refuses the agents with no local list once the scope is local", async () => {
			mount();
			await pick(0, SCOPE.local);
			const codex = Array.from(
				document.querySelectorAll<HTMLElement>(".target"),
			).find((t) => t.querySelector(".name")?.textContent === "codex");
			expect(codex?.getAttribute("aria-disabled")).toBe("true");
		});

		it("leaves every agent available in the user scope", () => {
			mount();
			const disabled = Array.from(
				document.querySelectorAll<HTMLElement>(".target"),
			).filter((t) => t.getAttribute("aria-disabled") === "true");
			expect(disabled).toHaveLength(0);
		});
	});

	describe("importing", () => {
		it("reports the servers that were created", async () => {
			importMcpServers.mockResolvedValue(["one", "two"]);
			const { onImported } = mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(onImported).toHaveBeenCalledWith(["one", "two"]);
		});

		it("shows a spinner rather than a word while it works", async () => {
			let settle: (value: string[]) => void = () => {};
			importMcpServers.mockReturnValue(
				new Promise<string[]>((resolve) => {
					settle = resolve;
				}),
			);
			mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(confirm().querySelector(".spinner")).not.toBeNull();
			expect(confirm().disabled).toBe(true);
			settle([]);
		});

		/** A malformed paste is the expected case, not an exception to hide. */
		it("reports a refused paste instead of closing", async () => {
			importMcpServers.mockRejectedValue(new Error("not valid JSON"));
			const { onImported, onClose } = mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(banner()).toContain("not valid JSON");
			expect(onImported).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it("lets the paste be corrected and tried again", async () => {
			importMcpServers.mockRejectedValueOnce(new Error("bad"));
			const { onImported } = mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(banner()).toBeTruthy();

			importMcpServers.mockResolvedValue(["a"]);
			await userEvent.click(confirm());
			expect(banner()).toBeUndefined();
			expect(onImported).toHaveBeenCalledWith(["a"]);
		});

		it("becomes usable again after a failure", async () => {
			importMcpServers.mockRejectedValue(new Error("bad"));
			mount();
			await paste(VALID);
			await userEvent.click(confirm());
			expect(confirm().disabled).toBe(false);
		});
	});

	describe("giving up", () => {
		it("closes on cancel without importing", async () => {
			const { onClose } = mount();
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(onClose).toHaveBeenCalled();
			expect(importMcpServers).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			const { onClose } = mount();
			await userEvent.type(screen.getByRole("dialog"), "{Escape}");
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside the form", async () => {
			const { onClose } = mount();
			await userEvent.click(json());
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
