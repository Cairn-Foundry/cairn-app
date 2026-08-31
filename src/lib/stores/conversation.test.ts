// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	noteActivity,
	noteTerminalInput,
	openConversation,
	projectConversations,
	renameConversation,
	restoreConversations,
	selectConversation,
	startConversation,
	startIdleReaper,
	stopIdleReaper,
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

vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	create: vi.fn(),
	dispose: vi.fn(),
	size: () => ({ cols: 80, rows: 24 }),
	observeInput: vi.fn(),
	observeOutput: vi.fn(),
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
	discoverCliSession.mockResolvedValue(null);
	terminalHasChildren.mockResolvedValue(false);
	instanceConversations.set({});
	projectConversations.set({});
	activeConversationId.set({});
	conversationTerminals.set({});
});

afterEach(() => {
	stopIdleReaper();
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
	it("resumes by id once the CLI has been written to", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		// The session only exists on disk once the user has sent something.
		noteTerminalInput(`conversation:${meta.id}`, "hello\r");
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["claude", "--resume", meta.sessionId]);
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
		// The id is learned from the CLI once the conversation exists.
		discoverCliSession.mockResolvedValueOnce("01HXYZ");
		await vi.advanceTimersByTimeAsync(2_000);
		closeConversation(meta.id);
		createTerminal.mockClear();

		await openConversation(ref, meta.id);

		expect(lastArgv()).toEqual(["codex", "resume", "01HXYZ"]);
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

	it("never asks for a CLI that was handed an id at launch", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		await vi.advanceTimersByTimeAsync(10_000);

		expect(discoverCliSession).not.toHaveBeenCalled();
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

describe("closing the CLIs nobody is looking at", () => {
	const IDLE = 5 * 60_000;

	/** Runs the sweep, which polls on a minute and awaits the process check. */
	async function sweep() {
		startIdleReaper();
		await vi.advanceTimersByTimeAsync(60_000);
	}

	it("closes a background conversation that has gone quiet", async () => {
		const meta = await startConversation(ref, "claude-code", "/repo/wt");
		// Leaving it: another conversation is on screen.
		selectConversation("p", "i", null);
		await vi.advanceTimersByTimeAsync(IDLE);

		await sweep();

		expect(closeTerminal).toHaveBeenCalledWith(`conversation:${meta.id}`);
		// The entry survives, so reopening resumes it.
		expect(conversationsOf(ref)).toHaveLength(1);
	});

	it("never closes the conversation on screen", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		await vi.advanceTimersByTimeAsync(IDLE);

		await sweep();

		expect(closeTerminal).not.toHaveBeenCalled();
	});

	/**
	 * The case a timer cannot see: the CLI is blocked on a command with a long
	 * timeout, so it reads nothing and prints nothing, and only the process
	 * table knows it is working.
	 */
	it("spares a CLI that still has a process of its own", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		selectConversation("p", "i", null);
		terminalHasChildren.mockResolvedValue(true);
		await vi.advanceTimersByTimeAsync(IDLE);

		await sweep();

		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("leaves a CLI alone when the process check itself fails", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		selectConversation("p", "i", null);
		terminalHasChildren.mockRejectedValue(new Error("no answer"));
		await vi.advanceTimersByTimeAsync(IDLE);

		await sweep();

		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("waits out the whole idle period", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		selectConversation("p", "i", null);
		await vi.advanceTimersByTimeAsync(IDLE - 90_000);

		await sweep();

		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("counts what the CLI prints as activity", async () => {
		await startConversation(ref, "claude-code", "/repo/wt");
		selectConversation("p", "i", null);
		await vi.advanceTimersByTimeAsync(IDLE);
		// The CLI says something just before the sweep looks.
		noteActivity(`conversation:${conversationsOf(ref)[0].id}`, "output");

		await sweep();

		expect(closeTerminal).not.toHaveBeenCalled();
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
