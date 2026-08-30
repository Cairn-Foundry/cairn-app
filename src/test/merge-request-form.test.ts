import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gitState = writable({
	branches: ["main", "develop"],
	remoteBranches: [],
});
const loadBranches = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/git", () => ({
	git: { subscribe: gitState.subscribe },
	loadBranches: (...a: unknown[]) => loadBranches(...a),
}));

const createMergeRequest = vi.fn<(...a: unknown[]) => unknown>();
const loadForgeLabels = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/merge-request", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	createMergeRequest: (...a: unknown[]) => createMergeRequest(...a),
	loadForgeLabels: (...a: unknown[]) => loadForgeLabels(...a),
}));

const forgeIdentity = writable<unknown>(null);
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	forgeIdentity: { subscribe: forgeIdentity.subscribe },
}));

const runOneShot = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/ai-assist-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	runOneShot: (...a: unknown[]) => runOneShot(...a),
}));

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { cliProviders } = await import("$lib/stores/cli-providers");
const { project } = await import("./fixtures");
const { default: MergeRequestForm } = await import(
	"$lib/components/git/MergeRequestForm.svelte"
);

function mount(props: Record<string, unknown> = {}) {
	const onCreated = vi.fn((..._a: unknown[]) => undefined);
	const onCancel = vi.fn((..._a: unknown[]) => undefined);
	render(MergeRequestForm, {
		props: {
			projectId: "p1",
			instanceId: "i1",
			sourceBranch: "feature/login",
			targetBranch: "main",
			worktreePath: "/worktrees/p1/i1",
			ticket: null,
			...props,
		},
		events: {
			created: (e: CustomEvent) => onCreated(e.detail),
			cancel: () => onCancel(),
		},
	});
	return { onCreated, onCancel };
}

const titleField = () =>
	document.getElementById("mr-title") as HTMLInputElement;
const descriptionField = () =>
	document.getElementById("mr-description") as HTMLTextAreaElement;
const checkboxes = () =>
	Array.from(
		document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
	);
const submitButton = () =>
	document.querySelector('button[type="submit"]') as HTMLButtonElement;
const cancelButton = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".btn.ghost")).find(
		(b) => !b.classList.contains("ai-btn"),
	) as HTMLElement;
const aiButton = () => document.querySelector(".ai-btn") as HTMLElement;

async function settle() {
	await tick();
	await tick();
	await tick();
}

/** The payload the form handed to the store. */
const submitted = () =>
	createMergeRequest.mock.calls[0]?.[2] as Record<string, unknown>;

beforeEach(() => {
	loadBranches.mockReset().mockResolvedValue(undefined);
	createMergeRequest.mockReset().mockResolvedValue({ number: "1" });
	loadForgeLabels.mockReset().mockResolvedValue([]);
	runOneShot.mockReset();
	// The assists run Claude Code headlessly; without it detected the button is
	// disabled and nothing is generated.
	cliProviders.set([
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
	]);
	forgeIdentity.set(null);
	gitState.set({ branches: ["main", "develop"], remoteBranches: [] });
	projects.set([project("p1")]);
	activeProjectId.set("p1");
});

describe("MergeRequestForm", () => {
	describe("what it refuses", () => {
		/** A merge request needs a title; everything else has a default. */
		it("refuses a request with no title", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			expect(submitButton().disabled).toBe(true);
		});

		it("refuses a title of spaces only", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "   ");
			expect(submitButton().disabled).toBe(true);
		});

		it("allows it once a title is typed", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			expect(submitButton().disabled).toBe(false);
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("still submits nothing untitled when the button is forced", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			submitButton().disabled = false;
			await userEvent.click(submitButton());
			await settle();
			expect(createMergeRequest).not.toHaveBeenCalled();
		});
	});

	describe("submitting", () => {
		async function fillAndSubmit(extra: () => Promise<void> = async () => {}) {
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await extra();
			await userEvent.click(submitButton());
			await settle();
		}

		it("submits the title, trimmed, with the branches", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "  Add login  ");
			await userEvent.click(submitButton());
			await settle();
			expect(submitted()).toMatchObject({
				title: "Add login",
				sourceBranch: "feature/login",
				targetBranch: "main",
			});
		});

		it("reports the created request", async () => {
			const { onCreated } = mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(onCreated).toHaveBeenCalledWith({ number: "1" });
		});

		it("submits the description as written", async () => {
			await fillAndSubmit(async () => {
				await userEvent.type(descriptionField(), "Why this change");
			});
			expect(submitted().description).toContain("Why this change");
		});

		it("submits the options that were ticked", async () => {
			await fillAndSubmit(async () => {
				await userEvent.click(checkboxes()[0]);
			});
			expect(submitted().isDraft).toBe(true);
		});

		/** A failed creation is reported and the form stays open to retry. */
		it("reports a failure instead of closing", async () => {
			createMergeRequest.mockRejectedValue(new Error("forbidden"));
			const { onCreated } = mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(onCreated).not.toHaveBeenCalled();
			expect(document.body.textContent).toMatch(/forbidden|error|erreur/i);
		});

		it("becomes usable again after a failure", async () => {
			createMergeRequest.mockRejectedValue(new Error("nope"));
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(submitButton().disabled).toBe(false);
		});

		it("cancels without creating anything", async () => {
			const { onCancel } = mount();
			await settle();
			await userEvent.click(cancelButton());
			expect(onCancel).toHaveBeenCalled();
			expect(createMergeRequest).not.toHaveBeenCalled();
		});
	});

	describe("the assignee", () => {
		/** The author is assigned by default, since it is usually their request. */
		it("assigns the signed-in account by default", async () => {
			forgeIdentity.set({
				login: "alice",
				displayName: "Alice",
				avatarUrl: null,
			});
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(submitted().assignees).toEqual(["alice"]);
		});

		it("assigns nobody when the forge has no identity", async () => {
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(submitted().assignees).toEqual([]);
		});
	});

	describe("the linked ticket", () => {
		const withTicket = {
			key: "PROJ-1",
			title: "Fix the parser",
			url: "https://tracker/PROJ-1",
		};

		it("links the ticket by default when there is one", async () => {
			mount({ ticket: withTicket });
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(submitted().linkedTicketKey).toBe("PROJ-1");
		});

		it("links nothing when there is no ticket", async () => {
			mount({ ticket: null });
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			await userEvent.click(submitButton());
			await settle();
			expect(submitted().linkedTicketKey).toBeNull();
		});

		it("links nothing once the option is unticked", async () => {
			mount({ ticket: withTicket });
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "Add login");
			const link = checkboxes()[checkboxes().length - 1];
			await userEvent.click(link);
			await userEvent.click(submitButton());
			await settle();
			expect(submitted().linkedTicketKey).toBeNull();
		});
	});

	describe("writing it with the agent", () => {
		/**
		 * The answer's first line is the title and the rest the description, with
		 * a "Title:" prefix or a markdown heading stripped either way.
		 */
		it("takes the first line as the title and the rest as the description", async () => {
			runOneShot.mockResolvedValue("Add login\n\nWhy this change matters.");
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(titleField().value).toBe("Add login");
			expect(descriptionField().value).toContain("Why this change matters.");
		});

		it("strips a Title: prefix from the first line", async () => {
			runOneShot.mockResolvedValue("Title: Add login\n\nBody here.");
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(titleField().value).toBe("Add login");
		});

		it("strips a markdown heading from the first line", async () => {
			runOneShot.mockResolvedValue("## Add login\n\nBody here.");
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(titleField().value).toBe("Add login");
		});

		/** Blank lines before the title are skipped rather than taken as it. */
		it("skips the blank lines before the title", async () => {
			runOneShot.mockResolvedValue("\n\n\nAdd login\n\nBody.");
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(titleField().value).toBe("Add login");
		});

		it("reports a failed generation without touching the fields", async () => {
			runOneShot.mockRejectedValue(new Error("no provider"));
			mount();
			await settle();
			await userEvent.clear(titleField());
			await userEvent.type(titleField(), "typed by hand");
			await userEvent.click(aiButton());
			await settle();
			expect(titleField().value).toBe("typed by hand");
		});
	});
});
