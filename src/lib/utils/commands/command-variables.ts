// The `{{token}}` language of custom commands: what a token can resolve to, how
// it is substituted into a shell script, and the environment it exports.

/** Everything a token can be resolved against, captured when the command runs. */
export interface CommandContext {
	instance: {
		id: string;
		branch: string;
		worktreePath: string;
		ticketId: string;
		ticketTitle: string;
		ticketKey?: string;
		ticketUrl?: string;
		baseBranch: string;
	};
	project: { id: string; name: string; path: string };
	user: { name: string; email: string; login: string };
	now: Date;
}

/** Catalog key -> environment variable exported into the PTY. */
export const VARIABLE_ENV_NAMES: Record<string, string> = {
	"instance.id": "CAIRN_INSTANCE_ID",
	"instance.branch": "CAIRN_BRANCH",
	"instance.worktree": "CAIRN_WORKTREE",
	"instance.ticketId": "CAIRN_TICKET_ID",
	"instance.ticketTitle": "CAIRN_TICKET_TITLE",
	"instance.baseBranch": "CAIRN_BASE_BRANCH",
	"instance.slug": "CAIRN_INSTANCE_SLUG",
	ticket: "CAIRN_TICKET",
	"ticket.key": "CAIRN_TICKET_KEY",
	"ticket.title": "CAIRN_TICKET_TITLE",
	"ticket.url": "CAIRN_TICKET_URL",
	"project.id": "CAIRN_PROJECT_ID",
	"project.name": "CAIRN_PROJECT_NAME",
	"project.path": "CAIRN_PROJECT_PATH",
	"user.name": "CAIRN_USER_NAME",
	"user.email": "CAIRN_USER_EMAIL",
	"user.login": "CAIRN_USER_LOGIN",
	date: "CAIRN_DATE",
	time: "CAIRN_TIME",
	timestamp: "CAIRN_TIMESTAMP",
};

/** Every catalog key, for the picker offered next to a command's steps. */
export const VARIABLE_KEYS = Object.keys(VARIABLE_ENV_NAMES);

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const PROMPT_PREFIX = "prompt:";
const PORT_PREFIX = "port";

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Single-quotes anything a POSIX shell could reinterpret, `''` for empty. */
export function shellQuote(value: string): string {
	if (value === "") return "''";
	if (SHELL_SAFE.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A branch or ticket id as a path-safe slug, never empty ("instance"). */
export function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "instance"
	);
}

/** Two-digit zero padding for the date and time tokens. */
function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** Resolves every catalog key at once; a missing context field yields "". */
export function buildValues(ctx: CommandContext): Record<string, string> {
	const { now } = ctx;
	const ticketKey = ctx.instance.ticketKey || ctx.instance.ticketId;
	return {
		"instance.id": ctx.instance.id,
		"instance.branch": ctx.instance.branch,
		"instance.worktree": ctx.instance.worktreePath,
		"instance.ticketId": ctx.instance.ticketId,
		"instance.ticketTitle": ctx.instance.ticketTitle,
		"instance.baseBranch": ctx.instance.baseBranch,
		"instance.slug": slugify(ctx.instance.branch || ctx.instance.ticketId),
		ticket: ticketKey,
		"ticket.key": ticketKey,
		"ticket.title": ctx.instance.ticketTitle,
		"ticket.url": ctx.instance.ticketUrl ?? "",
		"project.id": ctx.project.id,
		"project.name": ctx.project.name,
		"project.path": ctx.project.path,
		"user.name": ctx.user.name,
		"user.email": ctx.user.email,
		"user.login": ctx.user.login,
		date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
		timestamp: String(Math.floor(now.getTime() / 1000)),
	};
}

/** Visits every `{{...}}` token across all steps, in source order. */
function eachToken(steps: string[], visit: (token: string) => void): void {
	for (const step of steps) {
		for (const match of step.matchAll(TOKEN)) visit(match[1]);
	}
}

/** Prompt labels in order of first appearance, deduplicated. */
export function collectPrompts(steps: string[]): string[] {
	const labels: string[] = [];
	eachToken(steps, (token) => {
		if (!token.startsWith(PROMPT_PREFIX)) return;
		const label = token.slice(PROMPT_PREFIX.length).trim();
		if (label && !labels.includes(label)) labels.push(label);
	});
	return labels;
}

/** Port bases in order of first appearance, deduplicated. */
export function collectPortBases(steps: string[]): number[] {
	const bases: number[] = [];
	eachToken(steps, (token) => {
		const base = parsePortBase(token);
		if (base !== null && !bases.includes(base)) bases.push(base);
	});
	return bases;
}

/**
 * The base port is always written by the user: a project listens on 3000, 8000
 * or 5432 depending on what it runs, so there is no sane default to invent.
 */
function parsePortBase(token: string): number | null {
	if (!isPortToken(token)) return null;
	const raw = Number(token.slice(PORT_PREFIX.length + 1).trim());
	if (!Number.isInteger(raw) || raw < 1 || raw > 65535) return null;
	return raw;
}

/** `{{port}}` alone, or `{{port:3000}}` with a base. */
function isPortToken(token: string): boolean {
	return token === PORT_PREFIX || token.startsWith(`${PORT_PREFIX}:`);
}

/** Port tokens whose base is missing or unusable, as written in the steps. */
export function findInvalidPortTokens(steps: string[]): string[] {
	const invalid: string[] = [];
	eachToken(steps, (token) => {
		if (!isPortToken(token) || parsePortBase(token) !== null) return;
		if (!invalid.includes(token)) invalid.push(token);
	});
	return invalid;
}

/** A requested base and the free port actually granted for this run. */
export interface AllocatedPort {
	base: number;
	port: number;
}

/** Everything needed to substitute a step: catalog values, answers, ports. */
export interface Resolution {
	values: Record<string, string>;
	prompts: Record<string, string>;
	ports: AllocatedPort[];
}

/**
 * Replace every token by its shell-quoted value. An unknown token is left as
 * written so it shows up in the terminal instead of vanishing silently.
 */
export function substitute(text: string, resolution: Resolution): string {
	return text.replace(TOKEN, (raw, token: string) => {
		if (token.startsWith(PROMPT_PREFIX)) {
			const label = token.slice(PROMPT_PREFIX.length).trim();
			const answer = resolution.prompts[label];
			return answer === undefined ? raw : shellQuote(answer);
		}
		const base = parsePortBase(token);
		if (base !== null) {
			const allocated = resolution.ports.find((p) => p.base === base);
			return allocated === undefined ? raw : String(allocated.port);
		}
		const value = resolution.values[token];
		return value === undefined ? raw : shellQuote(value);
	});
}

/**
 * Same tokens, but the value is inserted as written: environment variable values
 * never reach a shell, so quoting them would leak the quotes into the value.
 */
export function substituteValues(
	text: string,
	values: Record<string, string>,
): string {
	return text.replace(TOKEN, (raw, token: string) => values[token] ?? raw);
}

/**
 * One shell invocation for the whole command: `&&` chains the steps and stops on
 * the first failure, `;` runs them all whatever happens.
 */
export function buildScript(
	steps: string[],
	stopOnError: boolean,
	resolution: Resolution,
): string {
	return steps
		.map((step) => step.trim())
		.filter((step) => step.length > 0)
		.map((step) => substitute(step, resolution))
		.join(stopOnError ? " && " : "; ");
}

/**
 * The environment exported into the PTY: every catalog key under its
 * `CAIRN_*` name, plus `CAIRN_PORT` for the first allocated port. User entries
 * come first, so a Cairn variable always wins over one of the same name.
 */
export function buildEnv(
	resolution: Resolution,
	userEnv: Record<string, string> = {},
): Record<string, string> {
	const env: Record<string, string> = { ...userEnv };
	for (const [key, name] of Object.entries(VARIABLE_ENV_NAMES)) {
		env[name] = resolution.values[key] ?? "";
	}
	const first = resolution.ports[0];
	if (first) env.CAIRN_PORT = String(first.port);
	return env;
}
