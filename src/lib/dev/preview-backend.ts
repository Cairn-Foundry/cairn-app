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

const TOKEN_FIELD = {
	key: "token",
	labelKey: "integrations.token",
	secret: true,
};

/** The catalogue `integration_kinds` returns, as the backend declares it. */
const INTEGRATION_KINDS = [
	{
		kind: "gitlab",
		label: "GitLab",
		icon: "gitlab",
		defaultBaseUrl: "https://gitlab.com",
		credentialFields: [TOKEN_FIELD],
		tokenHelpUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
		tokenHelpPath: "/-/user_settings/personal_access_tokens",
		requiredScopes: ["api"],
		provides: ["tracker", "forge", "ci"],
		terms: { mergeRequest: "mr" },
	},
	{
		kind: "github",
		label: "GitHub",
		icon: "github",
		defaultBaseUrl: "https://github.com",
		credentialFields: [TOKEN_FIELD],
		tokenHelpUrl: "https://github.com/settings/personal-access-tokens/new",
		tokenHelpPath: "/settings/personal-access-tokens/new",
		requiredScopes: [
			"Issues: read",
			"Pull requests: write",
			"Actions: read/write",
			"Metadata: read",
		],
		provides: ["tracker", "forge", "ci"],
		terms: { mergeRequest: "pr" },
	},
	{
		kind: "jira",
		label: "Jira",
		icon: "jira",
		defaultBaseUrl: null,
		credentialFields: [
			{ key: "email", labelKey: "integrations.email", secret: false },
			TOKEN_FIELD,
		],
		tokenHelpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
		tokenHelpPath: null,
		requiredScopes: ["read:jira-work", "write:jira-work"],
		provides: ["tracker"],
		terms: { mergeRequest: "mr" },
	},
];

/** The CLI registry, with the version of the ones installed on this machine. */
const CLI_PROVIDERS: [string, string, string | null][] = [
	["claude-code", "Claude Code", "2.4.1"],
	["codex", "Codex", "0.48.0"],
	["gemini", "Gemini CLI", "0.21.3"],
	["opencode", "OpenCode", null],
	["copilot", "Copilot CLI", null],
	["antigravity", "Antigravity", null],
	["vibe", "Mistral Vibe", null],
	["cursor", "Cursor CLI", null],
	["amp", "Amp", null],
	["goose", "Goose", null],
	["qwen", "Qwen Code", null],
	["droid", "Droid", null],
];

const DAY = 86_400_000;

/** One socket `list_listening_ports` reports: [port, address, family, pid, process, command, user]. */
const LISTENING: [number, string, string, number, string, string, string][] = [
	[
		5173,
		"127.0.0.1",
		"IPv4",
		48211,
		"node",
		"/usr/local/bin/node /Users/dev/code/cairn/node_modules/.bin/vite dev",
		"dev",
	],
	[
		1430,
		"127.0.0.1",
		"IPv4",
		48302,
		"node",
		"/usr/local/bin/node /Users/dev/code/cairn/node_modules/.bin/vite dev --port 1430",
		"dev",
	],
	[
		3000,
		"*",
		"IPv6",
		51120,
		"node",
		"/usr/local/bin/node dist/server.js",
		"dev",
	],
	[
		9229,
		"127.0.0.1",
		"IPv4",
		51120,
		"node",
		"/usr/local/bin/node dist/server.js",
		"dev",
	],
	[
		8000,
		"0.0.0.0",
		"IPv4",
		53007,
		"python3",
		"/opt/homebrew/bin/python3 -m http.server 8000",
		"dev",
	],
	[
		6379,
		"127.0.0.1",
		"IPv4",
		712,
		"redis-server",
		"/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379",
		"dev",
	],
	[
		5432,
		"127.0.0.1",
		"IPv4",
		388,
		"postgres",
		"/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16",
		"_postgres",
	],
	[
		5432,
		"::1",
		"IPv6",
		388,
		"postgres",
		"/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16",
		"_postgres",
	],
	[631, "127.0.0.1", "IPv4", 201, "cupsd", "/usr/sbin/cupsd -l", "root"],
];
let stoppedPids = new Set<number>();

/** An MCP server as `list_mcp_servers` merges it across the config files that declare it. */
function previewMcp(
	name: string,
	fields: {
		transport: "stdio" | "http" | "sse";
		command?: string;
		args?: string[];
		env?: Record<string, string>;
		url?: string;
		headers?: Record<string, string>;
		projectId?: string;
		enabled?: boolean;
		approval?: "approved" | "rejected" | "pending" | "";
		providers?: string[];
	},
) {
	const project = projects.find((p) => p.id === fields.projectId);
	const providers = fields.providers ?? ["claude-code"];
	const path = project
		? `${project.path}/.mcp.json`
		: "/Users/dev/.claude.json";
	return {
		id: `${project?.id ?? "user"}:${name}`,
		name,
		scope: project ? "project" : "user",
		projectId: project?.id ?? "",
		projectName: project?.name ?? "",
		projectPath: project?.path ?? "",
		transport: fields.transport,
		command: fields.command ?? "",
		args: fields.args ?? [],
		env: fields.env ?? {},
		url: fields.url ?? "",
		headers: fields.headers ?? {},
		enabled: fields.enabled ?? true,
		approval: fields.approval ?? "",
		targets: providers,
		locations: providers.map((provider) => ({
			path:
				provider === "codex" && !project
					? "/Users/dev/.codex/config.toml"
					: path,
			providers: [provider],
			dialect: provider,
		})),
		providers,
		divergent: false,
		sourcePath: path,
	};
}

const MCP_SERVERS = [
	previewMcp("playwright", {
		transport: "stdio",
		command: "npx",
		args: ["@playwright/mcp@latest"],
		providers: ["claude-code", "codex"],
	}),
	previewMcp("github", {
		transport: "http",
		url: "https://api.githubcopilot.com/mcp/",
		headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
	}),
	previewMcp("postgres", {
		transport: "stdio",
		command: "uvx",
		args: ["postgres-mcp", "--access-mode=restricted"],
		env: { DATABASE_URI: "postgresql://localhost:5432/cowork" },
		projectId: "cowork-backend",
		approval: "approved",
	}),
	previewMcp("sentry", {
		transport: "sse",
		url: "https://mcp.sentry.dev/sse",
		projectId: "cowork-backend",
		enabled: false,
		approval: "pending",
	}),
];

/** A native agent file as `list_native_agents` reads it back, with every field. */
function previewAgent(
	name: string,
	fields: {
		description: string;
		model?: string;
		effort?: string;
		permissionMode?: string;
		color?: string;
		tools?: string[];
		skills?: string[];
		systemPrompt: string;
		projectId?: string;
		providers?: string[];
	},
) {
	const providers = fields.providers ?? ["claude-code"];
	const project = projects.find((p) => p.id === fields.projectId);
	const dir = project
		? `${project.path}/.claude/agents`
		: "/Users/dev/.claude/agents";
	const path = `${dir}/${name}.md`;
	return {
		id: path,
		name,
		description: fields.description,
		model: fields.model ?? "",
		effort: fields.effort ?? "",
		permissionMode: fields.permissionMode ?? "",
		memory: "",
		skills: fields.skills ?? [],
		color: fields.color ?? "",
		tools: fields.tools ?? [],
		extraFrontmatter: "",
		systemPrompt: fields.systemPrompt,
		scope: project ? "project" : "global",
		projectId: project?.id ?? "",
		projectName: project?.name ?? "",
		path,
		locations: [{ path, providers }],
		providers,
		divergent: false,
	};
}

const NATIVE_AGENTS = [
	previewAgent("reviewer", {
		description:
			"Reviews a diff before it is pushed: correctness first, then the conventions of the repository.",
		model: "opus",
		effort: "high",
		color: "#a855f7",
		tools: ["Read", "Grep", "Glob", "Bash"],
		skills: ["code-review"],
		systemPrompt:
			"You review changes the way a careful senior engineer would. Read the whole diff before saying anything, then report what is wrong, worst first, with the line it is on.",
	}),
	previewAgent("test-writer", {
		description:
			"Writes the missing tests for a change, in the style the suite already uses.",
		model: "sonnet",
		color: "#22c55e",
		tools: ["Read", "Edit", "Write", "Bash"],
		systemPrompt:
			"Find what the change does not cover yet and write the tests for it. Match the existing helpers and naming; never mock what the suite does not already mock.",
		providers: ["claude-code", "opencode"],
	}),
	previewAgent("migration-planner", {
		description: "Plans a database migration that can run without downtime.",
		model: "opus",
		effort: "max",
		permissionMode: "plan",
		color: "#f97316",
		tools: ["Read", "Grep"],
		systemPrompt:
			"Plan the migration in steps that each keep the application working. Say for each step what runs, what it locks, and how to roll it back.",
		projectId: "cowork-backend",
	}),
	previewAgent("docs", {
		description: "Keeps the README and the docs folder in step with the code.",
		color: "#3b82f6",
		tools: ["Read", "Edit", "Glob"],
		systemPrompt:
			"When the code changes what a user or a contributor does, update the docs that say so. Keep the existing tone and structure.",
		projectId: "cairn",
	}),
];

/** A skill folder as `list_skills` reads it back, with every field. */
function previewSkill(
	name: string,
	fields: {
		description: string;
		whenToUse?: string;
		allowedTools?: string[];
		body: string;
		projectId?: string;
		plugin?: string;
		providers?: string[];
		resources?: string[];
	},
) {
	const project = projects.find((p) => p.id === fields.projectId);
	const scope = fields.plugin ? "plugin" : project ? "project" : "global";
	const dir = fields.plugin
		? `/Users/dev/.claude/plugins/${fields.plugin}/skills/${name}`
		: project
			? `${project.path}/.claude/skills/${name}`
			: `/Users/dev/.claude/skills/${name}`;
	const providers = fields.providers ?? ["claude-code"];
	const isReadOnly = scope === "plugin";
	return {
		id: dir,
		name,
		description: fields.description,
		whenToUse: fields.whenToUse ?? "",
		allowedTools: fields.allowedTools ?? [],
		paths: "",
		model: "",
		license: "",
		disableModelInvocation: false,
		extraFrontmatter: "",
		body: fields.body,
		scope,
		projectId: project?.id ?? "",
		projectName: project?.name ?? "",
		plugin: fields.plugin ?? "",
		path: dir,
		locations: [{ path: dir, providers, readOnly: isReadOnly }],
		providers,
		divergent: false,
		readOnly: isReadOnly,
		resources: (fields.resources ?? []).map((file) => ({
			name: file,
			path: `${dir}/${file}`,
			size: 1800,
		})),
	};
}

const PREVIEW_SKILLS = [
	previewSkill("code-review", {
		description:
			"Reviews a diff the way the team does: correctness first, then naming, then tests.",
		whenToUse: "Before a merge request is opened, or when asked to review.",
		allowedTools: ["Read", "Grep", "Bash(git diff)"],
		body: "# Code review\n\nRead the whole diff before commenting. Report what is wrong, worst first, with the file and line.\n\n## What to check\n\n- Errors that are swallowed\n- Names that lie about what they hold\n- Tests that would pass on a broken implementation\n",
		providers: ["claude-code", "codex"],
		resources: ["checklist.md"],
	}),
	previewSkill("release-notes", {
		description:
			"Writes the release notes of a version from its merged changes.",
		body: "# Release notes\n\nGroup the changes by what a user notices: added, changed, fixed. One line each, in the words of the user.\n",
	}),
	previewSkill("sql-style", {
		description:
			"The SQL conventions of the backend: naming, migrations, indexes.",
		body: "# SQL style\n\nTables are plural and snake_case. Every foreign key has an index. A migration never edits data and schema in the same step.\n",
		projectId: "cowork-backend",
	}),
	previewSkill("pdf", {
		description: "Reads, fills and merges PDF files.",
		body: "# PDF\n\nUse the scripts next to this file to read the text layer before the rendered page.\n",
		plugin: "document-skills",
		resources: ["extract.py", "merge.py"],
	}),
];

let integrationConnections: Record<string, unknown>[] = [
	{
		id: "jira",
		kind: "jira",
		label: "Jira Cowork",
		baseUrl: "https://cowork.atlassian.net",
		hasCredentials: true,
		identity: { login: "dev@cowork.io", displayName: "Dev", avatarUrl: null },
		createdAt: Date.now() - 40 * DAY,
		email: "dev@cowork.io",
		deployment: "Cloud",
	},
	{
		id: "gitlab-cowork",
		kind: "gitlab",
		label: "GitLab Cowork",
		baseUrl: "https://gitlab.cowork.io",
		hasCredentials: true,
		identity: { login: "dev", displayName: "Dev", avatarUrl: null },
		createdAt: Date.now() - 32 * DAY,
	},
	{
		id: "github",
		kind: "github",
		label: "GitHub",
		baseUrl: "https://github.com",
		hasCredentials: false,
		identity: null,
		createdAt: Date.now() - 3 * DAY,
	},
];

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

let storedSettings: Record<string, unknown> = {
	onboardingSeen: true,
	gitProfiles: [
		{ id: "work", label: "Work", name: "Dev", email: "dev@cowork.io" },
		{
			id: "personal",
			label: "Personal",
			name: "Dev",
			email: "dev@example.org",
		},
	],
};

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
	list_cli_providers: () =>
		CLI_PROVIDERS.map(([id, label, version]) => ({
			id,
			label,
			hasLocalScope: id === "claude-code",
			installed: version !== null,
			configured: version !== null,
			path: version ? `/usr/local/bin/${id}` : null,
			version,
			resumable: true,
		})),
	list_listening_ports: () =>
		LISTENING.filter(([, , , pid]) => !stoppedPids.has(pid)).map(
			([port, address, family, pid, process, command, user]) => ({
				id: `${pid}:${address}:${port}`,
				pid,
				port,
				address,
				family,
				process,
				command,
				user,
				isOwned: user === "dev",
			}),
		),
	kill_process: (a) => {
		stoppedPids = new Set([...stoppedPids, a.pid as number]);
		return null;
	},
	list_mcp_servers: () => (isEmpty ? [] : MCP_SERVERS),
	test_mcp_server: async (a) => {
		await new Promise((resolve) => setTimeout(resolve, TRACKER_LATENCY_MS));
		const server = a.server as { name: string };
		return {
			ok: true,
			error: "",
			serverName: server.name,
			serverVersion: "1.4.0",
			protocolVersion: "2025-06-18",
			tools: [
				{ name: "browser_navigate", description: "Open a URL in the browser." },
				{ name: "browser_click", description: "Click an element of the page." },
				{
					name: "browser_snapshot",
					description: "Read the accessibility tree of the page.",
				},
			],
			promptCount: 0,
			resourceCount: 2,
			durationMs: 840,
			partial: false,
			logs: "",
		};
	},
	list_native_agents: () => (isEmpty ? [] : NATIVE_AGENTS),
	list_skills: () => (isEmpty ? [] : PREVIEW_SKILLS),
	reached_providers: (a) => a.targets,
	integration_kinds: () => INTEGRATION_KINDS,
	list_integration_connections: () => (isEmpty ? [] : integrationConnections),
	save_integration_connection: (a) => {
		const connection = a.connection as Record<string, unknown>;
		const credentials = a.credentials as Record<string, string>;
		const id = (connection.id as string) || `conn-${Date.now()}`;
		const saved = {
			...connection,
			id,
			hasCredentials: Boolean(connection.hasCredentials || credentials.token),
			createdAt: connection.createdAt || Date.now(),
		};
		const isKnown = integrationConnections.some((c) => c.id === id);
		integrationConnections = isKnown
			? integrationConnections.map((c) => (c.id === id ? saved : c))
			: [...integrationConnections, saved];
		return saved;
	},
	delete_integration_connection: (a) => {
		integrationConnections = integrationConnections.filter(
			(c) => c.id !== a.id,
		);
		return null;
	},
	test_integration_connection: async (a) => {
		await new Promise((resolve) => setTimeout(resolve, TRACKER_LATENCY_MS));
		const tested = integrationConnections.find((c) => c.id === a.id);
		return (
			tested?.identity ?? { login: "dev", displayName: "Dev", avatarUrl: null }
		);
	},
	tracker_list_statuses: () => [
		{ id: "1", name: "To do", category: "todo" },
		{ id: "2", name: "In progress", category: "in_progress" },
		{ id: "3", name: "In review", category: "in_progress" },
		{ id: "4", name: "Done", category: "done" },
	],
	list_tracker_projects: () => [
		{
			key: "CAIRN",
			label: "Cairn",
			url: "https://cowork.atlassian.net/browse/CAIRN",
		},
		{
			key: "COWORK",
			label: "Cowork backend",
			url: "https://cowork.atlassian.net/browse/COWORK",
		},
	],
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
