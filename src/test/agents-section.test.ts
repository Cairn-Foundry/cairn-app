import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeAgent } from "$lib/services/native-agent-service";

const saveNativeAgent = vi.fn<(...a: unknown[]) => unknown>();
const deleteNativeAgent = vi.fn<(...a: unknown[]) => unknown>();
const duplicateNativeAgent = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/native-agent-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveNativeAgent: (...a: unknown[]) => saveNativeAgent(...a),
	deleteNativeAgent: (...a: unknown[]) => deleteNativeAgent(...a),
	duplicateNativeAgent: (...a: unknown[]) => duplicateNativeAgent(...a),
}));

const revealInFileManager = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	revealInFileManager: (...a: unknown[]) => revealInFileManager(...a),
}));

const reachedProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	reachedProviders: (...a: unknown[]) => reachedProviders(...a),
}));

const nativeAgents = writable<NativeAgent[]>([]);
const nativeAgentsError = writable("");
const nativeAgentsLoading = writable(false);
const loadNativeAgents = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/native-agents", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	nativeAgents: { subscribe: nativeAgents.subscribe },
	nativeAgentsError: { subscribe: nativeAgentsError.subscribe },
	nativeAgentsLoading: { subscribe: nativeAgentsLoading.subscribe },
	loadNativeAgents: (...a: unknown[]) => loadNativeAgents(...a),
}));

const cliProviders = writable<{ id: string; label: string }[]>([]);
const loadCliProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/cli-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	cliProviders: { subscribe: cliProviders.subscribe },
	loadCliProviders: (...a: unknown[]) => loadCliProviders(...a),
}));

const skillList = writable<{ name: string }[]>([]);
const loadSkills = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/skills", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	skills: { subscribe: skillList.subscribe },
	loadSkills: (...a: unknown[]) => loadSkills(...a),
}));

const loadProjects = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadProjects: (...a: unknown[]) => loadProjects(...a),
}));

const { projects } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { effortsOf, permissionModesOf } = await import(
	"$lib/components/home/agents/cli-options"
);
const { default: AgentsSection } = await import(
	"$lib/components/home/agents/AgentsSection.svelte"
);

function agent(overrides: Partial<NativeAgent> = {}): NativeAgent {
	return {
		id: "reviewer",
		name: "reviewer",
		description: "Reviews the diff",
		model: "",
		effort: "",
		permissionMode: "",
		memory: "",
		skills: [],
		color: "",
		tools: [],
		extraFrontmatter: "",
		systemPrompt: "You review code.",
		scope: "global",
		projectId: "",
		projectName: "",
		path: "/agents/reviewer.md",
		locations: [{ path: "/agents/reviewer.md" }],
		providers: ["claude-code"],
		divergent: false,
		...overrides,
	} as NativeAgent;
}

function mount() {
	render(AgentsSection, { props: {} });
}

const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ag-item"));
const itemNames = () =>
	items().map((i) => i.querySelector(".ag-item-name")?.textContent?.trim());
const itemFor = (name: string) =>
	items().find((i) =>
		i.querySelector(".ag-item-name")?.textContent?.includes(name),
	) as HTMLElement;
const nameField = () =>
	document.querySelector(".name-input") as HTMLInputElement;
const descriptionField = () =>
	document.getElementById("ag-desc") as HTMLTextAreaElement;
const promptField = () =>
	document.getElementById("ag-prompt") as HTMLTextAreaElement;
const saveButton = () =>
	document.querySelector(".save-bar .btn.primary") as HTMLButtonElement;
const revertButton = () =>
	document.querySelector(".save-bar .btn.ghost") as HTMLButtonElement;
const searchField = () =>
	document.querySelector(".ag-master input") as HTMLInputElement;
const chips = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".filters .chip"));
const chipBy = (re: RegExp) =>
	chips().find((c) => re.test(c.textContent ?? "")) as HTMLElement;
const chipsIn = (list: string) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(`${list} .tool-chip code`),
	).map((c) => c.textContent);
const banners = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".banner")).map(
		(b) => b.textContent ?? "",
	);
const savedPayload = () =>
	saveNativeAgent.mock.calls[0]?.[0] as Record<string, unknown>;
const inputWithList = (list: string) =>
	document.querySelector(`input[list="${list}"]`) as HTMLInputElement;
/** Skills, memory and the raw frontmatter live behind the Advanced heading. */
async function openAdvanced() {
	await userEvent.click(
		document.querySelector(".ag-group-title.advanced") as HTMLElement,
	);
	await settle();
}

async function settle() {
	for (let i = 0; i < 10; i++) await tick();
}

beforeEach(() => {
	saveNativeAgent.mockReset().mockResolvedValue(["/agents/reviewer.md"]);
	deleteNativeAgent.mockReset().mockResolvedValue(undefined);
	duplicateNativeAgent
		.mockReset()
		.mockResolvedValue("/agents/reviewer-copy.md");
	revealInFileManager.mockReset().mockResolvedValue(undefined);
	reachedProviders.mockReset().mockResolvedValue(["claude-code"]);
	loadNativeAgents.mockReset().mockResolvedValue(undefined);
	loadCliProviders.mockReset().mockResolvedValue(undefined);
	loadSkills.mockReset().mockResolvedValue(undefined);
	loadProjects.mockReset().mockResolvedValue(undefined);
	nativeAgentsError.set("");
	nativeAgentsLoading.set(false);
	cliProviders.set([{ id: "claude-code", label: "Claude Code" }]);
	skillList.set([]);
	projects.set([project("p1")]);
	nativeAgents.set([agent()]);
});

describe("AgentsSection", () => {
	describe("the list", () => {
		it("loads the agents on open", async () => {
			mount();
			await settle();
			expect(loadNativeAgents).toHaveBeenCalled();
		});

		it("lists every agent it found", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer" }),
				agent({ path: "/b", name: "tester" }),
			]);
			mount();
			await settle();
			expect(itemNames()).toHaveLength(2);
		});

		it("opens the agent that was clicked", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer" }),
				agent({ path: "/b", name: "tester" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("tester"));
			await settle();
			expect(nameField().value).toBe("tester");
		});

		it("keeps only the agents the search matched", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer" }),
				agent({ path: "/b", name: "tester" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "test");
			await settle();
			expect(itemNames()).toEqual(["tester"]);
		});

		/** The description is searchable too, not only the name. */
		it("matches on the description", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer", description: "checks diffs" }),
				agent({ path: "/b", name: "tester", description: "runs suites" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "suites");
			await settle();
			expect(itemNames()).toEqual(["tester"]);
		});

		it("keeps only the agents of the chosen scope", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "global-one", scope: "global" }),
				agent({
					path: "/b",
					name: "project-one",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(chipBy(/project/i));
			await settle();
			expect(itemNames()).toEqual(["project-one"]);
		});

		it("counts the agents of each scope", async () => {
			nativeAgents.set([
				agent({ path: "/a", scope: "global" }),
				agent({ path: "/b", scope: "global" }),
				agent({ path: "/c", scope: "project", projectId: "p1" }),
			]);
			mount();
			await settle();
			expect(chipBy(/all/i).textContent).toContain("3");
		});

		it("keeps only the agents of the chosen provider", async () => {
			cliProviders.set([
				{ id: "claude-code", label: "Claude Code" },
				{ id: "codex", label: "Codex" },
			]);
			nativeAgents.set([
				agent({ path: "/a", name: "for-claude", providers: ["claude-code"] }),
				agent({ path: "/b", name: "for-codex", providers: ["codex"] }),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.filters.agents .chip[title="Codex"]',
				) as HTMLElement,
			);
			await settle();
			expect(itemNames()).toEqual(["for-codex"]);
		});

		it("says when nothing matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "zzzz");
			await settle();
			expect(document.querySelector(".ag-master-empty")).not.toBeNull();
		});
	});

	describe("editing a draft", () => {
		/** The editor holds its own copy: nothing is written before Save. */
		it("writes nothing while the draft is edited", async () => {
			mount();
			await settle();
			await userEvent.type(nameField(), "-extra");
			await settle();
			expect(saveNativeAgent).not.toHaveBeenCalled();
		});

		it("saves the edited draft", async () => {
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "New instructions");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				name: "reviewer",
				systemPrompt: "New instructions",
			});
		});

		it("drops the edits on revert", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(revertButton());
			await settle();
			expect(nameField().value).toBe("reviewer");
			expect(saveNativeAgent).not.toHaveBeenCalled();
		});

		it("refuses to save an agent with no name", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("saves nothing unnamed even when the button is forced", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			await settle();
			expect(saveNativeAgent).not.toHaveBeenCalled();
		});

		/** Two agents of the same scope cannot share a name. */
		it("refuses a name another agent of the same scope has", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer" }),
				agent({ path: "/b", name: "tester" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("tester"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "reviewer");
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("allows a name another scope already uses", async () => {
			nativeAgents.set([
				agent({ path: "/a", name: "reviewer", scope: "global" }),
				agent({
					path: "/b",
					name: "tester",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("tester"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "reviewer");
			await settle();
			expect(saveButton().disabled).toBe(false);
		});

		it("says the description is too long", async () => {
			mount();
			await settle();
			descriptionField().value = "x".repeat(3000);
			descriptionField().dispatchEvent(new Event("input", { bubbles: true }));
			await settle();
			expect(document.querySelector(".counter.bad")).not.toBeNull();
		});

		it("reports a save that failed", async () => {
			saveNativeAgent.mockRejectedValue(new Error("read only volume"));
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(banners().join(" ")).toContain("read only volume");
		});

		it("warns when the copies on disk have diverged", async () => {
			nativeAgents.set([agent({ divergent: true })]);
			mount();
			await settle();
			expect(document.querySelector(".banner.warn")).not.toBeNull();
		});

		/** A project-scoped agent carries its project's path. */
		it("resolves the project path of a project agent", async () => {
			projects.set([project("p1", { path: "/repo" })]);
			nativeAgents.set([agent({ scope: "project", projectId: "p1" })]);
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				projectId: "p1",
				projectPath: "/repo",
			});
		});

		/** A global agent belongs to no project. */
		it("drops the project of a global agent", async () => {
			nativeAgents.set([agent({ scope: "global", projectId: "p1" })]);
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				projectId: "",
				projectPath: "",
			});
		});
	});

	describe("creating a new agent", () => {
		it("starts a blank draft", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New agent"]',
				) as HTMLElement,
			);
			await settle();
			expect(nameField().value).toBe("");
		});

		it("creates it at no previous location", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New agent"]',
				) as HTMLElement,
			);
			await settle();
			await userEvent.type(nameField(), "fresh");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ originalPaths: [] });
		});

		/** Saving an existing agent tells the service where its copies were. */
		it("saves an existing agent over its own locations", async () => {
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				originalPaths: ["/agents/reviewer.md"],
			});
		});
	});

	describe("the tools and skills", () => {
		it("adds the tool that was typed", async () => {
			mount();
			await settle();
			await userEvent.type(inputWithList("agent-tools"), "Bash{Enter}");
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ tools: ["Bash"] });
		});

		it("adds a tool once", async () => {
			nativeAgents.set([agent({ tools: ["Bash", "Read"] })]);
			mount();
			await settle();
			await userEvent.type(inputWithList("agent-tools"), "Bash{Enter}");
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ tools: ["Bash", "Read"] });
		});

		it("adds no blank tool", async () => {
			mount();
			await settle();
			await userEvent.type(inputWithList("agent-tools"), "   {Enter}");
			await settle();
			expect(chipsIn(".ag-detail")).toEqual([]);
		});

		it("removes the tool that was asked for", async () => {
			nativeAgents.set([agent({ tools: ["Bash", "Read"] })]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".tool-chip button") as HTMLElement,
			);
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ tools: ["Read"] });
		});

		/** The skill picker only offers skills that exist on disk. */
		it("offers only the skills that exist", async () => {
			skillList.set([{ name: "review" }, { name: "deploy" }]);
			mount();
			await settle();
			await openAdvanced();
			const options = Array.from(
				document.querySelectorAll<HTMLOptionElement>(
					"datalist#agent-skills option",
				),
			).map((o) => o.value);
			expect(options).toEqual(["deploy", "review"]);
		});

		/** A skill already added is not offered again. */
		it("offers no skill the agent already has", async () => {
			skillList.set([{ name: "review" }, { name: "deploy" }]);
			nativeAgents.set([agent({ skills: ["review"] })]);
			mount();
			await settle();
			await openAdvanced();
			const options = Array.from(
				document.querySelectorAll<HTMLOptionElement>(
					"datalist#agent-skills option",
				),
			).map((o) => o.value);
			expect(options).toEqual(["deploy"]);
		});

		it("saves the skills it was given", async () => {
			nativeAgents.set([agent({ skills: ["review"] })]);
			mount();
			await settle();
			await userEvent.clear(promptField());
			await userEvent.type(promptField(), "edited");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ skills: ["review"] });
		});
	});

	describe("duplicating and deleting", () => {
		it("duplicates the open agent", async () => {
			mount();
			await settle();
			const duplicate = Array.from(
				document.querySelectorAll<HTMLElement>(".head-actions button"),
			).find((b) => /duplicate|dupliquer/i.test(b.getAttribute("title") ?? ""));
			await userEvent.click(duplicate as HTMLElement);
			await settle();
			expect(duplicateNativeAgent).toHaveBeenCalledWith(
				"/agents/reviewer.md",
				expect.stringContaining("reviewer"),
			);
		});

		it("asks before deleting", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".ag-master .icon-btn.delete") as HTMLElement,
			);
			await settle();
			expect(deleteNativeAgent).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		/** Every copy on disk goes, not only the one that was opened. */
		it("deletes every copy of the agent", async () => {
			nativeAgents.set([
				agent({
					locations: [
						{ path: "/agents/reviewer.md" },
						{ path: "/other/reviewer.md" },
					] as NativeAgent["locations"],
				}),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".ag-master .icon-btn.delete") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(deleteNativeAgent).toHaveBeenCalledWith([
				"/agents/reviewer.md",
				"/other/reviewer.md",
			]);
		});
	});

	describe("the option vocabularies", () => {
		/**
		 * Declared by the registry rather than probed: Cairn no longer runs a
		 * provider to ask what it accepts, so a definition's fields are filled
		 * from the CLI's own documented flags.
		 */
		it("gives every CLI a permission vocabulary, and efforts only where they exist", () => {
			// Claude Code states an approval mode, Codex the sandbox its tools run
			// in: offering one CLI's words for the other would be silently wrong.
			expect(permissionModesOf("claude-code")).toContain("acceptEdits");
			expect(permissionModesOf("codex")).toContain("read-only");
			expect(permissionModesOf("claude-code")).not.toContain("read-only");

			expect(effortsOf("claude-code").length).toBeGreaterThan(0);
			expect(effortsOf("opencode")).toEqual([]);
		});
	});
});
