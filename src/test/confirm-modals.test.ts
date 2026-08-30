import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeleteConversationModal from "$lib/components/agent/DeleteConversationModal.svelte";
import CommandConfirmDialog from "$lib/components/commands/CommandConfirmDialog.svelte";
import DeleteAgentModal from "$lib/components/home/agents/DeleteAgentModal.svelte";
import DeleteFolderModal from "$lib/components/home/DeleteFolderModal.svelte";
import DeleteInstanceModal from "$lib/components/home/DeleteInstanceModal.svelte";
import DeleteProjectModal from "$lib/components/home/DeleteProjectModal.svelte";
import DeleteMcpModal from "$lib/components/home/mcp/DeleteMcpModal.svelte";
import RemoveCustomServerModal from "$lib/components/home/RemoveCustomServerModal.svelte";
import DeleteSkillModal from "$lib/components/home/skills/DeleteSkillModal.svelte";
import UninstallServerModal from "$lib/components/home/UninstallServerModal.svelte";
import type { CustomCommand } from "$lib/services/custom-command-service";
import type { LanguageServerInfo } from "$lib/services/lsp-service";

function languageServer(
	name: string,
	overrides: Partial<LanguageServerInfo> = {},
): LanguageServerInfo {
	return {
		id: name,
		name,
		binary: name,
		args: [],
		extensions: [".ts"],
		languageIds: ["typescript"],
		rootMarkers: [],
		custom: true,
		installOptions: [],
		uninstallOptions: [
			{ manager: "npm", command: `npm rm -g ${name}`, available: true },
		],
		updateOptions: [],
		alsoRemoves: [],
		docUrl: "",
		binaryPath: null,
		version: null,
		status: "installed",
		runningRoot: null,
		...overrides,
	} as LanguageServerInfo;
}

import type { ProjectFolder } from "$lib/types/project";
import { instance, project } from "./fixtures";

/**
 * The confirmation modals share one contract: they ask before a destructive
 * action, they never act on their own, and they can be dismissed four ways.
 * Testing them together states that contract once, and a new modal only has to
 * be added to this list to inherit it.
 */
interface ModalCase {
	name: string;
	/** Mounts the modal and returns the two spies its contract is about. */
	mount: () => {
		onConfirm: ReturnType<typeof vi.fn>;
		onClose: ReturnType<typeof vi.fn>;
	};
	/** Something the modal must name, so the user knows what they are acting on. */
	names: string;
}

const CASES: ModalCase[] = [
	{
		name: "DeleteFolderModal",
		names: "my folder",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteFolderModal, {
				props: {
					folder: { id: "f1", name: "my folder" } as ProjectFolder,
				},
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteInstanceModal",
		names: "my-instance",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteInstanceModal, {
				props: { instance: instance("my-instance", "p1") },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteProjectModal",
		names: "my-project",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteProjectModal, {
				props: { project: project("my-project") },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteAgentModal",
		names: "argus",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteAgentModal, {
				props: { name: "argus" },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteMcpModal",
		names: "my-server",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteMcpModal, {
				props: { name: "my-server", sourcePath: "/repo/.mcp.json" },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteSkillModal",
		names: "my-skill",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteSkillModal, {
				props: { name: "my-skill", path: "/repo/.claude/skills/my-skill" },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "CommandConfirmDialog",
		names: "deploy",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(CommandConfirmDialog, {
				props: {
					command: {
						id: "c1",
						name: "deploy",
						icon: "play",
						steps: ["./deploy.sh"],
						stopOnError: true,
						cwd: "worktree",
						pinned: false,
						autoClose: false,
						confirm: true,
					} as CustomCommand,
				},
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "RemoveCustomServerModal",
		names: "my-lsp",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(RemoveCustomServerModal, {
				props: { server: languageServer("my-lsp") },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "UninstallServerModal",
		names: "my-lsp",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(UninstallServerModal, {
				props: { server: languageServer("my-lsp"), manager: "npm" },
				events: { confirm: () => onConfirm(), close: () => onClose() },
			});
			return { onConfirm, onClose };
		},
	},
	{
		name: "DeleteConversationModal",
		names: "my conversation",
		mount: () => {
			const onConfirm = vi.fn();
			const onClose = vi.fn();
			render(DeleteConversationModal, {
				title: "my conversation",
				onClose,
				onConfirm,
			});
			return { onConfirm, onClose };
		},
	},
];

const dialog = () => screen.getByRole("dialog");
const confirmButton = () =>
	document.querySelector(".modal-foot .btn:last-child") as HTMLElement;
const cancelButton = () =>
	document.querySelector(".modal-foot .btn.ghost") as HTMLElement;
const closeButton = () =>
	document.querySelector(".icon-btn.close") as HTMLElement;
const body = () => document.querySelector(".modal") as HTMLElement;

describe.each(CASES)("$name", ({ mount, names }) => {
	it("names what is about to be acted on", () => {
		mount();
		expect(body().textContent).toContain(names);
	});

	it("does nothing until it is confirmed", () => {
		const { onConfirm, onClose } = mount();
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("confirms once, on the confirming button", async () => {
		const { onConfirm } = mount();
		await userEvent.click(confirmButton());
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("cancels without acting", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.click(cancelButton());
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("closes without acting", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.click(closeButton());
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	/**
	 * Dispatched rather than typed: `userEvent.type` clicks the element first,
	 * and a click on the backdrop already closes the modal - so the keystroke
	 * would appear to work even with no key handler at all.
	 */
	it("closes on Escape without acting", () => {
		const { onConfirm, onClose } = mount();
		dialog().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("closes on a click on the backdrop, without acting", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.click(dialog());
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	/** A click inside the form is not a click away from it. */
	it("stays open on a click inside itself", async () => {
		const { onClose } = mount();
		await userEvent.click(body());
		expect(onClose).not.toHaveBeenCalled();
	});

	it("announces itself as a dialog", () => {
		mount();
		expect(dialog().getAttribute("aria-modal")).toBe("true");
	});

	it("names its close button for a screen reader", () => {
		mount();
		expect(closeButton().getAttribute("aria-label")).toBeTruthy();
	});
});

describe("what each modal says beyond the shared contract", () => {
	it("DeleteMcpModal names the file the server is declared in", () => {
		render(DeleteMcpModal, {
			props: { name: "my-server", sourcePath: "/repo/.mcp.json" },
		});
		expect(body().textContent).toContain("/repo/.mcp.json");
	});

	it("DeleteSkillModal names the folder that will be removed", () => {
		render(DeleteSkillModal, {
			props: { name: "my-skill", path: "/repo/.claude/skills/my-skill" },
		});
		expect(body().textContent).toContain("/repo/.claude/skills/my-skill");
	});

	/**
	 * What is actually lost is the entry, not the transcript: that belongs to the
	 * CLI and stays where it is. Saying so is what makes the choice informed.
	 */
	it("DeleteConversationModal says the CLI keeps what it recorded", () => {
		render(DeleteConversationModal, {
			title: "my conversation",
			onClose: vi.fn(),
			onConfirm: vi.fn(),
		});
		expect(body().textContent).toMatch(/my conversation/);
		expect(body().textContent).toMatch(/CLI/);
	});

	/** The instance is named by its ticket, which is how the user knows it. */
	it("DeleteInstanceModal names the instance by its ticket title", () => {
		render(DeleteInstanceModal, {
			props: {
				instance: instance("i1", "p1", {
					ticket: { id: "PROJ-42", title: "Fix the login" },
				}),
			},
		});
		expect(body().textContent).toContain("Fix the login");
	});

	it("DeleteProjectModal names the path of the project", () => {
		render(DeleteProjectModal, { props: { project: project("my-project") } });
		expect(body().textContent).toContain("/repos/my-project");
	});

	/** What the command will actually run is what makes the choice informed. */
	it("CommandConfirmDialog shows the steps the command will run", () => {
		render(CommandConfirmDialog, {
			props: {
				command: {
					id: "c1",
					name: "deploy",
					icon: "play",
					steps: ["npm ci", "./deploy.sh prod"],
					stopOnError: true,
					cwd: "worktree",
					pinned: false,
					autoClose: false,
					confirm: true,
				} as CustomCommand,
			},
		});
		expect(body().textContent).toContain("./deploy.sh prod");
	});

	/** Uninstalling goes through a package manager; which one is worth saying. */
	/** The exact command that will run is what makes the choice informed. */
	it("UninstallServerModal shows the command it will run", () => {
		render(UninstallServerModal, {
			props: {
				server: languageServer("my-lsp", {
					uninstallOptions: [
						{
							manager: "homebrew",
							command: "brew uninstall my-lsp",
							available: true,
						},
					],
				}),
				manager: "homebrew",
			},
		});
		expect(body().textContent).toContain("brew uninstall my-lsp");
	});

	/** A manager with no command of its own must not show a stale one. */
	it("UninstallServerModal shows no command for an unknown manager", () => {
		render(UninstallServerModal, {
			props: { server: languageServer("my-lsp"), manager: "nothing" },
		});
		expect(body().textContent).not.toContain("npm rm -g");
	});
});
