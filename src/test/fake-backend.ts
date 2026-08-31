// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A fake back end for the end-to-end parcours: one in-memory store standing in
 * for `~/.cairn` and for the worktrees on disk, driving the real `invoke()`
 * frontier rather than a mock per test.
 *
 * The names and the argument shapes are not guessed - `ipc-contract.test.ts`
 * already holds them against the Rust side, so a command renamed there fails
 * that test rather than silently drifting here. What this file adds is
 * behaviour: writing a file changes what reading it returns, committing clears
 * the status, saving the navigation state is what the next launch restores.
 *
 * Anything a parcours does not exercise falls through to `fallback()`, which
 * answers with the empty value of the shape the caller expects. A parcours that
 * needs more than that adds a handler rather than a mock.
 */

export interface FakeProject {
	id: string;
	name: string;
	path: string;
	color: string;
	activeInstanceId: string | null;
}

export interface FakeInstance {
	id: string;
	projectId: string;
	ticket: { id: string; title: string };
	branch: string;
	worktreePath: string;
	status: string;
	createdAt: number;
	baseBranch: string;
}

/** What a parcours seeds before mounting the app. */
export interface FakeWorld {
	projects: FakeProject[];
	instances: FakeInstance[];
	/** File contents keyed by absolute path. */
	files: Record<string, string>;
	/** Navigation state a previous run left behind, as `get_ui_state` returns it. */
	uiState: Record<string, unknown> | null;
	/** Worktree path -> branch name. */
	branches: Record<string, string>;
}

export interface FakeBackend {
	world: FakeWorld;
	/** Every command that reached the back, in order, as `[name, args]`. */
	calls: [string, Record<string, unknown>][];
	invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
	/** Serves `readFile`, which goes through the asset protocol rather than invoke. */
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	/** Commits recorded by `git_commit`, newest last. */
	commits: { message: string; files: string[] }[];
	/** Answers made by a parcours for a command this file does not model. */
	stub: (cmd: string, value: unknown) => void;
}

const EMPTY_REMOTE = { ahead: 0, behind: 0, remote: "", hasUpstream: false };
const EMPTY_OPERATION = {
	kind: "none",
	conflictedFiles: [],
	structuralFiles: [],
	head: "",
	current: 0,
	total: 0,
};

/** The flat form `read_dir_tree` returns, which `inflateTree` expands. */
function flatTree(root: string, files: string[]) {
	const names: string[] = [];
	const parents: number[] = [];
	const indexOf = new Map<string, number>();
	for (const path of files) {
		if (!path.startsWith(`${root}/`)) continue;
		const rel = path.slice(root.length + 1);
		const parts = rel.split("/");
		let parentIdx = -1;
		let walked = "";
		parts.forEach((part, depth) => {
			const isDir = depth < parts.length - 1;
			walked = walked ? `${walked}/${part}` : part;
			const known = indexOf.get(walked);
			if (known !== undefined) {
				parentIdx = known;
				return;
			}
			names.push(isDir ? `${part}/` : part);
			parents.push(parentIdx);
			parentIdx = names.length - 1;
			indexOf.set(walked, parentIdx);
		});
	}
	// The names travel as one newline-joined string, not as an array.
	return { names: names.join("\n"), parents, sep: "/" };
}

/**
 * A command no parcours models rejects rather than answering a plausible empty
 * value. Guessing here is what makes a fake back drift: `getAgentActivity`
 * falls back to `{}` on a throw but not on a `null`, so answering `null`
 * crashes a derived store several layers away, with nothing naming the command.
 * Rejecting puts the app on the path it takes when the back is unavailable,
 * which every caller already handles, and the name is in the message.
 */
function unmodelled(cmd: string): never {
	throw new Error(`fake back end: no handler for "${cmd}"`);
}

export function createFakeBackend(seed: Partial<FakeWorld> = {}): FakeBackend {
	const world: FakeWorld = {
		projects: [],
		instances: [],
		files: {},
		uiState: null,
		branches: {},
		...seed,
	};
	const calls: [string, Record<string, unknown>][] = [];
	const commits: { message: string; files: string[] }[] = [];
	const stubs = new Map<string, unknown>();
	/** Paths written since the last commit, which is what the status reports. */
	const dirty = new Set<string>();
	const staged = new Set<string>();

	const relTo = (worktree: string, path: string) =>
		path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path;

	const statusFor = (worktree: string) => {
		const status: Record<string, string> = {};
		for (const path of dirty) {
			if (path.startsWith(`${worktree}/`))
				status[relTo(worktree, path)] = staged.has(path)
					? "staged-modified"
					: "modified";
		}
		return status;
	};

	const changedPathsFor = (worktree: string) => ({
		staged: [...staged]
			.filter((p) => p.startsWith(`${worktree}/`))
			.map((p) => relTo(worktree, p)),
		unstaged: [...dirty]
			.filter((p) => p.startsWith(`${worktree}/`) && !staged.has(p))
			.map((p) => relTo(worktree, p)),
	});

	const handlers: Record<
		string,
		(a: Record<string, unknown>) => unknown | Promise<unknown>
	> = {
		list_projects: () => world.projects,
		get_listing: () => ({
			folders: [],
			projectOrder: world.projects.map((p) => p.id),
		}),
		list_instances: (a) =>
			world.instances.filter((i) => i.projectId === a.projectId),
		set_active_instance: (a) => {
			const project = world.projects.find((p) => p.id === a.projectId);
			if (project) project.activeInstanceId = a.instanceId as string | null;
		},
		update_project: (a) => {
			const next = a.project as FakeProject;
			const at = world.projects.findIndex((p) => p.id === next.id);
			if (at !== -1) world.projects[at] = next;
		},

		get_ui_state: () => world.uiState,
		save_ui_state: (a) => {
			world.uiState = a.state as Record<string, unknown>;
		},

		read_dir_tree: (a) => flatTree(a.path as string, Object.keys(world.files)),
		read_dir_tree_cached: (a) =>
			flatTree(a.path as string, Object.keys(world.files)),
		list_dir_names: (a) => {
			const root = `${a.path as string}/`;
			return [
				...new Set(
					Object.keys(world.files)
						.filter((p) => p.startsWith(root))
						.map((p) => p.slice(root.length).split("/")[0]),
				),
			];
		},
		file_mtimes: (a) =>
			Object.fromEntries((a.paths as string[]).map((p) => [p, 0])),
		read_file_preview: (a) => ({
			size: (world.files[a.path as string] ?? "").length,
			headHex: "",
		}),
		write_file: (a) => {
			const path = a.path as string;
			world.files[path] = a.content as string;
			dirty.add(path);
		},
		delete_path: (a) => {
			delete world.files[a.path as string];
		},

		is_git_repo: () => true,
		validate_git_repo: () => true,
		git_current_branch: (a) =>
			world.branches[a.worktreePath as string] ?? "main",
		git_status_full: (a) => ({
			isGitRepo: true,
			status: statusFor(a.worktreePath as string),
			changedPaths: changedPathsFor(a.worktreePath as string),
		}),
		git_status: (a) => statusFor(a.worktreePath as string),
		git_changed_paths: (a) => changedPathsFor(a.worktreePath as string),
		git_snapshot: (a) => ({
			// A fresh version each poll, so the store never treats it as unchanged.
			version: calls.length,
			status: {
				isGitRepo: true,
				status: statusFor(a.worktreePath as string),
				changedPaths: changedPathsFor(a.worktreePath as string),
			},
			currentBranch: world.branches[a.worktreePath as string] ?? "main",
			remoteStatus: EMPTY_REMOTE,
			operationState: EMPTY_OPERATION,
		}),
		git_remote_status: () => EMPTY_REMOTE,
		git_operation_state: () => EMPTY_OPERATION,
		git_remote_url: () => "",
		git_check_ignore: () => [],
		git_read_exclude: () => "",
		git_log: () =>
			commits.map((c, i) => ({
				hash: `hash${i}`,
				shortHash: `h${i}`,
				author: "tester",
				date: "2026-01-01",
				message: c.message,
				onCurrentBranch: true,
			})),
		git_stage_file: (a) => {
			const worktree = a.worktreePath as string;
			staged.add(`${worktree}/${a.filePath as string}`);
		},
		git_unstage_file: (a) => {
			const worktree = a.worktreePath as string;
			staged.delete(`${worktree}/${a.filePath as string}`);
		},
		git_stage_all: (a) => {
			for (const path of dirty)
				if (path.startsWith(`${a.worktreePath as string}/`)) staged.add(path);
		},
		git_commit: (a) => {
			commits.push({
				message: a.message as string,
				files: [...staged].map((p) => relTo(a.worktreePath as string, p)),
			});
			for (const path of staged) {
				staged.delete(path);
				dirty.delete(path);
			}
			return { ok: true };
		},
		// These rend a list of per-file diffs, not one diff text.
		// These two rend a list of per-file diffs, not one diff text.
		git_diff_unstaged: () => [],
		git_diff_staged: () => [],
		git_diff_file: () => "",
		git_file_at_head: (a) => world.files[a.path as string] ?? "",
		git_blame_file: () => [],
		git_get_identity: () => ({ name: "tester", email: "tester@example.com" }),

		// The create args travel nested under `args`, not spread flat.
		create_instance: (a) => {
			const args = a.args as {
				id: string;
				projectId: string;
				ticket: { id: string; title: string };
				branch?: string;
				baseBranch?: string;
			};
			const branch = args.branch ?? args.ticket.id;
			const instance: FakeInstance = {
				id: args.id,
				projectId: args.projectId,
				ticket: args.ticket,
				branch,
				worktreePath: `/worktrees/${args.projectId}/${branch}`,
				status: "idle",
				createdAt: 0,
				baseBranch: args.baseBranch ?? "main",
			};
			world.instances.push(instance);
			world.branches[instance.worktreePath] = branch;
			return instance;
		},
		delete_instance: (a) => {
			world.instances = world.instances.filter((i) => i.id !== a.instanceId);
		},
		list_branches: () => ["main"],
		list_branches_detailed: () => [],

		get_file_state: () => null,
		save_file_state: () => undefined,
		get_agent_activity: () => ({}),
		save_agent_activity: () => undefined,
		get_commit_state: () => null,
		save_commit_state: () => undefined,
		get_git_collapse_state: () => null,
		save_git_collapse_state: () => undefined,
		get_terminal_state: () => null,
		get_project_terminal_state: () => null,
		get_conversation_index: () => [],
		integration_watch: () => undefined,
		integration_unwatch: () => undefined,
		get_project_capabilities: () => ({}),
		take_pending_cli_paths: () => null,

		watch_worktree: () => undefined,
		unwatch_worktree: () => undefined,
		get_settings: () => null,
		update_settings: () => undefined,
	};

	const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
		calls.push([cmd, args]);
		if (stubs.has(cmd)) return stubs.get(cmd);
		const handler = handlers[cmd];
		return handler ? handler(args) : unmodelled(cmd);
	};

	// `readFile` reads through the asset protocol, so the same store has to
	// answer there or the editor opens every file empty.
	const fetchFile = async (url: string) => {
		const path = decodeURIComponent(url.split("/").slice(3).join("/"));
		const content = world.files[path];
		if (content === undefined)
			return new Response("no such file", { status: 404 });
		return new Response(content, {
			status: 200,
			headers: { ETag: `v${content.length}` },
		});
	};

	return {
		world,
		calls,
		commits,
		invoke,
		fetch: fetchFile as FakeBackend["fetch"],
		stub: (cmd, value) => stubs.set(cmd, value),
	};
}
