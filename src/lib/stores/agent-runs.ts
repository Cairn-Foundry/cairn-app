/** Runs of the native agents: their blocks as they stream in, and the permission requests they raise. */
import { get, writable } from "svelte/store";
import {
	type AgentBlock,
	type AgentRun,
	type AgentRunStatus,
	getAgentRuns,
	saveAgentRuns,
} from "$lib/services/agent-runs-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type { PendingPermission } from "$lib/utils/agent/permission-response";
import { persist as persistToDisk } from "$lib/utils/persist-error";
import { dropProjectKeys, purgeProjectEntries } from "$lib/utils/project-scope";

export type { AgentBlock, AgentRun, AgentRunStatus };

/** Runs by project id, newest first. */
export const agentRuns = writable<Record<string, AgentRun[]>>({});

/**
 * Requests raised by a run nobody is watching, keyed by run. They are answered
 * from the Agents view, and mirrored inline when the conversation that called
 * the agent happens to be open.
 */
export const agentPermissionRequests = writable<
	Record<string, PendingPermission>
>({});

/** Records a permission request so the Agents view can answer it. */
export function setAgentPermission(
	runId: string,
	request: PendingPermission,
): void {
	agentPermissionRequests.update((m) => ({ ...m, [runId]: request }));
}

/** Drops the request once answered or once the run ended. */
export function clearAgentPermission(runId: string): void {
	agentPermissionRequests.update((m) => {
		const { [runId]: _answered, ...rest } = m;
		return rest;
	});
}

// Writes are debounced per project: a streaming run patches its blocks on every chunk.
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const persistDeadlines = new Map<string, number>();
const PERSIST_DELAY_MS = 250;
/** A continuous stream would otherwise push the timer back for ever and never write. */
const PERSIST_MAX_DELAY_MS = 2000;
/**
 * Runs kept per project. Their blocks are duplicated in the conversation
 * transcripts, so the history here is a working set, not the archive - without
 * a bound it grows for the lifetime of the project.
 */
const MAX_RUNS_PER_PROJECT = 200;

/** A run still holding its process, so it can be stopped and must not be started again. */
export function isInFlight(status: AgentRunStatus): boolean {
	return status === "running" || status === "awaiting-permission";
}

/** Non-reactive read of a project's runs, newest first. */
export function runsOf(projectId: string): AgentRun[] {
	return get(agentRuns)[projectId] ?? [];
}

/** Looks a run up across every project, since a run id is unique app-wide. */
export function findAgentRun(runId: string): AgentRun | null {
	for (const list of Object.values(get(agentRuns))) {
		const run = list.find((r) => r.id === runId);
		if (run) return run;
	}
	return null;
}

/**
 * Forgets a removed project's runs and cancels its queued write, which would
 * otherwise recreate the project directory it was deleted with.
 */
export function forgetProject(projectId: string): void {
	purgeProjectEntries(persistTimers, projectId, (v) =>
		clearTimeout(v as ReturnType<typeof setTimeout>),
	);
	purgeProjectEntries(persistDeadlines, projectId);
	const runIds = new Set((get(agentRuns)[projectId] ?? []).map((r) => r.id));
	agentRuns.update((m) => dropProjectKeys(m, projectId));
	agentPermissionRequests.update((m) => {
		const next: typeof m = {};
		for (const [runId, request] of Object.entries(m)) {
			if (!runIds.has(runId)) next[runId] = request;
		}
		return next;
	});
}

/** Schedules a debounced write of the project's runs. */
function persist(projectId: string): void {
	const existing = persistTimers.get(projectId);
	if (existing) clearTimeout(existing);

	const now = Date.now();
	const deadline =
		persistDeadlines.get(projectId) ?? now + PERSIST_MAX_DELAY_MS;
	persistDeadlines.set(projectId, deadline);

	persistTimers.set(
		projectId,
		setTimeout(
			() => {
				persistTimers.delete(projectId);
				persistDeadlines.delete(projectId);
				persistToDisk(
					"the agent run history",
					saveAgentRuns(projectId, runsOf(projectId)),
				);
			},
			Math.max(0, Math.min(PERSIST_DELAY_MS, deadline - now)),
		),
	);
}

/**
 * A run in flight when the app went down comes back `interrupted` - its process
 * died with the window. Nothing holds a lease at that point, so the map starts
 * clean.
 */
export async function restoreAgentRuns(projectId: string): Promise<void> {
	if (get(agentRuns)[projectId]) return;
	const runs = await getAgentRuns(projectId).catch(() => []);
	agentRuns.update((m) => ({ ...m, [projectId]: runs }));
}

/** Records a freshly started run at the head of its project's list. */
export function addAgentRun(projectId: string, run: AgentRun): void {
	agentRuns.update((m) => ({
		...m,
		[projectId]: trimRuns([run, ...(m[projectId] ?? [])]),
	}));
	persist(projectId);
}

/**
 * Drops the oldest runs past the cap. A run still holding its process is kept
 * whatever its age: forgetting it would lose the only handle able to stop it.
 */
function trimRuns(runs: AgentRun[]): AgentRun[] {
	if (runs.length <= MAX_RUNS_PER_PROJECT) return runs;
	return runs.filter(
		(run, i) => i < MAX_RUNS_PER_PROJECT || isInFlight(run.status),
	);
}

/** Updates fields of one run; the single write path, so every change is persisted. */
export function patchAgentRun(
	projectId: string,
	runId: string,
	fields: Partial<AgentRun>,
): void {
	agentRuns.update((m) => ({
		...m,
		[projectId]: (m[projectId] ?? []).map((run) =>
			run.id === runId ? { ...run, ...fields } : run,
		),
	}));
	persist(projectId);
}

/**
 * Forgets one agent's work in one conversation. Only its runs go: what it
 * already answered lives in the conversation as messages, and stays there.
 */
export function deleteAgentThread(
	projectId: string,
	conversationId: string,
	agentId: string,
): void {
	agentRuns.update((m) => ({
		...m,
		[projectId]: (m[projectId] ?? []).filter(
			(run) => run.conversationId !== conversationId || run.agentId !== agentId,
		),
	}));
	persist(projectId);
}

/**
 * Adds what just arrived to the run's list, in arrival order. Consecutive text
 * or reasoning joins the block it continues; a tool call always opens its own,
 * so the order the agent worked in is the order it reads in.
 */
export function appendAgentBlock(
	projectId: string,
	runId: string,
	block: AgentBlock,
): void {
	const run = findAgentRun(runId);
	if (!run) return;
	const blocks = [...run.blocks];
	const last = blocks[blocks.length - 1];
	if (block.kind !== "tool" && last?.kind === block.kind) {
		blocks[blocks.length - 1] = { ...last, text: last.text + block.text };
	} else {
		blocks.push(block);
	}
	patchAgentRun(projectId, runId, {
		blocks,
		...(block.kind === "text" ? { result: lastTextOf(blocks) } : {}),
		...(block.kind === "thinking" ? { thinking: lastThinkingOf(blocks) } : {}),
	});
}

/** Closes the tool call that was still open, when its result comes back. */
export function finishAgentToolBlock(
	projectId: string,
	runId: string,
	failed: boolean,
): void {
	const run = findAgentRun(runId);
	if (!run) return;
	const blocks = [...run.blocks];
	for (let i = blocks.length - 1; i >= 0; i--) {
		if (blocks[i].kind !== "tool" || blocks[i].done) continue;
		blocks[i] = { ...blocks[i], done: true, failed };
		patchAgentRun(projectId, runId, { blocks });
		return;
	}
}

/**
 * Closes every tool the run left open. A run that is stopped mid-tool never
 * gets its result back, and the line would spin for ever.
 */
export function closeAgentToolBlocks(projectId: string, runId: string): void {
	const run = findAgentRun(runId);
	if (!run?.blocks.some((b) => b.kind === "tool" && !b.done)) return;
	patchAgentRun(projectId, runId, {
		blocks: run.blocks.map((b) =>
			b.kind === "tool" && !b.done ? { ...b, done: true } : b,
		),
	});
}

/**
 * The answer is the last thing the agent wrote, not everything it wrote: the
 * texts before it are working notes between tool calls, and gluing them all
 * together turns the reply into a wall.
 */
export function lastTextOf(blocks: AgentBlock[]): string {
	return [...blocks].reverse().find((b) => b.kind === "text")?.text ?? "";
}

/** The last reasoning block, for the same reason as lastTextOf(). */
export function lastThinkingOf(blocks: AgentBlock[]): string {
	return [...blocks].reverse().find((b) => b.kind === "thinking")?.text ?? "";
}

/**
 * Every run of one agent in one conversation, oldest first - the agent's thread.
 * An agent is scoped to the conversation that called it, so this is what
 * entering it shows and what its next prompt continues.
 */
export function agentThreadRuns(
	projectId: string,
	conversationId: string,
	agentId: string,
): AgentRun[] {
	return runsOf(projectId)
		.filter(
			(run) => run.conversationId === conversationId && run.agentId === agentId,
		)
		.slice()
		.reverse();
}

/**
 * The agents that have a thread in this conversation, most recently started
 * first, with the run that says what each is doing now.
 */
export function agentThreadsOf(
	projectId: string,
	conversationId: string,
): { agentId: string; latest: AgentRun; runs: AgentRun[] }[] {
	const byAgent = new Map<string, AgentRun[]>();
	for (const run of runsOf(projectId)) {
		if (run.conversationId !== conversationId) continue;
		const list = byAgent.get(run.agentId);
		if (list) list.push(run);
		else byAgent.set(run.agentId, [run]);
	}
	return [...byAgent.entries()].map(([agentId, runs]) => ({
		agentId,
		latest: runs[0],
		runs: runs.slice().reverse(),
	}));
}

/** The agent's past exchanges here, oldest first, for a provider taking over. */
export function agentTurnsOf(
	projectId: string,
	conversationId: string,
	agentId: string,
): { prompt: string; result: string }[] {
	return agentThreadRuns(projectId, conversationId, agentId)
		.filter((run) => run.result.trim() !== "")
		.map((run) => ({ prompt: run.prompt, result: run.result }));
}

onProjectRemoved(forgetProject);
