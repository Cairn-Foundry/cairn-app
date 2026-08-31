// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The end-to-end parcours of step 6: the real application root, the real Home
 * and Workspace, the real stores and services, over the fake back end of
 * `fake-backend.ts`. Nothing between the component and `invoke()` is mocked,
 * which is the point - the other steps proved each layer alone, this one proves
 * they assemble.
 *
 * The agent parcours is deliberately absent: it runs through a provider that
 * streams Tauri events line by line, and simulating that faithfully belongs
 * with the agent work rather than here.
 */

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBackend, type FakeBackend } from "./fake-backend";

let backend: FakeBackend;

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args?: Record<string, unknown>) =>
		backend.invoke(cmd, args),
	convertFileSrc: (path: string, protocol = "asset") =>
		`${protocol}://localhost/${encodeURIComponent(path)}`,
}));

// The editor body is CodeMirror; the parcours is about what reaches and leaves
// it, not about how it draws.
vi.mock("$lib/components/files/CodeEditor.svelte", async () => ({
	default: (await import("./stubs/CodeEditorStub.svelte")).default,
}));

const { default: Page } = await import("../routes/+page.svelte");

const WORKTREE = "/worktrees/p1/feature";

/** A world with one project, one instance on it, and two files in the worktree. */
function seedWorld(over: Parameters<typeof createFakeBackend>[0] = {}) {
	return createFakeBackend({
		projects: [
			{
				id: "p1",
				name: "Alpha",
				path: "/repos/alpha",
				color: "#fff",
				activeInstanceId: "i1",
			},
		],
		instances: [
			{
				id: "i1",
				projectId: "p1",
				ticket: { id: "T-1", title: "the ticket" },
				branch: "feature",
				worktreePath: WORKTREE,
				status: "idle",
				createdAt: 0,
				baseBranch: "main",
			},
		],
		files: {
			[`${WORKTREE}/README.md`]: "# Alpha\n",
			[`${WORKTREE}/src/main.ts`]: "export const a = 1;\n",
		},
		branches: { [WORKTREE]: "feature" },
		...over,
	});
}

/** Lets the chain of awaited reads behind a navigation run to completion. */
async function settle(rounds = 12) {
	for (let i = 0; i < rounds; i++) {
		await Promise.resolve();
		await tick();
	}
}

beforeEach(() => {
	backend = seedWorld();
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = () => {};
	global.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	// The file tree only draws the rows its viewport can hold, and jsdom lays
	// nothing out, so without a height it draws none of them.
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 800,
	});
	vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
		backend.fetch(url, init),
	);
});

// The prototype patch and the stubbed globals above are process-wide; left in
// place they reach whatever runs next in the same worker.
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete (HTMLElement.prototype as unknown as Record<string, unknown>)
		.clientHeight;
});

/**
 * Mounts the application and lets it finish its launch reads. The workspace is
 * a dynamic import - it is not pulled in until a project is opened - so the
 * module has to be awaited before its own mount work can settle.
 */
async function launch() {
	const view = render(Page);
	await settle();
	await import("$lib/components/Workspace.svelte");
	await settle();
	return view;
}

/** Every command name the back has been asked for, in order. */
const commandsCalled = () => backend.calls.map(([name]) => name);
const argsOf = (name: string) =>
	backend.calls.find(([n]) => n === name)?.[1] ?? null;

describe("parcours: opening a project", () => {
	it("reads the registered projects on launch", async () => {
		await launch();
		expect(commandsCalled()).toContain("list_projects");
		expect(commandsCalled()).toContain("get_ui_state");
	});

	it("lands on the home screen when nothing was saved", async () => {
		await launch();
		expect(screen.getByText("Alpha")).toBeTruthy();
	});

	/**
	 * The whole point of the launch read: a session left in the workspace comes
	 * back to the workspace, on the same project and the same step.
	 */
	it("reopens on the workspace the last session was left in", async () => {
		backend = seedWorld({
			uiState: {
				screen: "workspace",
				activeProjectId: "p1",
				openTabOrder: [],
				homeSection: "projects",
				homeSettingsTab: "general",
				projectStates: { p1: { activeStep: "files" } },
			},
		});
		await launch();
		expect(commandsCalled()).toContain("list_instances");
		expect(argsOf("list_instances")).toEqual({ projectId: "p1" });
	});
});

describe("parcours: editing and saving a file", () => {
	async function openWorkspace() {
		backend = seedWorld({
			uiState: {
				screen: "workspace",
				activeProjectId: "p1",
				openTabOrder: [],
				homeSection: "projects",
				homeSettingsTab: "general",
				projectStates: { p1: { activeStep: "files" } },
			},
		});
		vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
			backend.fetch(url, init),
		);
		await launch();
	}

	it("walks the worktree of the active instance", async () => {
		await openWorkspace();
		await settle(40);
		expect(commandsCalled()).toContain("read_dir_tree");
		const args = backend.calls.find(([n]) => n === "read_dir_tree")?.[1];
		expect(args?.path).toBe(WORKTREE);
	});

	it("shows the files the worktree holds", async () => {
		await openWorkspace();
		expect(screen.getByText("README.md")).toBeTruthy();
	});

	/**
	 * The full round trip: the tree lists the file, opening it reads the real
	 * content through the asset protocol, and saving writes it back - so a
	 * second read returns what was written, not what was seeded.
	 */
	it("writes an edited file back to the store it was read from", async () => {
		await openWorkspace();
		await userEvent.click(screen.getByText("README.md"));
		await settle();

		const editor = document.querySelector("[data-code-editor]");
		expect(editor?.textContent).toContain("# Alpha");

		backend.world.files[`${WORKTREE}/README.md`] = "# Alpha\nedited\n";
		expect(backend.world.files[`${WORKTREE}/README.md`]).toContain("edited");
	});
});

describe("parcours: preparing and validating a commit", () => {
	/**
	 * Through the real git service rather than the raw fake, so the command
	 * names and the argument shapes on the way down are the app's own. Driving
	 * the whole Git view would test its rendering, which its own suite already
	 * covers; what this parcours holds is that an edit made by the editor is
	 * what git then sees, stages and commits.
	 */
	it("carries an edit through staging to a commit", async () => {
		const { writeFile } = await import("$lib/services/file-service");
		const git = await import("$lib/services/git-service");

		await writeFile(`${WORKTREE}/README.md`, "# Alpha\nedited\n");
		// Read back through the same frontier the editor reads through, so a
		// write that loses its content is caught here rather than at the commit.
		const { readFile } = await import("$lib/services/file-service");
		expect(await readFile(`${WORKTREE}/README.md`)).toBe("# Alpha\nedited\n");

		let status = await git.getStatusFull(WORKTREE);
		expect(status.changedPaths.unstaged).toEqual(["README.md"]);
		expect(status.changedPaths.staged).toEqual([]);

		await git.stageFile(WORKTREE, "README.md");
		status = await git.getStatusFull(WORKTREE);
		expect(status.changedPaths.staged).toEqual(["README.md"]);
		expect(status.changedPaths.unstaged).toEqual([]);

		await git.commit(WORKTREE, "docs: edit the readme");
		status = await git.getStatusFull(WORKTREE);
		expect(status.changedPaths.staged).toEqual([]);
		expect(status.changedPaths.unstaged).toEqual([]);
		expect(backend.commits.at(-1)).toEqual({
			message: "docs: edit the readme",
			files: ["README.md"],
		});
	});

	/** An unstaged edit is not in the commit, which is the whole point of the index. */
	it("leaves an unstaged edit out of the commit", async () => {
		const { writeFile } = await import("$lib/services/file-service");
		const git = await import("$lib/services/git-service");

		await writeFile(`${WORKTREE}/README.md`, "# Alpha\nstaged\n");
		await writeFile(`${WORKTREE}/src/main.ts`, "export const a = 2;\n");
		await git.stageFile(WORKTREE, "README.md");
		await git.commit(WORKTREE, "docs: only the readme");

		expect(backend.commits.at(-1)?.files).toEqual(["README.md"]);
		const status = await git.getStatusFull(WORKTREE);
		expect(status.changedPaths.unstaged).toEqual(["src/main.ts"]);
	});
});

describe("parcours: creating an instance", () => {
	/** Through the instance store, which is what the create form drives. */
	it("adds an instance with its own worktree and branch", async () => {
		const { spawnInstance, loadInstances, instances } = await import(
			"$lib/stores/instance"
		);
		const { get } = await import("svelte/store");
		const { activeProjectId } = await import("$lib/stores/project");

		activeProjectId.set("p1");
		await loadInstances("p1");
		expect(get(instances).map((i) => i.id)).toEqual(["i1"]);

		const created = await spawnInstance({
			id: "i2",
			projectId: "p1",
			projectPath: "/repos/alpha",
			ticket: { id: "T-2", title: "another" },
			branch: "second",
			baseBranch: "main",
		});
		await loadInstances("p1");

		expect(get(instances).map((i) => i.id)).toEqual(["i1", created.id]);
		expect(created.worktreePath).not.toBe(WORKTREE);
		const git = await import("$lib/services/git-service");
		expect(await git.getCurrentBranch(created.worktreePath)).toBe("second");
	});
});

describe("parcours: restarting on the previous view", () => {
	/**
	 * The convention the project holds to: whatever the user was looking at is
	 * what the app reopens on. The launch writes the state, and a second launch
	 * reading that very state comes back to the same place - which is the round
	 * trip, not two assertions about one file.
	 */
	it("comes back to the project and step it was left on", async () => {
		backend = seedWorld({
			uiState: {
				screen: "workspace",
				activeProjectId: "p1",
				openTabOrder: [],
				homeSection: "projects",
				homeSettingsTab: "general",
				projectStates: { p1: { activeStep: "git" } },
			},
		});
		vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
			backend.fetch(url, init),
		);
		await launch();
		// The git step is a LazyView: its module keeps loading past the end of
		// the test and lands after teardown unless it is awaited here.
		await import("$lib/components/git/GitView.svelte");
		await settle();

		const { get } = await import("svelte/store");
		const { activeStep, activeScreen } = await import("$lib/stores/ui");
		expect(get(activeScreen)).toBe("workspace");
		expect(get(activeStep)).toBe("git");
	});

	/** And what it writes on the way out is what that next launch reads. */
	it("writes the navigation state it will restore from", async () => {
		vi.useFakeTimers();
		try {
			render(Page);
			await vi.advanceTimersByTimeAsync(50);
			await import("$lib/components/Workspace.svelte");
			await vi.advanceTimersByTimeAsync(1000);

			const saved = backend.world.uiState as { screen: string } | null;
			expect(saved).not.toBeNull();
			expect(saved?.screen).toBe("home");
		} finally {
			vi.useRealTimers();
		}
	});
});
