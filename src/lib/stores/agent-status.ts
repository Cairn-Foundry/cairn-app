// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The status of every running conversation, across projects and instances.
 *
 * Only live conversations have one, and it lives in memory: a restart
 * relaunches no CLI, so there is nothing a persisted status could still
 * describe. See `utils/agent/agent-status.ts` for what each status means and
 * what moves it.
 */
import { listen } from "@tauri-apps/api/event";
import { derived, get, writable } from "svelte/store";
import { t } from "$lib/i18n";
import { notifyConversation } from "$lib/services/notification-service";
import {
	activeConversationId,
	conversationHosts,
	conversationRuns,
	conversationScopeKey,
	conversationTerminals,
	instanceConversations,
	projectConversations,
} from "$lib/stores/conversation";
import {
	activeInstance,
	BASE_INSTANCE_ID,
	loadedInstances,
} from "$lib/stores/instance";
import { projects } from "$lib/stores/project";
import { settings } from "$lib/stores/settings";
import {
	activeScreen,
	activeStep,
	commandsActive,
	envActive,
	formattingActive,
	terminalActive,
} from "$lib/stores/ui";
import {
	type AgentEvent,
	type AgentStatus,
	needsAttention,
	nextStatus,
	statusRank,
} from "$lib/utils/agent/agent-status";
import * as manager from "$lib/utils/terminal/terminal-manager";

export type { AgentStatus };

/** Status per conversation id; a conversation with nothing to show has no key. */
export const agentStatus = writable<Record<string, AgentStatus>>({});

export const windowFocused = writable(
	typeof document === "undefined" ? true : document.hasFocus(),
);

/** The conversation the Agent step has on screen, null when the step is not visible. */
export const shownConversation = derived(
	[
		activeScreen,
		activeStep,
		terminalActive,
		commandsActive,
		envActive,
		formattingActive,
		activeInstance,
		activeConversationId,
	],
	([screen, step, terminal, commands, env, formatting, instance, active]) => {
		if (screen !== "workspace" || step !== "agent" || !instance) return null;
		if (terminal || commands || env || formatting) return null;
		return (
			active[conversationScopeKey(instance.projectId, instance.id)] ?? null
		);
	},
);

const seenConversation = derived(
	[windowFocused, shownConversation],
	([focused, shown]) => (focused ? shown : null),
);

/** A CLI at work redraws its spinner continuously; this long without output, it is not working. */
export const QUIET_MS = 20_000;

const TERMINAL_PREFIX = "conversation:";

function conversationOfTerminal(terminalId: string): string | null {
	return terminalId.startsWith(TERMINAL_PREFIX)
		? terminalId.slice(TERMINAL_PREFIX.length)
		: null;
}

const lastOutput = new Map<string, number>();
const quietTimers = new Map<string, ReturnType<typeof setTimeout>>();

function disarmQuiet(id: string): void {
	const timer = quietTimers.get(id);
	if (timer) clearTimeout(timer);
	quietTimers.delete(id);
}

function armQuiet(id: string, delay = QUIET_MS): void {
	disarmQuiet(id);
	quietTimers.set(
		id,
		setTimeout(() => {
			quietTimers.delete(id);
			const silent = Date.now() - (lastOutput.get(id) ?? 0);
			if (silent >= QUIET_MS) applyAgentEvent(id, "quiet");
			else armQuiet(id, QUIET_MS - silent);
		}, delay),
	);
}

function setStatus(id: string, status: AgentStatus | undefined): void {
	agentStatus.update((m) => {
		const next = { ...m };
		if (status) next[id] = status;
		else delete next[id];
		return next;
	});
}

/** Moves a live conversation's status; anything about a conversation not running is ignored. */
export function applyAgentEvent(id: string, event: AgentEvent): void {
	if (!get(conversationTerminals)[id]) return;
	const prev = get(agentStatus)[id];
	const next = nextStatus(prev, event, get(seenConversation) === id);
	if (next === "working") {
		lastOutput.set(id, Date.now());
		if (prev !== "working") armQuiet(id);
	} else {
		disarmQuiet(id);
	}
	if (next === prev) return;
	setStatus(id, next);
	if (needsAttention(next) && !get(windowFocused)) announce(id, next);
}

/** One running conversation, with what the activity list needs to name it. */
export interface LiveConversation {
	id: string;
	projectId: string;
	instanceId: string;
	title: string;
	cli: string;
	status: AgentStatus | undefined;
	projectName: string;
	projectColor: string;
	instanceLabel: string;
}

/** Every running conversation, what needs the user first. */
export const liveConversations = derived(
	[
		conversationTerminals,
		conversationHosts,
		agentStatus,
		instanceConversations,
		projectConversations,
		projects,
		loadedInstances,
	],
	([
		terminals,
		hosts,
		statuses,
		byInstance,
		byProject,
		projectList,
		instances,
	]) =>
		Object.keys(terminals)
			.flatMap((id): LiveConversation[] => {
				const host = hosts[id];
				if (!host) return [];
				const meta =
					byInstance[
						conversationScopeKey(host.projectId, host.instanceId)
					]?.find((c) => c.id === id) ??
					byProject[host.projectId]?.find((c) => c.id === id);
				const project = projectList.find((p) => p.id === host.projectId);
				const instance = instances[host.projectId]?.find(
					(i) => i.id === host.instanceId,
				);
				return [
					{
						id,
						projectId: host.projectId,
						instanceId: host.instanceId,
						title: meta?.title ?? "",
						cli: meta?.cli ?? "",
						status: statuses[id],
						projectName: project?.name ?? "",
						projectColor: project?.color ?? "",
						instanceLabel:
							host.instanceId === BASE_INSTANCE_ID || !instance
								? (t("workspace.baseFolder.title") as string)
								: instance.ticket.title || instance.branch,
					},
				];
			})
			.sort(
				(a, b) =>
					statusRank(a.status) - statusRank(b.status) ||
					a.projectName.localeCompare(b.projectName) ||
					a.title.localeCompare(b.title),
			),
);

/** How many conversations are waiting for the user, per project id. */
export const attentionByProject = derived(liveConversations, (list) => {
	const counts: Record<string, number> = {};
	for (const c of list) {
		if (needsAttention(c.status))
			counts[c.projectId] = (counts[c.projectId] ?? 0) + 1;
	}
	return counts;
});

export const attentionCount = derived(
	liveConversations,
	(list) => list.filter((c) => needsAttention(c.status)).length,
);

function announce(id: string, status: AgentStatus): void {
	if (!get(settings).agentNotifications) return;
	const live = get(liveConversations).find((c) => c.id === id);
	if (!live) return;
	const title = live.title || (t("agent.history.untitled") as string);
	const what = t(
		status === "waiting"
			? "agent.status.notifyWaiting"
			: "agent.status.notifyDone",
	) as string;
	void notifyConversation(
		id,
		title,
		`${live.projectName} · ${live.instanceLabel} - ${what}`,
	).catch(() => {});
}

/** A conversation to bring on screen, set when its notification is clicked. */
export const openRequest = writable<{
	projectId: string;
	instanceId: string;
	conversationId: string;
} | null>(null);

function forget(id: string): void {
	disarmQuiet(id);
	lastOutput.delete(id);
	setStatus(id, undefined);
}

let knownRuns: Record<string, number> = {};

// A relaunch starts from nothing: the exit or the answer of the previous run
// says nothing about this one.
conversationRuns.subscribe((runs) => {
	for (const [id, run] of Object.entries(runs)) {
		if (knownRuns[id] !== undefined && knownRuns[id] !== run) forget(id);
	}
	knownRuns = runs;
});

conversationTerminals.subscribe((terminals) => {
	for (const id of Object.keys(get(agentStatus))) {
		if (!terminals[id]) forget(id);
	}
});

seenConversation.subscribe((id) => {
	if (id) applyAgentEvent(id, "seen");
});

manager.observeInput((terminalId) => {
	const id = conversationOfTerminal(terminalId);
	if (id) applyAgentEvent(id, "input");
});

manager.observeOutput((terminalId) => {
	const id = conversationOfTerminal(terminalId);
	if (id) lastOutput.set(id, Date.now());
});

manager.onTerminalExit(({ id: terminalId }) => {
	const id = conversationOfTerminal(terminalId);
	if (id) applyAgentEvent(id, "exit");
});

void listen<{ conversationId: string; signal: AgentEvent }>(
	"agent-signal",
	(e) => applyAgentEvent(e.payload.conversationId, e.payload.signal),
).catch(() => {});

void listen<{ conversationId: string }>("agent-notification-opened", (e) => {
	const id = e.payload.conversationId;
	const host = get(conversationHosts)[id];
	if (host) openRequest.set({ ...host, conversationId: id });
}).catch(() => {});

// WebKitGTK fires no DOM `blur` when another application takes the focus, so
// the window's own focus events are the only reliable source on Linux.
if (typeof window !== "undefined") {
	void import("@tauri-apps/api/window")
		.then(async ({ getCurrentWindow }) => {
			const win = getCurrentWindow();
			await win.onFocusChanged(({ payload }) => windowFocused.set(payload));
			windowFocused.set(await win.isFocused());
		})
		.catch(() => {});
}
