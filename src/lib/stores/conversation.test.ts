// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeConversationId,
	type ConversationRef,
	closeConversation,
	conversationHosts,
	conversationRuns,
	conversationsOf,
	conversationTerminals,
	deleteConversation,
	findConversation,
	forgetProject,
	instanceConversations,
	moveConversationToScope,
	noteTerminalInput,
	openConversation,
	projectConversations,
	removeInstanceConversations,
	renameConversation,
	restoreConversations,
	runOf,
	selectConversation,
	startConversation,
	startFreshSession,
	terminalOf,
	toggleArchived,
	togglePinned,
} from "./conversation";
import { lastCli } from "./ui";

const saveConversationIndex = vi.fn().mockResolvedValue(undefined);
const getConversationIndex = vi.fn().mockResolvedValue(null);

vi.mock("$lib/services/conversation-service", () => ({
	getConversationIndex: (...a: unknown[]) => getConversationIndex(...a),
	saveConversationIndex: (...a: unknown[]) => saveConversationIndex(...a),
}));

const createTerminal = vi.fn().mockResolvedValue(undefined);
const closeTerminal = vi.fn().mockResolvedValue(undefined);
const terminalHasChildren = vi.fn().mockResolvedValue(false);

vi.mock("$lib/services/terminal-service", () => ({
	createTerminal: (...a: unknown[]) => createTerminal(...a),
	closeTerminal: (...a: unknown[]) => closeTerminal(...a),
	terminalHasChildren: (...a: unknown[]) => terminalHasChildren(...a),
}));

const discoverCliSession = vi.fn().mockResolvedValue(null);
const cliSessionExists = vi.fn().mockResolvedValue(false);
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	discoverCliSession: (...a: unknown[]) => discoverCliSession(...a),
	cliSessionExists: (...a: unknown[]) => cliSessionExists(...a),
}));

const exitHandlers = vi.hoisted(
	() => new Set<(e: { id: string; exitCode: number | null }) => void>(),
);
const emitExit = (id: string, exitCode: number | null) => {
	for (const h of [...exitHandlers]) h({ id, exitCode });
};

const inputObservers = vi.hoisted(
	() => [] as Array<(terminalId: string, data: string) => void>,
);

vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	create: vi.fn(),
	dispose: vi.fn(),
	size: () => ({ cols: 80, rows: 24 }),
	observeInput: (h: (terminalId: string, data: string) => void) => {
		inputObservers.push(h);
	},
	observeOutput: vi.fn(),
	onTerminalExit: (h: (e: { id: string; exitCode: number | null }) => void) => {
		exitHandlers.add(h);
		return () => exitHandlers.delete(h);
	},
}));

const ref: ConversationRef = {
	projectId: "p",
	instanceId: "i",
	scope: "instance",
};

/** The argv `terminal_create` was last called with, without the status hooks. */
function lastArgv(): string[] {
	const argv = createTerminal.mock.lastCall?.[6] as string[];
	const at = argv.indexOf("--settings");
	return at === -1 ? argv : argv.filter((_, i) => i !== at && i !== at + 1);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	exitHandlers.clear();
	discoverCliSession.mockResolvedValue(null);
	terminalHasChildren.mockResolvedValue(false);
	instanceConversations.set({});
	projectConversations.set({});
	activeConversationId.set({});
	conversationTerminals.set({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("starting a conversation", () => {
	it("mints a session id for a CLI that accepts one, and launches with it", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		expect(meta.sessionId).toMatch(/^[0-9a-f-]{36}$/);
		expect(lastArgv()).toEqual(["claude", "--session-id", meta.sessionId]);
		expect(createTerminal.mock.lastCall?.[1]).toBe("/repo/wt");
	});

	it("launches Claude Code with the hooks that report its turn", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");

		const argv = createTerminal.mock.lastCall?.[6] as string[];
		const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]);
		expect(Object.keys(settings.hooks)).toEqual(
			expect.arrayContaining(["UserPromptSubmit", "Notification", "Stop"]),
		);
	});

	it("records where a running conversation was launched from, until it is closed", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		expect(get(conversationHosts)[meta.id]).toEqual({
			projectId: "p",
			instanceId: "i",
		});

		closeConversation(meta.id);
		expect(get(conversationHosts)[meta.id]).toBeUndefined();
	});

	it("leaves no session id for a CLI that mints its own, and launches it bare", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");

		expect(meta.sessionId).toBeNull();
		expect(lastArgv()).toEqual(["codex"]);
	});

	it("opens the new conversation and records its terminal", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		const { get } = await import("svelte/store");
		expect(get(activeConversationId)["p:i"]).toBe(meta.id);
		expect(get(conversationTerminals)[meta.id]).toBe(`conversation:${meta.id}`);
	});
});

describe("reopening a conversation", () => {
	it("resumes by id once the session has been seen on disk", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--resume", meta.sessionId]);
	});

	it("relaunches under the minted id while the session is unconfirmed", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--session-id", meta.sessionId]);
	});

	it("resumes a written session the discovery poll never confirmed", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		createTerminal.mockClear();
		cliSessionExists.mockResolvedValueOnce(true);

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--resume", meta.sessionId]);
	});

	it("does not reorder the list when a running conversation is shown", async () => {
		const older = await startConversation(ref, "claude-code", "/repo/wt");
		await vi.advanceTimersByTimeAsync(1_000);
		const newer = await startConversation(ref, "claude-code", "/repo/wt");
		const openedAt = (id: string) =>
			conversationsOf(ref).find((c) => c.id === id)?.lastOpenedAt;
		const before = openedAt(older.id);

		await vi.advanceTimersByTimeAsync(1_000);
		await openConversation(ref, older.id);

		expect(openedAt(older.id)).toBe(before);
		expect(newer.id).toBeTruthy();
	});

	it("starts fresh when the minted session was never written to", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).not.toContain("--resume");
	});

	it("reopens the exact conversation for a CLI that minted its own id", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce("01HXYZ");
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["codex", "resume", "01HXYZ"]);
	});

	it("falls back to a fresh session when a resume is refused", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);
		expect(lastArgv()).toEqual(["claude", "--resume", meta.sessionId]);

		createTerminal.mockClear();
		emitExit(`conversation:${meta.id}`, 1);
		await vi.advanceTimersByTimeAsync(100);

		expect(lastArgv()).toEqual(["claude"]);
		expect(conversationsOf(ref).find((c) => c.id === meta.id)?.sessionId).toBe(
			null,
		);
	});

	it("leaves a session the user quit alone", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);
		createTerminal.mockClear();
		await vi.advanceTimersByTimeAsync(30_000);
		emitExit(`conversation:${meta.id}`, 0);
		await vi.advanceTimersByTimeAsync(100);

		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("starts fresh rather than opening someone else's session when no id was learned", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["codex"]);
	});

	it("does not relaunch a CLI that is already running", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("keeps the entry when the CLI is closed, so it can be resumed later", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		closeConversation(meta.id);

		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${meta.id}`);
		expect(conversationsOf(ref).map((c) => c.id)).toEqual([meta.id]);
	});
});

describe("recovering a conversation whose session is gone", () => {
	it("opens a new session instead of resuming the one the CLI lost", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();
		await openConversation(ref, meta.id);
		expect(lastArgv()).toContain("--resume");
		createTerminal.mockClear();

		await startFreshSession(ref, meta.id);

		expect(lastArgv()).not.toContain("--resume");
		expect(lastArgv()).toContain("--session-id");
		const after = conversationsOf(ref).find((c) => c.id === meta.id);
		expect(after?.sessionId).not.toBe(meta.sessionId);
		expect(after?.sessionStarted).toBe(false);
		expect(after?.sessionConfirmed).toBe(false);
	});

	it("keeps the conversation, its title and its worktree", async () => {
		const meta = await startConversation(
			ref,
			"claude-code",
			"/repo/wt",
			"Ticket 42",
		);
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");

		await startFreshSession(ref, meta.id);

		const after = conversationsOf(ref).find((c) => c.id === meta.id);
		expect(after?.title).toBe("Ticket 42");
		expect(after?.cwd).toBe("/repo/wt");
		expect(conversationsOf(ref)).toHaveLength(1);
	});
});

describe("learning the id of a CLI that mints its own", () => {
	it("asks the CLI and records what it answers", async () => {
		discoverCliSession.mockResolvedValue("ses_abc");

		await startConversation(ref, "opencode", "/repo/wt");
		await vi.advanceTimersByTimeAsync(2_000);

		expect(discoverCliSession).toHaveBeenCalledWith(
			"opencode",
			"/repo/wt",
			expect.any(Number),
		);
		expect(conversationsOf(ref)[0].sessionId).toBe("ses_abc");
	});

	it("keeps asking while the CLI has no session yet", async () => {
		discoverCliSession.mockResolvedValue(null);
		terminalHasChildren.mockResolvedValue(false);

		await startConversation(ref, "opencode", "/repo/wt");
		await vi.advanceTimersByTimeAsync(10_000);

		expect(discoverCliSession.mock.calls.length).toBeGreaterThan(1);
		expect(conversationsOf(ref)[0].sessionId).toBeNull();
	});

	it("asks for a CLI handed an id at launch, until the session is seen", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		await vi.advanceTimersByTimeAsync(10_000);

		expect(discoverCliSession).toHaveBeenCalledWith(
			"claude-code",
			"/repo/wt",
			expect.any(Number),
		);
	});

	it("adopts the id the CLI actually used over the one it was handed", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce("cli-chosen-id");
		await vi.advanceTimersByTimeAsync(2_000);

		expect(conversationsOf(ref).find((c) => c.id === meta.id)?.sessionId).toBe(
			"cli-chosen-id",
		);
	});

	it("stops asking once the conversation is closed", async () => {
		discoverCliSession.mockResolvedValue(null);
		terminalHasChildren.mockResolvedValue(false);
		const meta = await startConversation(ref, "opencode", "/repo/wt");
		await vi.advanceTimersByTimeAsync(2_000);
		const before = discoverCliSession.mock.calls.length;

		closeConversation(meta.id);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(discoverCliSession.mock.calls.length).toBe(before);
	});
});

describe("a CLI is only ever stopped on request", () => {
	it("leaves a conversation running once it is no longer on screen", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		selectConversation("p", "i", null);

		await vi.advanceTimersByTimeAsync(30 * 60_000);

		expect(closeTerminal).not.toHaveBeenCalled();
		expect(get(conversationTerminals)[meta.id]).toBe(`conversation:${meta.id}`);
	});

	it("stops it when the user asks, and keeps the entry", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		closeConversation(meta.id);

		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${meta.id}`);
		expect(conversationsOf(ref)).toHaveLength(1);
	});
});

describe("naming a conversation from its first prompt", () => {
	it("takes the first line typed, and nothing after it", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		const terminalId = `conversation:${meta.id}`;

		noteTerminalInput(terminalId, "fix the ");
		noteTerminalInput(terminalId, "parser\r");
		noteTerminalInput(terminalId, "and the lexer\r");

		expect(conversationsOf(ref)[0].title).toBe("Fix the parser");
	});

	it("never renames a conversation that already has a title", async () => {
		const meta = await startConversation(
			ref,
			"claude-code",
			"/repo/wt",
			"Given name",
		);

		noteTerminalInput(`conversation:${meta.id}`, "something else\r");

		expect(conversationsOf(ref)[0].title).toBe("Given name");
	});

	it("stops listening once the user renames it by hand", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		renameConversation(ref, meta.id, "Chosen");
		noteTerminalInput(`conversation:${meta.id}`, "a prompt\r");

		expect(conversationsOf(ref)[0].title).toBe("Chosen");
	});
});

describe("scopes", () => {
	it("moves an entry between scopes without restarting its CLI", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		moveConversationToScope(ref, meta.id);

		expect(conversationsOf(ref)).toHaveLength(0);
		expect(
			conversationsOf({ ...ref, scope: "project" }).map((c) => c.id),
		).toEqual([meta.id]);
		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("kills the CLI when the conversation is deleted", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		deleteConversation(ref, meta.id);

		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${meta.id}`);
		expect(conversationsOf(ref)).toHaveLength(0);
	});
});

describe("restoring from disk", () => {
	it("drops entries left by the transcript-era app, which nothing can relaunch", async () => {
		getConversationIndex.mockResolvedValueOnce({
			conversations: [
				{ id: "old", title: "Legacy", cli: "" },
				{ id: "new", title: "Current", cli: "claude-code" },
			],
			activeId: "old",
		});

		await restoreConversations("p", "i");

		expect(conversationsOf(ref).map((c) => c.id)).toEqual(["new"]);
	});
});

const projectRef: ConversationRef = { ...ref, scope: "project" };

describe("finding a conversation", () => {
	it("finds it in the instance scope first", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		const found = findConversation("p", "i", meta.id);

		expect(found?.ref).toEqual(ref);
		expect(found?.meta.id).toBe(meta.id);
	});

	it("falls back to the project scope", async () => {
		const meta = await startConversation(projectRef, "claude-code", "/repo/wt");

		const found = findConversation("p", "i", meta.id);

		expect(found?.ref).toEqual(projectRef);
		expect(found?.meta.id).toBe(meta.id);
	});

	it("returns null for an id in neither scope", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");

		expect(findConversation("p", "i", "missing")).toBeNull();
	});
});

describe("pinning and archiving", () => {
	it("toggles the pin of a conversation", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		togglePinned(ref, meta.id);
		expect(conversationsOf(ref)[0].pinned).toBe(true);

		togglePinned(ref, meta.id);
		expect(conversationsOf(ref)[0].pinned).toBe(false);
	});

	it("leaves the list alone when pinning an unknown id", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		const before = conversationsOf(ref);

		togglePinned(ref, "missing");

		expect(conversationsOf(ref)).toEqual(before);
	});

	it("toggles the archive flag of a conversation", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		toggleArchived(ref, meta.id);
		expect(conversationsOf(ref)[0].archived).toBe(true);

		toggleArchived(ref, meta.id);
		expect(conversationsOf(ref)[0].archived).toBe(false);
	});

	it("leaves the list alone when archiving an unknown id", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		const before = conversationsOf(ref);

		toggleArchived(ref, "missing");

		expect(conversationsOf(ref)).toEqual(before);
	});
});

describe("persisting the index", () => {
	it("writes the project scope without an instance or an active conversation", async () => {
		const meta = await startConversation(projectRef, "claude-code", "/repo/wt");

		await vi.advanceTimersByTimeAsync(250);

		const projectWrite = saveConversationIndex.mock.calls.find(
			(c) => c[1] === null,
		);
		expect(projectWrite?.[0]).toBe("p");
		expect(projectWrite?.[2].activeId).toBeNull();
		expect(
			projectWrite?.[2].conversations.map((c: { id: string }) => c.id),
		).toEqual([meta.id]);
		const instanceWrite = saveConversationIndex.mock.calls.find(
			(c) => c[1] === "i",
		);
		expect(instanceWrite?.[2]).toEqual({
			conversations: [],
			activeId: meta.id,
		});
	});
});

describe("restoring both scopes", () => {
	it("reads the project index once for all the instances of a project", async () => {
		await restoreConversations("px", "i1");
		await restoreConversations("px", "i2");

		expect(getConversationIndex.mock.calls).toEqual([
			["px", "i1"],
			["px", null],
			["px", "i2"],
		]);
	});

	it("reads an instance only once", async () => {
		await restoreConversations("py", "i1");
		await restoreConversations("py", "i1");

		expect(getConversationIndex).toHaveBeenCalledTimes(2);
	});
});

describe("opening a conversation that does not exist", () => {
	it("launches nothing and selects nothing", async () => {
		await openConversation(ref, "missing");

		expect(createTerminal).not.toHaveBeenCalled();
		expect(get(activeConversationId)).toEqual({});
	});

	it("disposes the terminal and records nothing when the launch fails", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		createTerminal.mockRejectedValueOnce(new Error("spawn failed"));
		const manager = await import("$lib/utils/terminal/terminal-manager");
		vi.mocked(manager.dispose).mockClear();

		await expect(openConversation(ref, meta.id)).rejects.toThrow(
			"spawn failed",
		);

		expect(manager.dispose).toHaveBeenCalledWith(`conversation:${meta.id}`);
		expect(get(conversationTerminals)[meta.id]).toBeUndefined();
	});
});

describe("session discovery after a relaunch", () => {
	it("does not ask again once the session was confirmed by the relaunch", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		cliSessionExists.mockResolvedValueOnce(true);
		await openConversation(ref, meta.id);

		await vi.advanceTimersByTimeAsync(60_000);

		expect(discoverCliSession).not.toHaveBeenCalled();
	});

	it("does not ask for a conversation that was deleted", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		deleteConversation(ref, meta.id);
		conversationTerminals.set({ [meta.id]: `conversation:${meta.id}` });

		await vi.advanceTimersByTimeAsync(2_000);

		expect(discoverCliSession).not.toHaveBeenCalled();
	});
});

describe("a refused resume", () => {
	async function resumed() {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		await openConversation(ref, meta.id);
		createTerminal.mockClear();
		return meta;
	}

	it("ignores the exit of another terminal and still watches its own", async () => {
		const meta = await resumed();

		emitExit("conversation:other", 1);
		await vi.advanceTimersByTimeAsync(100);
		expect(createTerminal).not.toHaveBeenCalled();

		emitExit(`conversation:${meta.id}`, 1);
		await vi.advanceTimersByTimeAsync(100);
		expect(lastArgv()).toEqual(["claude"]);
	});

	it("stops watching once its terminal has exited", async () => {
		const meta = await resumed();
		expect(exitHandlers.size).toBe(1);

		emitExit(`conversation:${meta.id}`, 0);

		expect(exitHandlers.size).toBe(0);
	});

	it("stops watching when the conversation is closed", async () => {
		const meta = await resumed();

		closeConversation(meta.id);

		expect(exitHandlers.size).toBe(0);
	});

	it("does not relaunch after a clean exit right after the resume", async () => {
		const meta = await resumed();

		emitExit(`conversation:${meta.id}`, 0);
		await vi.advanceTimersByTimeAsync(100);

		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("does not relaunch when the terminal is no longer the conversation's", async () => {
		const meta = await resumed();
		conversationTerminals.set({});

		emitExit(`conversation:${meta.id}`, 1);
		await vi.advanceTimersByTimeAsync(100);

		expect(createTerminal).not.toHaveBeenCalled();
		expect(conversationsOf(ref)[0].sessionId).toBe(meta.sessionId);
	});

	it("does not relaunch when a newer run has replaced the watched one", async () => {
		const meta = await resumed();
		const { conversationRuns } = await import("./conversation");
		conversationRuns.update((m) => ({ ...m, [meta.id]: 99 }));

		emitExit(`conversation:${meta.id}`, 1);
		await vi.advanceTimersByTimeAsync(100);

		expect(createTerminal).not.toHaveBeenCalled();
	});
});

describe("starting a fresh session", () => {
	it("does nothing for an unknown conversation", async () => {
		await startFreshSession(ref, "missing");

		expect(createTerminal).not.toHaveBeenCalled();
		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("leaves a CLI that mints its own id without one", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce("01HXYZ");
		await vi.advanceTimersByTimeAsync(2_000);

		await startFreshSession(ref, meta.id);

		expect(conversationsOf(ref)[0].sessionId).toBeNull();
		expect(lastArgv()).toEqual(["codex"]);
	});
});

describe("closing a conversation that is not running", () => {
	it("stops nothing", async () => {
		closeConversation("never-started");

		expect(closeTerminal).not.toHaveBeenCalled();
	});
});

describe("moving a conversation back", () => {
	it("moves a project entry to the instance scope", async () => {
		const meta = await startConversation(projectRef, "claude-code", "/repo/wt");

		moveConversationToScope(projectRef, meta.id);

		expect(conversationsOf(projectRef)).toHaveLength(0);
		expect(conversationsOf(ref).map((c) => c.id)).toEqual([meta.id]);
	});

	it("does nothing for an unknown id", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		moveConversationToScope(ref, "missing");

		expect(conversationsOf(ref).map((c) => c.id)).toEqual([meta.id]);
		expect(conversationsOf(projectRef)).toHaveLength(0);
	});
});

describe("removing an instance", () => {
	it("closes its CLIs, forgets its state and cancels the queued write", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		removeInstanceConversations("p", "i");
		await vi.advanceTimersByTimeAsync(1_000);

		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${meta.id}`);
		expect(get(instanceConversations)["p:i"]).toBeUndefined();
		expect(get(activeConversationId)["p:i"]).toBeUndefined();
		expect(saveConversationIndex).not.toHaveBeenCalled();
	});

	it("lets the instance be read from disk again", async () => {
		await restoreConversations("pz", "i1");
		removeInstanceConversations("pz", "i1");
		await restoreConversations("pz", "i1");

		expect(getConversationIndex.mock.calls).toEqual([
			["pz", "i1"],
			["pz", null],
			["pz", "i1"],
		]);
	});
});

describe("the run counter", () => {
	it("is 0 for a conversation never launched", () => {
		expect(runOf("never-launched")).toBe(0);
	});

	it("counts each launch of the CLI", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		expect(runOf(meta.id)).toBe(1);

		closeConversation(meta.id);
		await openConversation(ref, meta.id);

		expect(runOf(meta.id)).toBe(2);
		expect(get(conversationRuns)[meta.id]).toBe(2);
	});
});

describe("the terminal of a conversation", () => {
	it("is null when the CLI is not running", () => {
		expect(terminalOf("never-launched")).toBeNull();
	});

	it("is registered with the terminal manager when launched", async () => {
		const manager = await import("$lib/utils/terminal/terminal-manager");
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		expect(manager.create).toHaveBeenCalledWith(`conversation:${meta.id}`);
	});

	it("is disposed from the terminal manager when closed", async () => {
		const manager = await import("$lib/utils/terminal/terminal-manager");
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		closeConversation(meta.id);

		expect(manager.dispose).toHaveBeenCalledWith(`conversation:${meta.id}`);
	});
});

describe("remembering the CLI last started", () => {
	it("records the CLI of a new conversation", async () => {
		lastCli.set("");

		await startConversation(ref, "codex", "/repo/wt");

		expect(get(lastCli)).toBe("codex");
	});
});

describe("ordering by last opened", () => {
	it("stamps the time of a relaunch", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		await vi.advanceTimersByTimeAsync(5_000);

		await openConversation(ref, meta.id);

		expect(conversationsOf(ref)[0].lastOpenedAt).toBe(Date.now());
		expect(conversationsOf(ref)[0].lastOpenedAt).toBeGreaterThan(
			meta.createdAt,
		);
	});
});

describe("asking whether a minted session id is taken", () => {
	it("does not ask for a conversation just created", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");

		expect(cliSessionExists).not.toHaveBeenCalled();
	});

	it("does not ask once the session was confirmed", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);

		await openConversation(ref, meta.id);

		expect(cliSessionExists).not.toHaveBeenCalled();
	});

	it("does not ask for a conversation without a session id", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		closeConversation(meta.id);

		await openConversation(ref, meta.id);

		expect(cliSessionExists).not.toHaveBeenCalled();
	});

	it("asks for an unconfirmed conversation that has a session id", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);

		await openConversation(ref, meta.id);

		expect(cliSessionExists).toHaveBeenCalledWith(
			"claude-code",
			meta.sessionId,
		);
	});
});

describe("polling for the session id", () => {
	it("backs off between attempts and gives up after about a minute", async () => {
		await startConversation(ref, "opencode", "/repo/wt");
		const attempts = () => discoverCliSession.mock.calls.length;

		await vi.advanceTimersByTimeAsync(1_499);
		expect(attempts()).toBe(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(attempts()).toBe(1);

		await vi.advanceTimersByTimeAsync(2_999);
		expect(attempts()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(attempts()).toBe(2);

		await vi.advanceTimersByTimeAsync(5_999);
		expect(attempts()).toBe(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(attempts()).toBe(3);

		await vi.advanceTimersByTimeAsync(600_000);
		expect(attempts()).toBe(5);
	});
});

describe("marking a session as started", () => {
	const setSessionStarted = (isStarted: boolean) =>
		instanceConversations.update((m) => ({
			...m,
			"p:i": m["p:i"].map((c) => ({ ...c, sessionStarted: isStarted })),
		}));

	it("happens on the first input only", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		expect(conversationsOf(ref)[0].sessionStarted).toBeFalsy();

		noteTerminalInput(`conversation:${meta.id}`, "a");
		expect(conversationsOf(ref)[0].sessionStarted).toBe(true);

		setSessionStarted(false);
		noteTerminalInput(`conversation:${meta.id}`, "b");
		expect(conversationsOf(ref)[0].sessionStarted).toBe(false);
	});

	it("does not wait for input on a session that already started", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		noteTerminalInput(`conversation:${meta.id}`, "a");
		closeConversation(meta.id);
		await openConversation(ref, meta.id);

		setSessionStarted(false);
		noteTerminalInput(`conversation:${meta.id}`, "b");

		expect(conversationsOf(ref)[0].sessionStarted).toBe(false);
	});

	it("is not triggered by input after the conversation was closed", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);

		noteTerminalInput(`conversation:${meta.id}`, "typed\r");

		expect(conversationsOf(ref)[0].sessionStarted).toBeFalsy();
		expect(conversationsOf(ref)[0].title).toBe("");
	});
});

describe("keystrokes reaching any PTY", () => {
	it("are forwarded to the conversation they belong to", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		expect(inputObservers).toHaveLength(1);
		inputObservers[0](`conversation:${meta.id}`, "hello\r");

		expect(conversationsOf(ref)[0].title).toBe("Hello");
	});
});

describe("renaming and patching with several conversations", () => {
	it("pins only the targeted conversation", async () => {
		const first = await startConversation(ref, "claude-code", "/repo/wt");
		const second = await startConversation(ref, "claude-code", "/repo/wt");

		togglePinned(ref, first.id);

		const pinnedOf = (id: string) =>
			conversationsOf(ref).find((c) => c.id === id)?.pinned;
		expect(pinnedOf(first.id)).toBe(true);
		expect(pinnedOf(second.id)).toBe(false);
	});

	it("keeps naming the other conversations from their first prompt", async () => {
		const first = await startConversation(ref, "claude-code", "/repo/wt");
		const second = await startConversation(ref, "claude-code", "/repo/wt");

		renameConversation(ref, first.id, "Chosen");
		noteTerminalInput(`conversation:${second.id}`, "hello\r");

		const titleOf = (id: string) =>
			conversationsOf(ref).find((c) => c.id === id)?.title;
		expect(titleOf(first.id)).toBe("Chosen");
		expect(titleOf(second.id)).toBe("Hello");
	});
});

describe("deleting and moving with several conversations", () => {
	it("deletes only the targeted conversation and keeps the active one", async () => {
		const first = await startConversation(ref, "claude-code", "/repo/wt");
		const second = await startConversation(ref, "claude-code", "/repo/wt");

		deleteConversation(ref, first.id);

		expect(conversationsOf(ref).map((c) => c.id)).toEqual([second.id]);
		expect(get(activeConversationId)["p:i"]).toBe(second.id);
	});

	it("clears the active conversation when it is the one deleted", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");

		deleteConversation(ref, meta.id);

		expect(get(activeConversationId)["p:i"]).toBeNull();
	});

	it("moves only the targeted conversation", async () => {
		const first = await startConversation(ref, "claude-code", "/repo/wt");
		const second = await startConversation(ref, "claude-code", "/repo/wt");

		moveConversationToScope(ref, first.id);

		expect(conversationsOf(ref).map((c) => c.id)).toEqual([second.id]);
		expect(conversationsOf(projectRef).map((c) => c.id)).toEqual([first.id]);
	});
});

describe("scope stores", () => {
	it("keeps a project conversation out of the instance store", async () => {
		const meta = await startConversation(projectRef, "claude-code", "/repo/wt");

		expect(get(projectConversations).p.map((c) => c.id)).toEqual([meta.id]);
		expect(get(instanceConversations)["p:i"]).toBeUndefined();
		expect(get(instanceConversations).p).toBeUndefined();
	});
});

describe("the active conversation in the written index", () => {
	it("never leaks into the project scope", async () => {
		await startConversation(projectRef, "claude-code", "/repo/wt");
		activeConversationId.update((m) => ({ ...m, p: "stray" }));

		await vi.advanceTimersByTimeAsync(250);

		const projectWrite = saveConversationIndex.mock.calls.find(
			(c) => c[1] === null,
		);
		expect(projectWrite?.[2].activeId).toBeNull();
	});

	it("is null for an instance with none selected", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		activeConversationId.set({});

		await vi.advanceTimersByTimeAsync(250);

		const instanceWrite = saveConversationIndex.mock.calls.find(
			(c) => c[1] === "i",
		);
		expect(instanceWrite?.[2].activeId).toBeNull();
	});
});

describe("restoring conversations and the active one", () => {
	const saved = (id: string) => ({ id, title: id, cli: "codex" });

	it("fills both scopes and the active conversation from disk", async () => {
		getConversationIndex
			.mockResolvedValueOnce({ conversations: [saved("a")], activeId: "a" })
			.mockResolvedValueOnce({
				conversations: [saved("shared")],
				activeId: null,
			});

		await restoreConversations("rp", "i1");

		expect(get(activeConversationId)["rp:i1"]).toBe("a");
		expect(get(instanceConversations)["rp:i1"].map((c) => c.id)).toEqual(["a"]);
		expect(get(projectConversations).rp.map((c) => c.id)).toEqual(["shared"]);
	});

	it("keeps the project conversations when a second instance is restored", async () => {
		getConversationIndex.mockResolvedValueOnce(null).mockResolvedValueOnce({
			conversations: [saved("shared")],
			activeId: null,
		});
		await restoreConversations("rq", "i1");

		await restoreConversations("rq", "i2");

		expect(get(projectConversations).rq.map((c) => c.id)).toEqual(["shared"]);
		expect(get(activeConversationId)["rq:i2"]).toBeNull();
	});
});

describe("forgetting a project", () => {
	const otherRef: ConversationRef = {
		projectId: "p2",
		instanceId: "i",
		scope: "instance",
	};

	it("closes the CLIs of that project only", async () => {
		const own = await startConversation(ref, "claude-code", "/repo/wt");
		const other = await startConversation(otherRef, "claude-code", "/repo/wt");

		forgetProject("p");

		expect(closeTerminal).toHaveBeenCalledTimes(1);
		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${own.id}`);
		expect(get(conversationTerminals)[other.id]).toBe(
			`conversation:${other.id}`,
		);
	});

	it("cancels the queued index writes", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");

		forgetProject("p");
		await vi.advanceTimersByTimeAsync(1_000);

		expect(saveConversationIndex).not.toHaveBeenCalled();
	});

	it("lets the project be read from disk again", async () => {
		await restoreConversations("pf", "i1");
		forgetProject("pf");
		await restoreConversations("pf", "i1");

		expect(getConversationIndex.mock.calls).toEqual([
			["pf", "i1"],
			["pf", null],
			["pf", "i1"],
			["pf", null],
		]);
	});
});
