// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The history panel has its own suite; here it only needs to mount. */
vi.mock("$lib/components/agent/ConversationHistoryPanel.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));

const listCliProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listCliProviders: (...a: unknown[]) => listCliProviders(...a),
}));

const exitHandlers = vi.hoisted(
	() => new Set<(e: { id: string; exitCode: number | null }) => void>(),
);
/** Fires a PTY exit the way the terminal manager would. */
const fireExit = (id: string, exitCode: number | null) => {
	for (const h of exitHandlers) h({ id, exitCode });
};
const createTerminal = vi.fn<(...a: unknown[]) => unknown>();
const closeTerminal = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/terminal-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	createTerminal: (...a: unknown[]) => createTerminal(...a),
	closeTerminal: (...a: unknown[]) => closeTerminal(...a),
}));

vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	create: vi.fn(),
	dispose: vi.fn(),
	attach: vi.fn(),
	detach: vi.fn(),
	focus: vi.fn(),
	refit: vi.fn(),
	paste: vi.fn(),
	size: () => ({ cols: 80, rows: 24 }),
	observeInput: vi.fn(),
	observeOutput: vi.fn(),
	onTerminalExit: (h: (e: unknown) => void) => {
		exitHandlers.add(h);
		return () => exitHandlers.delete(h);
	},
}));

vi.mock("$lib/services/conversation-service", () => ({
	getConversationIndex: vi.fn().mockResolvedValue(null),
	saveConversationIndex: vi.fn().mockResolvedValue(undefined),
}));

const listInstances = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/instance-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listInstances,
}));

const { default: AgentView } = await import(
	"$lib/components/agent/AgentView.svelte"
);
const {
	activeConversationId,
	conversationTerminals,
	conversationsOf,
	instanceConversations,
	projectConversations,
} = await import("$lib/stores/conversation");
const { loadInstances } = await import("$lib/stores/instance");
const { projects, activeProjectId } = await import("$lib/stores/project");
const { instance, project } = await import("./fixtures");

/** One CLI installed, one not, so both card states are on screen. */
function providers() {
	return [
		{
			id: "claude-code",
			label: "Claude Code",
			hasLocalScope: true,
			installed: true,
			configured: true,
			path: "/usr/local/bin/claude",
			version: "2.0.0",
			resumable: true,
		},
		{
			id: "codex",
			label: "OpenAI Codex",
			hasLocalScope: false,
			installed: true,
			configured: true,
			path: "/usr/local/bin/codex",
			version: "1.0.0",
			resumable: true,
		},
		{
			// Uninstalled, but its config directory survived: the hub still writes
			// its skills there, and the picker must still refuse to launch it.
			id: "vibe",
			label: "Mistral Vibe",
			hasLocalScope: false,
			installed: false,
			configured: true,
			path: null,
			version: null,
			resumable: true,
		},
	];
}

async function mount() {
	const onGoProviders = vi.fn();
	const result = render(AgentView, { onGoProviders });
	// The picker waits on detection, and opening a conversation on a PTY.
	await tick();
	await tick();
	await tick();
	return { ...result, onGoProviders };
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".card"));
const cardNamed = (name: string) =>
	cards().find((c) => c.textContent?.includes(name)) as HTMLButtonElement;

beforeEach(async () => {
	vi.clearAllMocks();
	listCliProviders.mockResolvedValue(providers());
	exitHandlers.clear();
	createTerminal.mockResolvedValue(undefined);
	closeTerminal.mockResolvedValue(undefined);

	instanceConversations.set({});
	projectConversations.set({});
	activeConversationId.set({});
	conversationTerminals.set({});

	listInstances.mockResolvedValue([instance("i1", "p1")]);
	projects.set([{ ...project("p1"), activeInstanceId: "i1" }]);
	activeProjectId.set("p1");
	await loadInstances("p1");
});

describe("with no conversation open", () => {
	it("offers one card per CLI the registry knows", async () => {
		await mount();
		expect(cards()).toHaveLength(3);
	});

	it("puts the installed CLIs first and leaves the absent one unclickable", async () => {
		await mount();
		expect(cards().at(-1)?.textContent).toContain("Mistral Vibe");
		expect(cardNamed("Mistral Vibe").disabled).toBe(true);
		expect(cardNamed("Claude Code").disabled).toBe(false);
	});

	it("refuses a CLI the backend could not read a version from", async () => {
		// A launcher shim (VS Code drops one for Copilot on the PATH) is a file
		// that runs without being the CLI: the backend reports it as not
		// installed, and the tile must follow rather than offer a broken launch.
		listCliProviders.mockResolvedValue([
			{
				id: "copilot",
				label: "GitHub Copilot",
				hasLocalScope: false,
				installed: false,
				configured: true,
				path: null,
				version: null,
				resumable: true,
			},
		]);
		await mount();
		expect(cardNamed("GitHub Copilot").disabled).toBe(true);
	});

	it("refuses to offer a CLI whose config outlived its binary", async () => {
		await mount();
		// Clicking it would fail on the spawn, so it is never clickable.
		expect(cardNamed("Mistral Vibe").disabled).toBe(true);
		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("warns about no CLI, since every one of them resumes an exact conversation", async () => {
		await mount();
		// The caveat is gone with the behaviour it described: nothing here opens
		// "whatever ran last", so there is nothing to apologise for on a tile.
		for (const name of ["OpenAI Codex", "Claude Code"]) {
			expect(cardNamed(name).title).not.toMatch(/ran last|last session/i);
		}
	});

	it("keeps the tile to a logo and a name, and the detail in the tooltip", async () => {
		await mount();
		const tile = cardNamed("Claude Code");
		expect(tile.textContent?.trim()).toBe("Claude Code");
		expect(tile.title).toContain("2.0.0");
		expect(tile.title).toContain("/usr/local/bin/claude");
	});

	it("leads to the hub when a CLI is missing", async () => {
		const { onGoProviders } = await mount();
		await userEvent.click(
			screen.getByRole("button", { name: /installed CLIs/i }),
		);
		expect(onGoProviders).toHaveBeenCalled();
	});
});

describe("starting a conversation", () => {
	it("launches the picked CLI in the instance worktree", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		const call = createTerminal.mock.lastCall as unknown[];
		expect(call[1]).toBe("/worktrees/p1/i1");
		// A minted id, so the resume later is exact rather than "the last one here".
		expect(call[6]).toEqual([
			"claude",
			"--session-id",
			expect.stringMatching(/^[0-9a-f-]{36}$/),
		]);
	});

	it("records the conversation and shows its terminal", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		const list = conversationsOf({
			projectId: "p1",
			instanceId: "i1",
			scope: "instance",
		});
		expect(list).toHaveLength(1);
		expect(list[0].cli).toBe("claude-code");
		expect(get(conversationTerminals)[list[0].id]).toBe(
			`conversation:${list[0].id}`,
		);
		expect(document.querySelector(".term-slot")).not.toBeNull();
	});

	it("heads the view with the CLI's logo and the conversation title", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		const bar = document.querySelector(".conv-bar");
		expect(bar?.querySelector(".conv-mark svg")).not.toBeNull();
		expect(bar?.querySelector(".conv-title")).not.toBeNull();
		// The worktree path is on the tile's tooltip and the Providers page; a
		// header is not the place to spend a line on it.
		expect(bar?.textContent).not.toContain("/worktrees/p1/i1");
	});

	it("offers no model, effort or permission setting: those belong to the CLI", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		const bar = document.querySelector(".conv-bar");
		expect(bar?.querySelectorAll("select")).toHaveLength(0);
		expect(bar?.textContent).not.toMatch(/permission|effort|model/i);
	});
});

describe("detecting the CLIs", () => {
	it("uses the cached registry when the picker opens", async () => {
		await mount();
		expect(listCliProviders).toHaveBeenCalledTimes(1);
		expect(listCliProviders).toHaveBeenCalledWith(false);
	});

	it("probes again only when asked", async () => {
		await mount();
		listCliProviders.mockClear();

		await userEvent.click(
			screen.getByRole("button", { name: /detect again/i }),
		);

		expect(listCliProviders).toHaveBeenCalledWith(true);
	});

	it("archives with its own icon, not the folder one", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		const button = screen.getByRole("button", { name: /archive/i });
		expect(button.querySelector(".ic-archive")).not.toBeNull();
	});
});

describe("renaming from the header", () => {
	it("updates the header itself, not only the list", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		await userEvent.click(document.querySelector(".conv-title") as HTMLElement);
		await tick();
		const input = document.querySelector(".conv-rename") as HTMLInputElement;
		await userEvent.clear(input);
		await userEvent.type(input, "renamed here");
		await userEvent.keyboard("{Enter}");
		await tick();

		expect(document.querySelector(".conv-title")?.textContent?.trim()).toBe(
			"renamed here",
		);
	});
});

describe("archiving a conversation", () => {
	it("puts it away, stops its CLI, and keeps it resumable", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		await userEvent.click(screen.getByRole("button", { name: /archive/i }));
		await tick();

		const ref = {
			projectId: "p1",
			instanceId: "i1",
			scope: "instance" as const,
		};
		// The entry survives, marked archived: archiving files a conversation
		// away, it does not throw it out.
		expect(conversationsOf(ref)).toHaveLength(1);
		expect(conversationsOf(ref)[0].archived).toBe(true);
		// Leaving a process running behind an archived conversation would be a
		// surprise; reopening resumes it from where it stopped.
		expect(closeTerminal).toHaveBeenCalled();
	});

	it("archives from the exited banner without leaving a process behind", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();
		const ref = {
			projectId: "p1",
			instanceId: "i1",
			scope: "instance" as const,
		};
		fireExit(`conversation:${conversationsOf(ref)[0].id}`, 1);
		await tick();

		const banner = document.querySelector(".conv-exited") as HTMLElement;
		const archive = Array.from(banner.querySelectorAll("button")).find((b) =>
			/archive/i.test(b.textContent ?? ""),
		) as HTMLButtonElement;
		await userEvent.click(archive);
		await tick();

		expect(conversationsOf(ref)[0].archived).toBe(true);
		expect(closeTerminal).toHaveBeenCalled();
	});

	it("leaves the view on the picker rather than on an archived conversation", async () => {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();

		await userEvent.click(screen.getByRole("button", { name: /archive/i }));
		await tick();

		expect(document.querySelector(".conv-bar")).toBeNull();
		expect(document.querySelector(".picker")).not.toBeNull();
	});
});

describe("when the CLI exits", () => {
	/** Opens a conversation and returns the terminal id its PTY would carry. */
	async function openOne() {
		await mount();
		await userEvent.click(cardNamed("Claude Code"));
		await tick();
		const ref = {
			projectId: "p1",
			instanceId: "i1",
			scope: "instance" as const,
		};
		return `conversation:${conversationsOf(ref)[0].id}`;
	}

	it("says nothing while the CLI is running", async () => {
		await openOne();
		expect(document.querySelector(".conv-exited")).toBeNull();
	});

	// The terminal stays on screen: its last output is what explains the exit.
	it("offers a way out once the process is gone, keeping the terminal", async () => {
		const tid = await openOne();
		fireExit(tid, 3);
		await tick();

		const banner = document.querySelector(".conv-exited");
		expect(banner).not.toBeNull();
		expect(banner?.textContent).toContain("3");
		expect(document.querySelector(".term-slot")).not.toBeNull();
	});

	it("reads a signal kill as an exit without a code", async () => {
		const tid = await openOne();
		fireExit(tid, null);
		await tick();
		expect(document.querySelector(".conv-exited")?.textContent).not.toContain(
			"null",
		);
	});

	it("ignores the exit of another conversation's CLI", async () => {
		await openOne();
		fireExit("conversation:someone-else", 1);
		await tick();
		expect(document.querySelector(".conv-exited")).toBeNull();
	});

	it("relaunches the CLI from the banner", async () => {
		const tid = await openOne();
		fireExit(tid, 1);
		await tick();
		createTerminal.mockClear();

		const banner = document.querySelector(".conv-exited") as HTMLElement;
		const restart = banner.querySelector("button") as HTMLButtonElement;
		await userEvent.click(restart);
		await tick();

		// Killed then spawned again: openConversation returns early while a
		// terminal is still registered.
		expect(closeTerminal).toHaveBeenCalled();
		expect(createTerminal).toHaveBeenCalled();
		expect(document.querySelector(".conv-exited")).toBeNull();
	});

	it("reloads from the header while the CLI is still running", async () => {
		await openOne();
		createTerminal.mockClear();
		await userEvent.click(screen.getByRole("button", { name: /reload/i }));
		await tick();
		expect(createTerminal).toHaveBeenCalled();
	});
});
