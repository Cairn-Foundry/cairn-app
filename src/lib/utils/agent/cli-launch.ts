/**
 * How each CLI is launched and relaunched.
 *
 * The argv is built here rather than in Rust because the store needs it before
 * the call - it is what tells a fresh conversation from a resumed one - and the
 * PTY takes the argv as given. The binary name is resolved on the Rust side, so
 * only the flags live here.
 *
 * Every CLI reopens an exact conversation by its own id. None is reduced to
 * "carry on with whatever ran last", which is a surprising thing to do to
 * someone who picked one conversation out of a list.
 *
 * They differ only in where the id comes from: three accept one imposed at
 * launch, and the rest mint their own, which Cairn reads back afterwards
 * through `discoverCliSession`. Flags verified against the installed binaries'
 * own `--help`, which is ahead of the published docs for several of them.
 */
import type { CliProviderId } from "$lib/services/cli-provider-service";

/** The binary each CLI installs. */
const BINARY: Record<CliProviderId, string> = {
	"claude-code": "claude",
	codex: "codex",
	gemini: "gemini",
	opencode: "opencode",
	copilot: "copilot",
	antigravity: "agy",
	vibe: "vibe",
	cursor: "agent",
	amp: "amp",
	goose: "goose",
	qwen: "qwen",
	droid: "droid",
};

/**
 * The CLIs that document `--session-id` for a new session, so Cairn can choose
 * the id before the process starts. The others refuse one: Codex declines the
 * feature upstream, OpenCode errors on an id it has never seen, and Antigravity
 * quietly ignores it and uses its own.
 */
const MINTS_SESSION_ID: CliProviderId[] = [
	"claude-code",
	"gemini",
	"copilot",
	"qwen",
	"goose",
];

/** Whether Cairn can choose the session id before the CLI starts. */
export function mintsSessionId(cli: CliProviderId): boolean {
	return MINTS_SESSION_ID.includes(cli);
}

/**
 * Whether a conversation with this CLI can be reopened once Cairn knows its id.
 * True everywhere: it is the id that may be missing, never the ability to use
 * one.
 */
export function canResume(): boolean {
	return true;
}

/**
 * The argv that starts a fresh conversation, or null when this CLI mints its
 * own id - in which case `freshArgv` starts one and the id is read back after.
 */
export function newConversationArgv(
	cli: CliProviderId,
	sessionId: string,
): string[] | null {
	if (!mintsSessionId(cli) || !sessionId) return null;
	if (cli === "goose") return [BINARY[cli], "session", "--name", sessionId];
	return [BINARY[cli], "--session-id", sessionId];
}

/** The argv that starts a conversation from nothing. */
export function freshArgv(cli: CliProviderId): string[] {
	return [BINARY[cli]];
}

/**
 * The argv that reopens one exact conversation.
 *
 * A null `sessionId` means Cairn never learned this conversation's id - a CLI
 * that mints its own, closed before it had said anything. There is nothing to
 * resume then, so it starts fresh rather than opening someone else's session.
 */
export function resumeArgv(
	cli: CliProviderId,
	sessionId: string | null,
): string[] {
	const bin = BINARY[cli];
	if (!sessionId) return [bin];
	switch (cli) {
		case "claude-code":
		case "gemini":
		case "vibe":
		case "qwen":
		case "droid":
			return [bin, "--resume", sessionId];
		// Documented as the value form rather than a separate argument.
		case "copilot":
		case "cursor":
			return [bin, `--resume=${sessionId}`];
		case "amp":
			return [bin, "threads", "continue", sessionId];
		case "goose":
			return [bin, "session", "-r", "--name", sessionId];
		// A subcommand, not a flag.
		case "codex":
			return [bin, "resume", sessionId];
		case "opencode":
			return [bin, "--session", sessionId];
		case "antigravity":
			return [bin, "--conversation", sessionId];
		default:
			return [bin];
	}
}
