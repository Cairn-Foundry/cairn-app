// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeConversationId,
	type ConversationRef,
	closeConversation,
	conversationsOf,
	conversationTerminals,
	deleteConversation,
	instanceConversations,
	moveConversationToScope,
	noteTerminalInput,
	openConversation,
	projectConversations,
	renameConversation,
	restoreConversations,
	selectConversation,
	startConversation,
	startFreshSession,
} from "./conversation";

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
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	discoverCliSession: (...a: unknown[]) => discoverCliSession(...a),
}));

const exitHandlers = vi.hoisted(
	() => new Set<(e: { id: string; exitCode: number | null }) => void>(),
);
const emitExit = (id: string, exitCode: number | null) => {
	for (const h of [...exitHandlers]) h({ id, exitCode });
};

vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	create: vi.fn(),
	dispose: vi.fn(),
	size: () => ({ cols: 80, rows: 24 }),
	observeInput: vi.fn(),
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

/** The argv `terminal_create` was last called with. */
function lastArgv(): string[] {
	return createTerminal.mock.lastCall?.[6] as string[];
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
		// The CLI runs in the instance's worktree, which is what makes a
		// "last session here" resume unambiguous for the CLIs without ids.
		expect(createTerminal.mock.lastCall?.[1]).toBe("/repo/wt");
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
		// Typing makes a session likely; only discovery makes it a fact, and
		// `--resume` exits non-zero on a session the CLI never wrote.
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");
		discoverCliSession.mockResolvedValueOnce(meta.sessionId);
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--resume", meta.sessionId]);
	});

	it("relaunches under the minted id while the session is unconfirmed", async () => {
		// The user typed, so a session is likely - but the CLI has not written
		// one. `--session-id` creates it; `--resume` would refuse and exit.
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--session-id", meta.sessionId]);
	});

	it("does not reorder the list when a running conversation is shown", async () => {
		// Entering the Agent view reopens the active conversation on every mount;
		// that must not push it above the one the user last worked in.
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
		// Opened, never typed into, left and reopened: the id was minted at
		// creation but names a session the CLI never created, and resuming it
		// fails instead of starting the conversation.
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).not.toContain("--resume");
	});

	it("reopens the exact conversation for a CLI that minted its own id", async () => {
		const meta = await startConversation(ref, "codex", "/repo/wt");
		// The id is learned from the CLI once the conversation exists, which is
		// also what confirms it as resumable.
		discoverCliSession.mockResolvedValueOnce("01HXYZ");
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["codex", "resume", "01HXYZ"]);
	});

	it("falls back to a fresh session when a resume is refused", async () => {
		// The session was confirmed, then vanished: the CLI pruned its store, or
		// the home directory was cleared. `--resume` exits at once, and the
		// conversation must open rather than sit on a dead terminal.
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
		// An ordinary exit, seconds later and with no error: relaunching that
		// behind the user's back is exactly what stopping is meant to prevent.
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
		// A conversation closed before the user said anything has no id: there is
		// nothing to resume, and "the last session here" would be another one.
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
		// Confirmed once, so reopening resumes it - and the CLI can have lost it
		// since. A CLI that comes up on an empty session rather than exiting is
		// what the automatic fallback never sees.
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
		// Nothing is recorded until the user actually speaks to the CLI.
		discoverCliSession.mockResolvedValue(null);
		terminalHasChildren.mockResolvedValue(false);

		await startConversation(ref, "opencode", "/repo/wt");
		await vi.advanceTimersByTimeAsync(10_000);

		expect(discoverCliSession.mock.calls.length).toBeGreaterThan(1);
		expect(conversationsOf(ref)[0].sessionId).toBeNull();
	});

	it("asks for a CLI handed an id at launch, until the session is seen", async () => {
		// The id Cairn minted is a request the CLI is free to ignore, so it is
		// polled like any other until the session turns up on disk.
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

		// Well past what used to be the idle timeout, and past any sweep that
		// could have fired in it.
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
