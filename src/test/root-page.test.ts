import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/components/Home.svelte", async () => ({
	default: (await import("./stubs/HomeStub.svelte")).default,
}));
vi.mock("$lib/components/Workspace.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/CreateInstance.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/layout/UpdateModal.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));
vi.mock("$lib/components/layout/LoadingScreen.svelte", async () => ({
	default: (await import("./stubs/WorkspaceStub.svelte")).default,
}));

const listen = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...a: unknown[]) => listen(...a),
}));

const takePendingCliPaths = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/cli-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	takePendingCliPaths: (...a: unknown[]) => takePendingCliPaths(...a),
}));

const getUiState = vi.fn<(...a: unknown[]) => unknown>();
const saveUiState = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/ui-state-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getUiState: (...a: unknown[]) => getUiState(...a),
	saveUiState: (...a: unknown[]) => saveUiState(...a),
}));

const listInstances = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/instance-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listInstances: (...a: unknown[]) => listInstances(...a),
}));

const loadInstances = vi.fn<(...a: unknown[]) => unknown>();
const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadInstances: (...a: unknown[]) => loadInstances(...a),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const watchInstance = vi.fn<(...a: unknown[]) => unknown>();
const unwatchInstance = vi.fn<(...a: unknown[]) => unknown>();
const bindingsByProject = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	init: vi.fn((..._a: unknown[]) => undefined),
	dispose: vi.fn((..._a: unknown[]) => undefined),
	loadProjectIntegrations: vi.fn(async (..._a: unknown[]) => undefined),
	watchInstance: (...a: unknown[]) => watchInstance(...a),
	unwatchInstance: (...a: unknown[]) => unwatchInstance(...a),
	bindingsByProject: { subscribe: bindingsByProject.subscribe },
}));

const stopServersForWorktree = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/language-server", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	initLanguageServers: vi.fn((..._a: unknown[]) => undefined),
	disposeLanguageServers: vi.fn((..._a: unknown[]) => undefined),
	stopServersForWorktree: (...a: unknown[]) => stopServersForWorktree(...a),
}));

vi.mock("$lib/stores/tests", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	initTests: vi.fn((..._a: unknown[]) => undefined),
	disposeTests: vi.fn((..._a: unknown[]) => undefined),
}));

vi.mock("$lib/stores/terminal", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	initTerminals: vi.fn((..._a: unknown[]) => undefined),
}));

vi.mock("$lib/stores/update", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isUpdateModalOpen: { subscribe: writable(false).subscribe },
	startUpdateChecks: vi.fn(() => () => {}),
}));

const loadProjects = vi.fn<(...a: unknown[]) => unknown>();
const loadListing = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadProjects: (...a: unknown[]) => loadProjects(...a),
	loadListing: (...a: unknown[]) => loadListing(...a),
}));

const settingsLoad = vi.fn<(...a: unknown[]) => unknown>();
const settingsState = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: {
		subscribe: settingsState.subscribe,
		load: (...a: unknown[]) => settingsLoad(...a),
	},
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { activeScreen } = await import("$lib/stores/ui");
const { project } = await import("./fixtures");
const { default: Page } = await import("../routes/+page.svelte");

/** The persisted UI state a launch restores from. */
function savedState(overrides: Record<string, unknown> = {}) {
	return {
		screen: "home",
		activeProjectId: null,
		openTabOrder: [],
		homeSection: "projects",
		homeSettingsTab: "general",
		projectStates: {},
		...overrides,
	};
}

const home = () => document.querySelector("[data-home]") as HTMLElement;
const workspace = () =>
	document.querySelector("[data-workspace]") as HTMLElement | null;
const homeVisible = () =>
	!(
		home()?.closest(".screen-wrap")?.classList.contains("screen-hidden") ?? true
	);
const workspaceVisible = () => {
	const wrap = document.querySelectorAll(".screen-wrap")[1];
	return !wrap?.classList.contains("screen-hidden");
};

async function settle() {
	for (let i = 0; i < 20; i++) {
		await tick();
		await Promise.resolve();
	}
}

beforeEach(() => {
	vi.useRealTimers();
	listen.mockReset().mockResolvedValue(() => {});
	takePendingCliPaths
		.mockReset()
		.mockResolvedValue({ paths: [], openDir: null, cloneUrl: null });
	getUiState.mockReset().mockResolvedValue(savedState());
	saveUiState.mockReset().mockResolvedValue(undefined);
	listInstances.mockReset().mockResolvedValue([]);
	loadInstances.mockReset().mockResolvedValue(undefined);
	loadProjects.mockReset().mockResolvedValue(undefined);
	loadListing.mockReset().mockResolvedValue(undefined);
	settingsLoad.mockReset().mockResolvedValue(undefined);
	watchInstance.mockReset().mockResolvedValue(undefined);
	unwatchInstance.mockReset().mockResolvedValue(undefined);
	stopServersForWorktree.mockReset().mockResolvedValue(undefined);
	settingsState.set({ workflowTabs: [] });
	bindingsByProject.set({});
	activeInstance.set(null);
	projects.set([
		project("p1", { name: "Alpha", path: "/repos/alpha" }),
		project("p2", { name: "Beta", path: "/repos/beta" }),
	]);
	activeProjectId.set(null);
});

describe("application root", () => {
	describe("restoring the last session", () => {
		it("reads the persisted state on launch", async () => {
			render(Page);
			await settle();
			expect(getUiState).toHaveBeenCalled();
			expect(loadProjects).toHaveBeenCalled();
			expect(loadListing).toHaveBeenCalled();
		});

		it("reopens on the home screen it was left on", async () => {
			render(Page);
			await settle();
			expect(homeVisible()).toBe(true);
			expect(workspaceVisible()).toBe(false);
		});

		/** A session left in the workspace comes back to the workspace. */
		it("reopens on the workspace it was left on", async () => {
			getUiState.mockResolvedValue(
				savedState({ screen: "workspace", activeProjectId: "p1" }),
			);
			render(Page);
			await settle();
			expect(workspaceVisible()).toBe(true);
			expect(homeVisible()).toBe(false);
		});

		it("reopens the project it was left on", async () => {
			getUiState.mockResolvedValue(
				savedState({ screen: "workspace", activeProjectId: "p1" }),
			);
			render(Page);
			await settle();
			expect(loadInstances).toHaveBeenCalledWith("p1");
			expect(get(activeProjectId)).toBe("p1");
		});

		/** The workspace is only pulled in once a project is opened. */
		it("loads no workspace while it stays on home", async () => {
			render(Page);
			await settle();
			expect(workspace()).toBeNull();
		});

		it("reopens the home section it was left on", async () => {
			getUiState.mockResolvedValue(
				savedState({ homeSection: "settings", homeSettingsTab: "git" }),
			);
			render(Page);
			await settle();
			expect(home().getAttribute("data-open-section")).toBe("settings");
			expect(home().getAttribute("data-open-settings-tab")).toBe("git");
		});

		it("publishes the screen it settled on", async () => {
			getUiState.mockResolvedValue(
				savedState({ screen: "workspace", activeProjectId: "p1" }),
			);
			render(Page);
			await settle();
			expect(get(activeScreen)).toBe("workspace");
		});
	});

	describe("moving between the screens", () => {
		it("goes to the workspace when a project is opened", async () => {
			render(Page);
			await settle();
			await userEvent.click(
				document.querySelector(".stub-open-project") as HTMLElement,
			);
			await settle();
			expect(workspaceVisible()).toBe(true);
			expect(get(activeProjectId)).toBe("p1");
		});

		/** Closing the last project goes back home and clears the selection. */
		it("goes home when the last project is closed", async () => {
			render(Page);
			await settle();
			await userEvent.click(
				document.querySelector(".stub-open-project") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".stub-close-project") as HTMLElement,
			);
			await settle();
			expect(homeVisible()).toBe(true);
			expect(get(activeProjectId)).toBeNull();
		});

		/** A closed project takes its language servers down with it. */
		it("stops the language servers of a closed project", async () => {
			listInstances.mockResolvedValue([
				{ id: "i1", worktreePath: "/wt/i1" },
				{ id: "i2", worktreePath: "" },
			]);
			render(Page);
			await settle();
			await userEvent.click(
				document.querySelector(".stub-open-project") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".stub-close-project") as HTMLElement,
			);
			await settle();
			expect(stopServersForWorktree).toHaveBeenCalledTimes(1);
			expect(stopServersForWorktree).toHaveBeenCalledWith("/wt/i1");
		});
	});

	describe("persisting what is on screen", () => {
		it("writes the state after a change has settled", async () => {
			render(Page);
			await settle();
			saveUiState.mockClear();
			vi.useFakeTimers();
			(document.querySelector(".stub-section-change") as HTMLElement).click();
			await vi.advanceTimersByTimeAsync(300);
			expect(saveUiState).toHaveBeenCalledTimes(1);
			expect(saveUiState.mock.calls[0][0]).toMatchObject({
				homeSection: "settings",
				homeSettingsTab: "git",
			});
		});

		/**
		 * Writes are debounced: a change inside an open window pushes the write
		 * out rather than adding one. Note that `persistUiState` is also called
		 * from every store subscription, so a burst of clicks alone would look
		 * the same either way - the window has to be nearly elapsed first.
		 */
		it("pushes the write out when a change arrives mid-window", async () => {
			render(Page);
			await settle();
			saveUiState.mockClear();
			vi.useFakeTimers();
			const button = document.querySelector(
				".stub-section-change",
			) as HTMLElement;
			button.click();
			await vi.advanceTimersByTimeAsync(200);
			button.click();
			await vi.advanceTimersByTimeAsync(200);
			expect(saveUiState).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(100);
			expect(saveUiState).toHaveBeenCalledTimes(1);
		});

		it("writes again for a change after the window", async () => {
			render(Page);
			await settle();
			saveUiState.mockClear();
			vi.useFakeTimers();
			const button = document.querySelector(
				".stub-section-change",
			) as HTMLElement;
			button.click();
			await vi.advanceTimersByTimeAsync(300);
			(
				document.querySelector(".stub-section-change-other") as HTMLElement
			).click();
			await vi.advanceTimersByTimeAsync(300);
			expect(saveUiState).toHaveBeenCalledTimes(2);
		});

		it("does not write again when nothing changed", async () => {
			render(Page);
			await settle();
			saveUiState.mockClear();
			vi.useFakeTimers();
			const button = document.querySelector(
				".stub-section-change",
			) as HTMLElement;
			button.click();
			await vi.advanceTimersByTimeAsync(300);
			button.click();
			await vi.advanceTimersByTimeAsync(300);
			expect(saveUiState).toHaveBeenCalledTimes(1);
		});
	});

	describe("what the command line asks for", () => {
		/** `cairn clone <url>` goes home with the import modal preloaded. */
		it("preloads the clone modal for a clone url", async () => {
			takePendingCliPaths.mockResolvedValue({
				paths: [],
				openDir: null,
				cloneUrl: "https://host/repo.git",
			});
			render(Page);
			await settle();
			expect(homeVisible()).toBe(true);
			expect(home().getAttribute("data-add-mode")).toBe("clone");
			expect(home().getAttribute("data-add-clone-url")).toBe(
				"https://host/repo.git",
			);
		});

		/** `cairn .` on a known folder opens that project directly. */
		it("opens a directory already registered as a project", async () => {
			takePendingCliPaths.mockResolvedValue({
				paths: [],
				openDir: "/repos/beta",
				cloneUrl: null,
			});
			render(Page);
			await settle();
			expect(get(activeProjectId)).toBe("p2");
			expect(workspaceVisible()).toBe(true);
		});

		/** An unknown folder goes home with the open modal preloaded. */
		it("preloads the open modal for an unknown directory", async () => {
			takePendingCliPaths.mockResolvedValue({
				paths: [],
				openDir: "/elsewhere",
				cloneUrl: null,
			});
			render(Page);
			await settle();
			expect(homeVisible()).toBe(true);
			expect(home().getAttribute("data-add-mode")).toBe("open");
			expect(home().getAttribute("data-add-path")).toBe("/elsewhere");
		});

		/**
		 * `cairn <file>` reopens the last project so the editor has somewhere to
		 * go, and hands the paths to the workspace once it exists.
		 */
		it("reopens a project to receive the files it was given", async () => {
			takePendingCliPaths.mockResolvedValue({
				paths: ["/repos/alpha/src/a.ts"],
				openDir: null,
				cloneUrl: null,
			});
			render(Page);
			await settle();
			expect(workspaceVisible()).toBe(true);
			expect(get(activeProjectId)).not.toBeNull();
			expect(workspace()).not.toBeNull();
		});

		/**
		 * From the home screen the workspace has to be shown for the paths. The
		 * reopen already switches screens on this path, so `handleCliPaths`'s own
		 * assignment is a second line of defence rather than the one that fires.
		 */
		it("shows the workspace for the files it was given", async () => {
			getUiState.mockResolvedValue(savedState({ screen: "home" }));
			takePendingCliPaths.mockResolvedValue({
				paths: ["/repos/alpha/src/a.ts"],
				openDir: null,
				cloneUrl: null,
			});
			render(Page);
			await settle();
			expect(homeVisible()).toBe(false);
			expect(workspaceVisible()).toBe(true);
		});

		it("opens nothing when the command line named nothing", async () => {
			render(Page);
			await settle();
			expect(homeVisible()).toBe(true);
			expect(home().getAttribute("data-add-mode")).toBe("");
		});

		it("listens for later command line requests", async () => {
			render(Page);
			await settle();
			expect(listen).toHaveBeenCalledWith("cli-open", expect.any(Function));
		});
	});

	describe("watching the instance on screen", () => {
		/** One watched instance at a time, and none from the home screen. */
		it("watches nothing while it is on home", async () => {
			activeInstance.set({
				id: "i1",
				projectId: "p1",
				branch: "feature",
			});
			render(Page);
			await settle();
			expect(watchInstance).not.toHaveBeenCalled();
		});

		it("watches the instance shown in the workspace", async () => {
			getUiState.mockResolvedValue(
				savedState({ screen: "workspace", activeProjectId: "p1" }),
			);
			activeInstance.set({
				id: "i1",
				projectId: "p1",
				branch: "feature",
			});
			render(Page);
			await settle();
			expect(watchInstance).toHaveBeenCalledWith("p1", "i1", "feature");
		});

		it("drops the previous watch when the instance changes", async () => {
			getUiState.mockResolvedValue(
				savedState({ screen: "workspace", activeProjectId: "p1" }),
			);
			activeInstance.set({ id: "i1", projectId: "p1", branch: "feature" });
			render(Page);
			await settle();
			activeInstance.set({ id: "i2", projectId: "p1", branch: "other" });
			await settle();
			expect(unwatchInstance).toHaveBeenCalledWith("p1", "i1");
			expect(watchInstance).toHaveBeenCalledWith("p1", "i2", "other");
		});
	});
});
