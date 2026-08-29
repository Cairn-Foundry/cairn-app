import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpProbe, McpServer } from "$lib/services/mcp-service";

const saveMcpServer = vi.fn<(...a: unknown[]) => unknown>();
const deleteMcpServer = vi.fn<(...a: unknown[]) => unknown>();
const testMcpServer = vi.fn<(...a: unknown[]) => unknown>();
const setMcpApproval = vi.fn<(...a: unknown[]) => unknown>();
const exportMcpServers = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/mcp-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveMcpServer: (...a: unknown[]) => saveMcpServer(...a),
	deleteMcpServer: (...a: unknown[]) => deleteMcpServer(...a),
	testMcpServer: (...a: unknown[]) => testMcpServer(...a),
	setMcpApproval: (...a: unknown[]) => setMcpApproval(...a),
	exportMcpServers: (...a: unknown[]) => exportMcpServers(...a),
}));

const writeFile = vi.fn<(...a: unknown[]) => unknown>();
const revealInFileManager = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	writeFile: (...a: unknown[]) => writeFile(...a),
	revealInFileManager: (...a: unknown[]) => revealInFileManager(...a),
}));

const saveDialog = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...a: unknown[]) => saveDialog(...a),
	open: vi.fn(async (..._a: unknown[]) => null),
}));

const reachedProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	reachedProviders: (...a: unknown[]) => reachedProviders(...a),
}));

const mcpServers = writable<McpServer[]>([]);
const mcpError = writable("");
const mcpLoading = writable(false);
const loadMcpServers = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/mcp", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	mcpServers: { subscribe: mcpServers.subscribe },
	mcpError: { subscribe: mcpError.subscribe },
	mcpLoading: { subscribe: mcpLoading.subscribe },
	loadMcpServers: (...a: unknown[]) => loadMcpServers(...a),
}));

const cliProviders = writable<
	{ id: string; label: string; hasLocalScope: boolean }[]
>([]);
const loadCliProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/cli-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	cliProviders: { subscribe: cliProviders.subscribe },
	loadCliProviders: (...a: unknown[]) => loadCliProviders(...a),
}));

const loadProjects = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadProjects: (...a: unknown[]) => loadProjects(...a),
}));

const { projects } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: McpSection } = await import(
	"$lib/components/home/mcp/McpSection.svelte"
);

function server(overrides: Partial<McpServer> = {}): McpServer {
	return {
		id: "user::files",
		name: "files",
		scope: "user",
		projectId: "",
		projectName: "",
		projectPath: "",
		transport: "stdio",
		command: "npx",
		args: ["-y", "server-files"],
		env: {},
		url: "",
		headers: {},
		enabled: true,
		approval: "",
		targets: ["claude-code"],
		locations: [],
		providers: ["claude-code"],
		divergent: false,
		sourcePath: "/config/mcp.json",
		...overrides,
	} as McpServer;
}

function probe(overrides: Partial<McpProbe> = {}): McpProbe {
	return {
		ok: true,
		error: "",
		serverName: "files",
		serverVersion: "1.0.0",
		protocolVersion: "2024-11-05",
		tools: [{ name: "read", description: "" }] as McpProbe["tools"],
		promptCount: 0,
		resourceCount: 0,
		durationMs: 42,
		partial: false,
		logs: "",
		...overrides,
	};
}

function mount() {
	render(McpSection, { props: {} });
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
const commandField = () =>
	document.getElementById("mcp-command") as HTMLInputElement | null;
const urlField = () =>
	document.getElementById("mcp-url") as HTMLInputElement | null;
const argsField = () =>
	document.getElementById("mcp-args") as HTMLTextAreaElement;
const saveButton = () =>
	document.querySelector(".save-bar .btn.primary") as HTMLButtonElement;
const searchField = () =>
	document.querySelector(".ag-master input") as HTMLInputElement;
const chips = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".filters .chip"));
const chipBy = (re: RegExp) =>
	chips().find((c) => re.test(c.textContent ?? "")) as HTMLElement;
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const banners = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".banner")).map(
		(b) => b.textContent ?? "",
	);
const savedPayload = () => saveMcpServer.mock.calls[0]?.[1] as McpServer;

async function settle() {
	for (let i = 0; i < 10; i++) await tick();
}

beforeEach(() => {
	saveMcpServer.mockReset().mockResolvedValue(undefined);
	deleteMcpServer.mockReset().mockResolvedValue(undefined);
	testMcpServer.mockReset().mockResolvedValue(probe());
	setMcpApproval.mockReset().mockResolvedValue(undefined);
	exportMcpServers.mockReset().mockResolvedValue('{"servers":[]}');
	writeFile.mockReset().mockResolvedValue(undefined);
	revealInFileManager.mockReset().mockResolvedValue(undefined);
	saveDialog.mockReset().mockResolvedValue("/out/mcp-servers.json");
	reachedProviders.mockReset().mockResolvedValue(["claude-code"]);
	loadMcpServers.mockReset().mockResolvedValue(undefined);
	loadCliProviders.mockReset().mockResolvedValue(undefined);
	loadProjects.mockReset().mockResolvedValue(undefined);
	mcpError.set("");
	mcpLoading.set(false);
	cliProviders.set([
		{ id: "claude-code", label: "Claude Code", hasLocalScope: true },
	]);
	projects.set([project("p1")]);
	mcpServers.set([server()]);
});

describe("McpSection", () => {
	describe("the list", () => {
		it("loads the servers on open", async () => {
			mount();
			await settle();
			expect(loadMcpServers).toHaveBeenCalled();
		});

		it("lists every server it found", async () => {
			mcpServers.set([
				server({ id: "a", name: "files" }),
				server({ id: "b", name: "search" }),
			]);
			mount();
			await settle();
			expect(itemNames()).toHaveLength(2);
		});

		it("opens the server that was clicked", async () => {
			mcpServers.set([
				server({ id: "a", name: "files" }),
				server({ id: "b", name: "search" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("search"));
			await settle();
			expect(nameField().value).toBe("search");
		});

		it("keeps only the servers the search matched", async () => {
			mcpServers.set([
				server({ id: "a", name: "files" }),
				server({ id: "b", name: "search" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "sear");
			await settle();
			expect(itemNames()).toEqual(["search"]);
		});

		/** The command is searchable too, not only the name. */
		it("matches on the command", async () => {
			mcpServers.set([
				server({ id: "a", name: "files", command: "npx" }),
				server({ id: "b", name: "search", command: "uvx" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "uvx");
			await settle();
			expect(itemNames()).toEqual(["search"]);
		});

		it("keeps only the servers of the chosen scope", async () => {
			mcpServers.set([
				server({ id: "a", name: "global-one", scope: "user" }),
				server({
					id: "b",
					name: "project-one",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(chipBy(/^This project, shared/));
			await settle();
			expect(itemNames()).toEqual(["project-one"]);
		});

		it("counts the servers of each scope", async () => {
			mcpServers.set([
				server({ id: "a", scope: "user" }),
				server({ id: "b", scope: "user" }),
				server({ id: "c", scope: "project", projectId: "p1" }),
			]);
			mount();
			await settle();
			expect(chipBy(/all/i).textContent).toContain("3");
		});

		it("keeps only the servers of the chosen agent", async () => {
			cliProviders.set([
				{ id: "claude-code", label: "Claude Code", hasLocalScope: true },
				{ id: "codex", label: "Codex", hasLocalScope: false },
			]);
			mcpServers.set([
				server({ id: "a", name: "for-claude", providers: ["claude-code"] }),
				server({ id: "b", name: "for-codex", providers: ["codex"] }),
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
			expect(saveMcpServer).not.toHaveBeenCalled();
		});

		it("saves the edited draft", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ name: "renamed" });
		});

		/** The name is trimmed, so a stray space cannot make two entries. */
		it("saves the name trimmed", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "  spaced  ");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ name: "spaced" });
		});

		/** Arguments are edited as lines and stored as a list. */
		it("splits the arguments into a list", async () => {
			mount();
			await settle();
			await userEvent.clear(argsField());
			await userEvent.type(argsField(), "-y{Enter}server-x{Enter}   ");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload().args).toEqual(["-y", "server-x"]);
		});

		it("refuses to save a server with no name", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		/** A stdio server needs a command; a remote one needs a url. */
		it("refuses a stdio server with no command", async () => {
			mcpServers.set([server({ command: "" })]);
			mount();
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("refuses a remote server with no url", async () => {
			mcpServers.set([server({ transport: "http", command: "", url: "" })]);
			mount();
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("allows a remote server with a url", async () => {
			mcpServers.set([
				server({
					transport: "http",
					command: "",
					url: "https://mcp.example.com",
				}),
			]);
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "remote");
			await settle();
			expect(saveButton().disabled).toBe(false);
		});

		it("saves nothing incomplete even when the button is forced", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			await settle();
			expect(saveMcpServer).not.toHaveBeenCalled();
		});

		/** Two servers of the same scope cannot share a name. */
		it("refuses a name another server of the same scope has", async () => {
			mcpServers.set([
				server({ id: "a", name: "files" }),
				server({ id: "b", name: "search" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("search"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "files");
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("allows a name another scope already uses", async () => {
			mcpServers.set([
				server({ id: "a", name: "files", scope: "user" }),
				server({
					id: "b",
					name: "search",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("search"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "files");
			await settle();
			expect(saveButton().disabled).toBe(false);
		});

		it("reports a save that failed", async () => {
			saveMcpServer.mockRejectedValue(new Error("permission denied"));
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(saveButton());
			await settle();
			expect(banners().join(" ")).toContain("permission denied");
		});

		/** A project-scoped server needs a project to belong to. */
		it("resolves the project path of a project server", async () => {
			projects.set([project("p1", { path: "/repo" })]);
			mcpServers.set([
				server({
					id: "b",
					name: "search",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				projectId: "p1",
				projectPath: "/repo",
			});
		});

		/** A user-scoped server belongs to no project. */
		it("drops the project of a user-scoped server", async () => {
			mcpServers.set([
				server({ scope: "user", projectId: "p1", projectPath: "/repo" }),
			]);
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				projectId: "",
				projectPath: "",
			});
		});
	});

	describe("creating and duplicating", () => {
		it("starts a blank draft", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New server"]',
				) as HTMLElement,
			);
			await settle();
			expect(nameField().value).toBe("");
		});

		/** A copy is a draft, never written until saved. */
		it("copies a server into an unsaved draft", async () => {
			mount();
			await settle();
			const duplicate = Array.from(
				document.querySelectorAll<HTMLElement>(".head-actions button"),
			).find((b) => /duplicate|dupliquer/i.test(b.getAttribute("title") ?? ""));
			await userEvent.click(duplicate as HTMLElement);
			await settle();
			expect(nameField().value).toContain("files");
			expect(saveMcpServer).not.toHaveBeenCalled();
		});

		/**
		 * A copy is a new entry, so saving it must not be told to overwrite the
		 * server it was copied from.
		 */
		it("saves the copy as a new entry, not over the original", async () => {
			mount();
			await settle();
			const duplicate = Array.from(
				document.querySelectorAll<HTMLElement>(".head-actions button"),
			).find((b) => /duplicate|dupliquer/i.test(b.getAttribute("title") ?? ""));
			await userEvent.click(duplicate as HTMLElement);
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(saveMcpServer.mock.calls[0][0]).toBeNull();
		});

		/** The copy has not been trusted: its approval does not carry over. */
		it("drops the approval of the server it copied", async () => {
			mcpServers.set([server({ approval: "approved" })]);
			mount();
			await settle();
			const duplicate = Array.from(
				document.querySelectorAll<HTMLElement>(".head-actions button"),
			).find((b) => /duplicate|dupliquer/i.test(b.getAttribute("title") ?? ""));
			await userEvent.click(duplicate as HTMLElement);
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ approval: "" });
		});
	});

	describe("testing a server", () => {
		/** The draft is probed, not the saved entry, so an edit can be checked. */
		it("probes the draft as it stands", async () => {
			mount();
			await settle();
			await userEvent.clear(argsField());
			await userEvent.type(argsField(), "--edited");
			await userEvent.click(buttonBy(/test|tester/i));
			await settle();
			expect(testMcpServer).toHaveBeenCalledTimes(1);
			expect((testMcpServer.mock.calls[0][0] as McpServer).args).toEqual([
				"--edited",
			]);
		});

		it("shows what the probe answered", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/test|tester/i));
			await settle();
			expect(document.querySelector(".probe-head")).not.toBeNull();
			expect(document.querySelector(".probe-time")?.textContent).toContain(
				"42",
			);
		});

		it("reports a probe that threw", async () => {
			testMcpServer.mockRejectedValue(new Error("spawn failed"));
			mount();
			await settle();
			await userEvent.click(buttonBy(/test|tester/i));
			await settle();
			expect(banners().join(" ")).toContain("spawn failed");
		});

		it("cannot be tested while incomplete", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			expect(buttonBy(/test|tester/i).disabled).toBe(true);
		});

		it("lists the tools the probe found", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/test|tester/i));
			await settle();
			const toggle = document.querySelector(".probe-toggle");
			if (toggle) await userEvent.click(toggle as HTMLElement);
			await settle();
			expect(document.querySelector(".tool-list")).not.toBeNull();
		});
	});

	describe("deleting", () => {
		it("asks before deleting", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".server-row .icon-btn.delete") as HTMLElement,
			);
			await settle();
			expect(deleteMcpServer).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		it("deletes it once confirmed", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".server-row .icon-btn.delete") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(deleteMcpServer).toHaveBeenCalledTimes(1);
			expect((deleteMcpServer.mock.calls[0][0] as McpServer).name).toBe(
				"files",
			);
			expect(loadMcpServers).toHaveBeenCalled();
		});
	});

	describe("exporting", () => {
		/** Only what the filters left is exported, not the whole list. */
		it("exports the servers the filters left", async () => {
			mcpServers.set([
				server({ id: "a", name: "files", scope: "user" }),
				server({
					id: "b",
					name: "project-one",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(chipBy(/^This project, shared/));
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="Export"]',
				) as HTMLElement,
			);
			await settle();
			expect(
				(exportMcpServers.mock.calls[0][0] as McpServer[]).map((s) => s.name),
			).toEqual(["project-one"]);
		});

		it("writes the file that was chosen", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="Export"]',
				) as HTMLElement,
			);
			await settle();
			expect(writeFile).toHaveBeenCalledWith(
				"/out/mcp-servers.json",
				'{"servers":[]}',
			);
		});

		it("writes nothing when the dialog is dismissed", async () => {
			saveDialog.mockResolvedValue(null);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="Export"]',
				) as HTMLElement,
			);
			await settle();
			expect(writeFile).not.toHaveBeenCalled();
		});
	});
});
