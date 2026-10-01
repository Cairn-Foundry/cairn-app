// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, type writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "$lib/types/instance";

const hooks = vi.hoisted(() => ({
	signal: null as
		| null
		| ((e: { payload: { conversationId: string; signal: string } }) => void),
	opened: null as null | ((e: { payload: { conversationId: string } }) => void),
	input: null as null | ((id: string, data: string) => void),
	output: null as null | ((id: string) => void),
	exit: null as null | ((e: { id: string; exitCode: number | null }) => void),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn((event: string, handler: never) => {
		if (event === "agent-signal") hooks.signal = handler;
		if (event === "agent-notification-opened") hooks.opened = handler;
		return Promise.resolve(() => {});
	}),
}));

vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	observeInput: (fn: typeof hooks.input) => {
		hooks.input = fn;
		return () => {};
	},
	observeOutput: (fn: typeof hooks.output) => {
		hooks.output = fn;
		return () => {};
	},
	onTerminalExit: (fn: typeof hooks.exit) => {
		hooks.exit = fn;
		return () => {};
	},
}));

const notify = vi.fn().mockResolvedValue(undefined);
vi.mock("$lib/services/notification-service", () => ({
	notifyConversation: (...a: unknown[]) => notify(...a),
}));

vi.mock("$lib/stores/instance", async () => {
	const { writable } = await import("svelte/store");
	return {
		BASE_INSTANCE_ID: "__base__",
		activeInstance: writable<Instance | null>(null),
		loadedInstances: writable<Record<string, Instance[]>>({}),
	};
});

import {
	activeConversationId,
	conversationHosts,
	conversationTerminals,
	instanceConversations,
} from "$lib/stores/conversation";
import { activeInstance, loadedInstances } from "$lib/stores/instance";
import { projects } from "$lib/stores/project";
import { settings } from "$lib/stores/settings";
import { activeScreen, activeStep } from "$lib/stores/ui";
import {
	agentStatus,
	attentionByProject,
	liveConversations,
	openRequest,
	QUIET_MS,
	windowFocused,
} from "./agent-status";

const instance = {
	id: "i",
	projectId: "p",
	ticket: { id: "t", title: "Fix the login" },
	branch: "fix/login",
} as Instance;

function signal(conversationId: string, value: string) {
	hooks.signal?.({ payload: { conversationId, signal: value } });
}

function run(id: string) {
	conversationTerminals.update((m) => ({ ...m, [id]: `conversation:${id}` }));
	conversationHosts.update((m) => ({
		...m,
		[id]: { projectId: "p", instanceId: "i" },
	}));
}

/** Puts conversation `id` on screen in the Agent step. */
function show(id: string) {
	(activeInstance as ReturnType<typeof writable<Instance | null>>).set(
		instance,
	);
	activeConversationId.set({ "p:i": id });
	activeStep.set("agent");
	activeScreen.set("workspace");
}

beforeEach(() => {
	vi.useFakeTimers();
	notify.mockClear();
	agentStatus.set({});
	conversationTerminals.set({});
	conversationHosts.set({});
	activeConversationId.set({});
	activeScreen.set("home");
	activeStep.set("files");
	windowFocused.set(false);
	projects.set([
		{
			id: "p",
			name: "Cairn",
			path: "/p",
			color: "#f00",
			activeInstanceId: "i",
		},
	]);
	(
		loadedInstances as ReturnType<typeof writable<Record<string, Instance[]>>>
	).set({ p: [instance] });
	instanceConversations.set({
		"p:i": [
			{
				id: "c1",
				title: "Refactor auth",
				cli: "claude-code",
				sessionId: null,
				cwd: "/p",
				createdAt: 0,
				lastOpenedAt: 0,
				pinned: false,
				archived: false,
			},
		],
	});
	void settings.save({ agentNotifications: true }).catch(() => {});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("a conversation reporting its turn", () => {
	it("marks the turn and notifies while the window is in the background", () => {
		run("c1");
		signal("c1", "working");
		signal("c1", "done");

		expect(get(agentStatus).c1).toBe("done");
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.lastCall?.[1]).toBe("Refactor auth");
		expect(notify.mock.lastCall?.[2]).toContain("Cairn · Fix the login");
	});

	it("neither marks nor notifies a turn that ends under the user's eyes", () => {
		run("c1");
		windowFocused.set(true);
		show("c1");
		signal("c1", "working");
		signal("c1", "done");

		expect(get(agentStatus).c1).toBeUndefined();
		expect(notify).not.toHaveBeenCalled();
	});

	it("marks without notifying when the window is focused elsewhere", () => {
		run("c1");
		windowFocused.set(true);
		signal("c1", "waiting");

		expect(get(agentStatus).c1).toBe("waiting");
		expect(notify).not.toHaveBeenCalled();
	});

	it("clears the mark once the conversation is on screen in a focused window", () => {
		run("c1");
		signal("c1", "done");
		show("c1");
		expect(get(agentStatus).c1).toBe("done");

		windowFocused.set(true);
		expect(get(agentStatus).c1).toBeUndefined();
	});

	it("stays silent when notifications are turned off", async () => {
		await settings.save({ agentNotifications: false }).catch(() => {});
		run("c1");
		signal("c1", "done");

		expect(get(agentStatus).c1).toBe("done");
		expect(notify).not.toHaveBeenCalled();
	});

	it("ignores a signal for a conversation that is not running", () => {
		signal("c1", "done");
		expect(get(agentStatus).c1).toBeUndefined();
	});
});

describe("what the terminal says without the CLI", () => {
	it("stops calling a silent conversation working", () => {
		run("c1");
		signal("c1", "working");
		vi.advanceTimersByTime(QUIET_MS / 2);
		hooks.output?.("conversation:c1");
		vi.advanceTimersByTime(QUIET_MS / 2 + 10);
		expect(get(agentStatus).c1).toBe("working");

		vi.advanceTimersByTime(QUIET_MS);
		expect(get(agentStatus).c1).toBeUndefined();
	});

	it("takes a keystroke on a pending approval as the turn resuming", () => {
		run("c1");
		signal("c1", "waiting");
		hooks.input?.("conversation:c1", "1");
		expect(get(agentStatus).c1).toBe("working");
	});

	it("shows a CLI that exited on its own, and forgets it once closed", () => {
		run("c1");
		hooks.exit?.({ id: "conversation:c1", exitCode: 1 });
		expect(get(agentStatus).c1).toBe("exited");

		conversationTerminals.set({});
		expect(get(agentStatus).c1).toBeUndefined();
	});
});

describe("the global view", () => {
	it("lists every running conversation, what needs the user first", () => {
		run("c1");
		run("c2");
		signal("c1", "working");
		signal("c2", "done");

		const list = get(liveConversations);
		expect(list.map((c) => c.id)).toEqual(["c2", "c1"]);
		expect(list[1]).toMatchObject({
			title: "Refactor auth",
			projectName: "Cairn",
			instanceLabel: "Fix the login",
		});
		expect(get(attentionByProject)).toEqual({ p: 1 });
	});
});

describe("clicking a notification", () => {
	it("asks for the conversation it was about, where it was launched", () => {
		run("c1");
		hooks.opened?.({ payload: { conversationId: "c1" } });
		expect(get(openRequest)).toEqual({
			projectId: "p",
			instanceId: "i",
			conversationId: "c1",
		});
	});

	it("does nothing for a conversation that is no longer running", () => {
		openRequest.set(null);
		hooks.opened?.({ payload: { conversationId: "gone" } });
		expect(get(openRequest)).toBeNull();
	});
});
