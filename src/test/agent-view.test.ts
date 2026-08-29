import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The panes and cards have their own suites; here they only need to mount. */
vi.mock("$lib/components/agent/ConversationHistoryPanel.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/agent/AgentRunsPanel.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/agent/TurnBlocks.svelte", async () => ({
	default: (await import("./stubs/TurnBlocksStub.svelte")).default,
}));
vi.mock("$lib/components/agent/PermissionCard.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/agent/AgentThreadConfirmModal.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/agent/AgentThreadView.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));

const sendMessage = vi.fn<(...a: unknown[]) => unknown>();
const stopAgent = vi.fn<(...a: unknown[]) => unknown>();
const respondPermission = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/agent-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	sendMessage: (...a: unknown[]) => sendMessage(...a),
	stopAgent: (...a: unknown[]) => stopAgent(...a),
	respondPermission: (...a: unknown[]) => respondPermission(...a),
}));

const listen = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...a: unknown[]) => listen(...a),
}));

const listAgentCommands = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/ai-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listAgentCommands: (...a: unknown[]) => listAgentCommands(...a),
}));

const quickSearch = vi.fn<(...a: unknown[]) => unknown>();
const writeFile = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	quickSearch: (...a: unknown[]) => quickSearch(...a),
	writeFile: (...a: unknown[]) => writeFile(...a),
}));

vi.mock("$lib/services/file-state-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getFileState: vi.fn(async (..._a: unknown[]) => ({ openTabs: [] })),
}));

const prepareInstanceEnv = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/env", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	prepareInstanceEnv: (...a: unknown[]) => prepareInstanceEnv(...a),
}));

const restoreConversations = vi.fn<(...a: unknown[]) => unknown>();
const loadConversationBody = vi.fn<(...a: unknown[]) => unknown>();
const createStoredConversation = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/conversation", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		restoreConversations: (...a: unknown[]) => restoreConversations(...a),
		updateConversationContent: vi.fn((..._a: unknown[]) => undefined),
		loadConversationBody: (...a: unknown[]) => loadConversationBody(...a),
		createConversation: (...a: unknown[]) => createStoredConversation(...a),
	};
});

const restoreAgentRuns = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/agent-runs", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	restoreAgentRuns: (...a: unknown[]) => restoreAgentRuns(...a),
}));

const loadAiProviders = vi.fn<(...a: unknown[]) => unknown>();
const refreshProviderModels = vi.fn<(...a: unknown[]) => unknown>();
const aiProviders = writable<Record<string, unknown>>({});
const providerCapabilities = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/ai-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	aiProviders: { subscribe: aiProviders.subscribe },
	providerCapabilities: { subscribe: providerCapabilities.subscribe },
	loadAiProviders: (...a: unknown[]) => loadAiProviders(...a),
	refreshProviderModels: (...a: unknown[]) => refreshProviderModels(...a),
}));

const loadNativeAgents = vi.fn<(...a: unknown[]) => unknown>();
const nativeAgents = writable<unknown[]>([]);
vi.mock("$lib/stores/native-agents", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	nativeAgents: { subscribe: nativeAgents.subscribe },
	loadNativeAgents: (...a: unknown[]) => loadNativeAgents(...a),
}));

const activeInstance = writable<unknown>(null);
const instancesWithBase = writable<unknown[]>([]);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
	instancesWithBase: { subscribe: instancesWithBase.subscribe },
}));

const settingsState = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: { subscribe: settingsState.subscribe },
}));

const recordUsage = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/usage", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

const { activeConversationId, instanceConversations } = await import(
	"$lib/stores/conversation"
);
const { agentBusyConversations } = await import("$lib/stores/agent-activity");
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: AgentView } = await import(
	"$lib/components/agent/AgentView.svelte"
);

const INSTANCE = {
	id: "i1",
	projectId: "p1",
	worktreePath: "/wt",
	branch: "feature",
	ticket: { id: "T-1", title: "Login" },
};

function mount() {
	render(AgentView, { props: {} });
}

const textarea = () =>
	document.querySelector("textarea") as HTMLTextAreaElement;
const sendButton = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		/send|envoyer|queue/i.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const stopButton = () =>
	document.querySelector(".btn-stop") as HTMLButtonElement | null;
const queuedRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".queued-row"));
const queuedTexts = () =>
	queuedRows().map((r) => r.querySelector(".queued-text")?.textContent?.trim());

async function settle() {
	for (let i = 0; i < 20; i++) {
		await tick();
		await Promise.resolve();
	}
}

/** Types a prompt into the composer and presses Send. */
async function sendPrompt(text: string) {
	await userEvent.clear(textarea());
	await userEvent.type(textarea(), text);
	await settle();
	await userEvent.click(sendButton());
	await settle();
}

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
		fn(0);
		return 0;
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	sendMessage.mockReset().mockResolvedValue(undefined);
	stopAgent.mockReset().mockResolvedValue(undefined);
	respondPermission.mockReset().mockResolvedValue(undefined);
	listen.mockReset().mockResolvedValue(() => {});
	listAgentCommands.mockReset().mockResolvedValue([]);
	quickSearch.mockReset().mockResolvedValue([]);
	writeFile.mockReset().mockResolvedValue(undefined);
	prepareInstanceEnv.mockReset().mockResolvedValue({});
	restoreConversations.mockReset().mockResolvedValue(undefined);
	loadConversationBody.mockReset().mockResolvedValue({
		messages: [],
		activity: [],
	});
	createStoredConversation.mockReset();
	restoreAgentRuns.mockReset().mockResolvedValue(undefined);
	loadAiProviders.mockReset().mockResolvedValue(undefined);
	refreshProviderModels.mockReset().mockResolvedValue(undefined);
	loadNativeAgents.mockReset().mockResolvedValue(undefined);
	recordUsage.mockReset();
	aiProviders.set({ providers: [], defaultProviderId: "claude-code" });
	providerCapabilities.set({});
	nativeAgents.set([]);
	settingsState.set({
		agentShowRateLimit: true,
		aiFeatures: {},
		workflowTabs: [],
	});
	instanceConversations.set({});
	activeConversationId.set({});
	agentBusyConversations.set({});
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstance.set(INSTANCE);
	instancesWithBase.set([INSTANCE]);
});

describe("AgentView", () => {
	describe("opening", () => {
		it("restores the conversations of the instance", async () => {
			mount();
			await settle();
			expect(restoreConversations).toHaveBeenCalled();
		});

		it("listens for the agent's output", async () => {
			mount();
			await settle();
			expect(listen).toHaveBeenCalledWith(
				"claude-output-batch",
				expect.any(Function),
			);
		});

		it("says so when there is no instance to talk to", async () => {
			activeInstance.set(null);
			mount();
			await settle();
			expect(textarea().disabled).toBe(true);
		});
	});

	describe("sending a prompt", () => {
		it("refuses an empty prompt", async () => {
			mount();
			await settle();
			expect(sendButton().disabled).toBe(true);
		});

		it("refuses a prompt of spaces only", async () => {
			mount();
			await settle();
			await userEvent.type(textarea(), "   ");
			await settle();
			expect(sendButton().disabled).toBe(true);
		});

		it("sends the prompt that was written", async () => {
			mount();
			await settle();
			await sendPrompt("What does this do?");
			expect(sendMessage).toHaveBeenCalledTimes(1);
			expect(sendMessage.mock.calls[0][0]).toBe("What does this do?");
		});

		/** Stray whitespace never reaches the agent. */
		it("sends the prompt trimmed", async () => {
			mount();
			await settle();
			await sendPrompt("   padded   ");
			expect(sendMessage.mock.calls[0][0]).toBe("padded");
		});

		/** The composer empties, so the prompt is not sent twice. */
		it("empties the composer once the prompt is away", async () => {
			mount();
			await settle();
			await sendPrompt("Hello");
			expect(textarea().value).toBe("");
		});

		it("sends nothing blank even when the button is forced", async () => {
			mount();
			await settle();
			sendButton().disabled = false;
			await userEvent.click(sendButton());
			await settle();
			expect(sendMessage).not.toHaveBeenCalled();
		});

		/**
		 * A conversation appears in the list the moment it is first used, not
		 * before: an untouched draft leaves nothing behind. `materialise` is
		 * only reached from a run that is actually starting, so its own
		 * `pending` guard is a second line of defence.
		 */
		it("writes the conversation down when it is first used", async () => {
			mount();
			await settle();
			expect(createStoredConversation).not.toHaveBeenCalled();
			await sendPrompt("Hello");
			expect(createStoredConversation).toHaveBeenCalledTimes(1);
			// A second prompt to the same conversation queues rather than sends,
			// and must not write the conversation down a second time.
			await sendPrompt("And again");
			expect(createStoredConversation).toHaveBeenCalledTimes(1);
		});

		it("hands the prepared environment to the agent", async () => {
			prepareInstanceEnv.mockResolvedValue({ FOO: "bar" });
			mount();
			await settle();
			await sendPrompt("Hello");
			expect(prepareInstanceEnv).toHaveBeenCalled();
			expect(sendMessage.mock.calls[0][5]).toEqual({ FOO: "bar" });
		});
	});

	describe("a conversation that is already answering", () => {
		/**
		 * The prompt waits its turn rather than being refused: a conversation
		 * that is busy is not a conversation with nothing to say to it.
		 */
		it("queues a second prompt instead of refusing it", async () => {
			mount();
			await settle();
			await sendPrompt("First");
			expect(sendMessage).toHaveBeenCalledTimes(1);
			await sendPrompt("Second");
			expect(sendMessage).toHaveBeenCalledTimes(1);
			expect(queuedTexts()).toEqual(["Second"]);
		});

		it("queues them in the order they were written", async () => {
			mount();
			await settle();
			await sendPrompt("First");
			await sendPrompt("Second");
			await sendPrompt("Third");
			expect(queuedTexts()).toEqual(["Second", "Third"]);
		});

		/** Taking one back puts it into the composer to be edited. */
		it("puts a queued prompt back into the composer", async () => {
			mount();
			await settle();
			await sendPrompt("First");
			await sendPrompt("Second");
			await userEvent.click(
				queuedRows()[0].querySelector(".queued-drop") as HTMLElement,
			);
			await settle();
			expect(queuedTexts()).toEqual([]);
			expect(textarea().value).toContain("Second");
		});

		it("offers to interrupt while it is answering", async () => {
			mount();
			await settle();
			await sendPrompt("First");
			expect(stopButton()).not.toBeNull();
			await userEvent.click(stopButton() as HTMLElement);
			await settle();
			expect(stopAgent).toHaveBeenCalledTimes(1);
		});

		it("offers no interrupt while it is idle", async () => {
			mount();
			await settle();
			expect(stopButton()).toBeNull();
		});
	});

	describe("what the agent says back", () => {
		/**
		 * Events arrive batched, and each carries the run it belongs to so two
		 * conversations answering at once never cross.
		 */
		function emit(...events: Record<string, unknown>[]) {
			const handler = listen.mock.calls.find(
				(c) => c[0] === "claude-output-batch",
			)?.[1] as (e: { payload: unknown }) => void;
			handler({ payload: events });
		}

		/** The runId the view minted is the 4th argument it sent. */
		const runIdOfLastSend = () => sendMessage.mock.calls[0][3] as string;

		it("shows the answer of the run it belongs to", async () => {
			mount();
			await settle();
			await sendPrompt("Hello");
			emit({
				runId: runIdOfLastSend(),
				source: "assistant",
				line: "Here is the answer.",
			});
			await settle();
			expect(document.body.textContent).toContain("Here is the answer.");
		});

		it("keeps the session id the provider handed back", async () => {
			mount();
			await settle();
			await sendPrompt("Hello");
			emit({
				runId: runIdOfLastSend(),
				source: "session",
				line: "sess-1",
			});
			await settle();
			expect(document.body.textContent).not.toContain("sess-1");
		});

		/**
		 * An event naming no run cannot be attributed and is dropped. The
		 * `runs[runId]` lookup below would reject it anyway, so the explicit
		 * `!runId` guard is a second line of defence rather than the one that
		 * fires.
		 */
		it("ignores an event with no run id", async () => {
			mount();
			await settle();
			await sendPrompt("Hello");
			emit({ runId: "", source: "assistant", line: "Unattributed." });
			await settle();
			expect(document.body.textContent).not.toContain("Unattributed.");
		});

		/** An event for a run this view never started is not ours to show. */
		it("ignores an event from an unknown run", async () => {
			mount();
			await settle();
			await sendPrompt("Hello");
			emit({ runId: "not-ours", source: "assistant", line: "Stray output." });
			await settle();
			expect(document.body.textContent).not.toContain("Stray output.");
		});
	});

	describe("the composer options", () => {
		it("offers the providers that are configured", async () => {
			aiProviders.set({
				providers: [{ id: "claude-code", label: "Claude Code" }],
				defaultProviderId: "claude-code",
			});
			mount();
			await settle();
			expect(document.querySelector(".option-chip")).not.toBeNull();
		});

		it("loads the providers and the agents on open", async () => {
			mount();
			await settle();
			expect(loadAiProviders).toHaveBeenCalled();
			expect(loadNativeAgents).toHaveBeenCalled();
		});
	});
});
