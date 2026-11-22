// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The back end of `bun run dev:preview`: the in-memory one the parcours tests
 * drive, seeded with a believable workspace, answering the Tauri IPC of a plain
 * browser. It exists so the interface can be looked at and driven (Playwright,
 * screenshots) without the native shell. What it does not model answers null (an
 * empty list for a `list_*` command) and is listed once in the console, so a
 * screen that needs more shows what to add. `?empty` in the URL starts with no
 * project at all.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
	createFakeBackend,
	type FakeInstance,
	type FakeProject,
} from "../../test/fake-backend";

interface PreviewRepo {
	isGitRepo: boolean;
	branch: string;
	files: number;
	added: number;
	removed: number;
	ahead: number;
	behind: number;
}

const HOME = "/Users/dev/code";
const isEmpty = new URLSearchParams(location.search).has("empty");

const projects: FakeProject[] = [
	{
		id: "cairn",
		name: "cairn",
		path: `${HOME}/cairn`,
		color: "#6c8eff",
		activeInstanceId: null,
	},
	{
		id: "atlas-api",
		name: "atlas-api",
		path: `${HOME}/atlas/api`,
		color: "#3ccf6e",
		activeInstanceId: null,
	},
	{
		id: "atlas-web",
		name: "atlas-web",
		path: `${HOME}/atlas/web`,
		color: "#f0a040",
		activeInstanceId: null,
	},
	{
		id: "cowork-backend",
		name: "cowork-backend",
		path: `${HOME}/cowork/backend`,
		color: "#b07cff",
		activeInstanceId: null,
	},
	{
		id: "axios",
		name: "axios",
		path: `${HOME}/oss/axios`,
		color: "#5aa9e6",
		activeInstanceId: null,
	},
	{
		id: "notes",
		name: "Notes",
		path: "/Users/dev/Documents/notes",
		color: "#e05d5d",
		activeInstanceId: null,
	},
];

function instance(
	projectId: string,
	id: string,
	branch: string,
	title: string,
): FakeInstance {
	const project = projects.find((p) => p.id === projectId);
	return {
		id,
		projectId,
		ticket: { id, title },
		branch,
		worktreePath: `${project?.path}-worktrees/${id}`,
		status: "idle",
		createdAt: 0,
		baseBranch: "main",
	};
}

const instances: FakeInstance[] = [
	instance("cairn", "home", "feat/home-projects", "Refonte de la page Projets"),
	instance(
		"cairn",
		"gutter",
		"fix/gutter-hunks",
		"Marqueurs git décalés dans la gouttière",
	),
	instance("cairn", "deps", "chore/deps-1.2", "Mise à jour des dépendances"),
	instance("cairn", "lsp", "feat/lsp-rename", "Renommer un symbole via le LSP"),
	instance(
		"atlas-api",
		"auth",
		"feat/oauth-refresh",
		"Rafraîchir les jetons OAuth",
	),
	instance(
		"cowork-backend",
		"equip",
		"feat/settings-equipment",
		"Paramètres des équipements",
	),
];

/** Keyed by worktree path; a path missing here is a clean `main`. */
const repos: Record<string, PreviewRepo> = {
	[`${HOME}/cairn`]: {
		isGitRepo: true,
		branch: "main",
		files: 2,
		added: 14,
		removed: 3,
		ahead: 0,
		behind: 2,
	},
	[`${HOME}/cairn-worktrees/home`]: {
		isGitRepo: true,
		branch: "feat/home-projects",
		files: 9,
		added: 412,
		removed: 187,
		ahead: 3,
		behind: 0,
	},
	[`${HOME}/cairn-worktrees/gutter`]: {
		isGitRepo: true,
		branch: "fix/gutter-hunks",
		files: 1,
		added: 6,
		removed: 2,
		ahead: 1,
		behind: 0,
	},
	[`${HOME}/atlas/api`]: {
		isGitRepo: true,
		branch: "develop",
		files: 0,
		added: 0,
		removed: 0,
		ahead: 0,
		behind: 0,
	},
	[`${HOME}/atlas/api-worktrees/auth`]: {
		isGitRepo: true,
		branch: "feat/oauth-refresh",
		files: 4,
		added: 96,
		removed: 41,
		ahead: 0,
		behind: 0,
	},
	[`${HOME}/atlas/web`]: {
		isGitRepo: true,
		branch: "main",
		files: 0,
		added: 0,
		removed: 0,
		ahead: 0,
		behind: 5,
	},
	[`${HOME}/cowork/backend`]: {
		isGitRepo: true,
		branch: "main",
		files: 3,
		added: 27,
		removed: 9,
		ahead: 0,
		behind: 0,
	},
	[`${HOME}/cowork/backend-worktrees/equip`]: {
		isGitRepo: true,
		branch: "feat/settings-equipment",
		files: 6,
		added: 233,
		removed: 58,
		ahead: 2,
		behind: 0,
	},
	[`${HOME}/oss/axios`]: {
		isGitRepo: true,
		branch: "v1.x",
		files: 0,
		added: 0,
		removed: 0,
		ahead: 0,
		behind: 123,
	},
	"/Users/dev/Documents/notes": {
		isGitRepo: false,
		branch: "",
		files: 0,
		added: 0,
		removed: 0,
		ahead: 0,
		behind: 0,
	},
};

/** Open tickets assigned to the user, per project with a tracker. */
const assignedTickets: Record<string, number> = {
	cairn: 4,
	"cowork-backend": 27,
	"atlas-api": 1,
	"atlas-web": 0,
};

/** How long the tracker takes to answer, so the loading state shows. */
const TRACKER_LATENCY_MS = 600;

const TICKET_SEEDS: {
	title: string;
	status: string;
	category: "todo" | "in_progress" | "done" | "unknown";
	kind: string;
	labels: string[];
}[] = [
	{
		title: "Terminal loses its scrollback after a window resize",
		status: "In progress",
		category: "in_progress",
		kind: "Bug",
		labels: ["terminal"],
	},
	{
		title: "Show the merge request pipeline in the instance header",
		status: "To do",
		category: "todo",
		kind: "Story",
		labels: ["ci", "ux"],
	},
	{
		title: "Language server restarts in a loop on a missing toolchain",
		status: "In review",
		category: "in_progress",
		kind: "Bug",
		labels: ["lsp"],
	},
	{
		title: "Export the review comments as a markdown summary",
		status: "To do",
		category: "todo",
		kind: "Task",
		labels: ["review"],
	},
	{
		title: "Rate limit the invoice webhooks per customer",
		status: "In progress",
		category: "in_progress",
		kind: "Story",
		labels: ["billing"],
	},
	{
		title: "Paginate the members endpoint",
		status: "To do",
		category: "todo",
		kind: "Task",
		labels: ["api"],
	},
	{
		title: "Timezone drift in the weekly report job",
		status: "Blocked",
		category: "todo",
		kind: "Bug",
		labels: ["jobs"],
	},
	{
		title: "Drop the legacy v1 session tokens",
		status: "To do",
		category: "todo",
		kind: "Task",
		labels: ["auth", "cleanup"],
	},
];

/** A ticket with every field the tracker returns, varied by index. */
function previewTicket(projectId: string, index: number) {
	const seed = TICKET_SEEDS[index % TICKET_SEEDS.length];
	const prefix = projectId.split("-")[0].toUpperCase();
	return {
		id: `${projectId}-${index}`,
		key: `${prefix}-${142 - index * 7}`,
		title: seed.title,
		description: "",
		status: seed.status,
		statusCategory: seed.category,
		kind: seed.kind,
		labels: seed.labels,
		assignees: [{ login: "dev", displayName: "Dev" }],
		url: `https://tracker.example/${prefix}-${142 - index * 7}`,
		updatedAt: new Date(Date.now() - index * 5 * 3600_000).toISOString(),
	};
}

const CLEAN: PreviewRepo = {
	isGitRepo: true,
	branch: "main",
	files: 0,
	added: 0,
	removed: 0,
	ahead: 0,
	behind: 0,
};

const repoAt = (path: unknown) => repos[path as string] ?? CLEAN;

/** Files the snapshot reports as changed, so the totals have paths to count. */
function changedFiles(repo: PreviewRepo): string[] {
	return Array.from({ length: repo.files }, (_, i) => `src/file-${i}.ts`);
}

let storedSettings: Record<string, unknown> = { onboardingSeen: true };

const overrides: Record<string, (args: Record<string, unknown>) => unknown> = {
	get_listing: () =>
		isEmpty
			? {
					folders: [],
					projectOrder: [],
					ungroupedCollapsed: false,
				}
			: {
					folders: [
						{
							id: "atlas",
							name: "Atlas",
							projectIds: ["atlas-api", "atlas-web"],
							collapsed: false,
						},
					],
					projectOrder: projects.map((p) => p.id),
				},
	get_settings: () => storedSettings,
	update_settings: (a) => {
		storedSettings = a.settings as Record<string, unknown>;
		return storedSettings;
	},
	get_channel: () => ({
		label: "preview",
		dir: "/Users/dev/.cairn-dev",
		displayDir: "~/.cairn-dev",
	}),
	watch_dirs: (a) => ({
		watched: (a.dirs as unknown[] | undefined)?.length ?? 0,
		failed: [],
	}),
	get_project_integrations: (a) => ({
		tracker:
			(a.projectId as string) in assignedTickets
				? { connectionId: "jira", projectKey: "CAIRN" }
				: null,
		forge: null,
		ci: null,
		autoTransition: { onCreate: null, onFinalize: null },
	}),
	tracker_list_tickets: async (a) => {
		const projectId = a.projectId as string;
		const count = assignedTickets[projectId] ?? 0;
		await new Promise((resolve) => setTimeout(resolve, TRACKER_LATENCY_MS));
		return {
			items: Array.from({ length: Math.min(count, 20) }, (_, i) =>
				previewTicket(projectId, i),
			),
			hasMore: count > 20,
		};
	},
	is_git_repo: (a) => repoAt(a.worktreePath ?? a.path).isGitRepo,
	git_current_branch: (a) => repoAt(a.worktreePath).branch,
	git_snapshot: (a) => {
		const repo = repoAt(a.worktreePath);
		const files = changedFiles(repo);
		return {
			version: String(Date.now()),
			head: "",
			status: {
				isGitRepo: repo.isGitRepo,
				status: Object.fromEntries(files.map((f) => [f, "modified"])),
				changedPaths: { staged: [], unstaged: files },
			},
			currentBranch: repo.branch,
			remoteStatus: {
				hasUpstream: repo.isGitRepo,
				ahead: repo.ahead,
				behind: repo.behind,
				remote: "origin",
			},
			operationState: {
				kind: "none",
				conflictedFiles: [],
				structuralFiles: [],
				head: "",
				current: 0,
				total: 0,
			},
		};
	},
	git_staged_totals: () => ({ added: 0, removed: 0 }),
	git_unstaged_totals: (a) => {
		const repo = repoAt(a.worktreePath);
		return { added: repo.added, removed: repo.removed };
	},
};

const pluginDefaults: Record<string, unknown> = {
	"plugin:event|listen": 0,
	"plugin:os|platform": "macos",
	"plugin:os|os_type": "macos",
	"plugin:window|is_fullscreen": false,
	"plugin:window|is_maximized": false,
	"plugin:window|is_focused": true,
	"plugin:window|scale_factor": 2,
};

export function installPreviewBackend(): void {
	mockWindows("main");
	const backend = createFakeBackend(isEmpty ? {} : { projects, instances });
	const reported = new Set<string>();
	const report = (cmd: string) => {
		if (reported.has(cmd)) return;
		reported.add(cmd);
		console.info(`[preview] no model for "${cmd}", answered null`);
	};
	mockIPC(
		async (cmd, payload) => {
			const args = (payload ?? {}) as Record<string, unknown>;
			const override = overrides[cmd];
			if (override) return override(args);
			if (cmd.startsWith("plugin:")) {
				if (!(cmd in pluginDefaults)) report(cmd);
				return pluginDefaults[cmd] ?? null;
			}
			if (cmd.startsWith("list_")) {
				try {
					return await backend.invoke(cmd, args);
				} catch {
					return [];
				}
			}
			try {
				return await backend.invoke(cmd, args);
			} catch (error) {
				if (!String(error).includes("no handler")) throw error;
				report(cmd);
				return null;
			}
		},
		{ shouldMockEvents: true },
	);
}
