// The option vocabularies the coding CLIs accept, used where a native agent
// definition names an effort level or a permission mode.
//
// Cairn does not pass these to a run - a conversation is the CLI itself and
// takes its settings from its own flags and config. They are here because an
// agent definition written in the hub records them for the CLI to read.

// Mirrors the Claude Code CLI's --effort choices.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

// Mirrors the Claude Code CLI's --permission-mode choices.
export const PERMISSION_MODES = [
	"auto",
	"acceptEdits",
	"plan",
	"manual",
	"dontAsk",
	"bypassPermissions",
] as const;

// Codex states permissions as the sandbox its tools run in (--sandbox).
export const CODEX_SANDBOXES = [
	"read-only",
	"workspace-write",
	"danger-full-access",
] as const;

export const CODEX_EFFORTS = ["minimal", "low", "medium", "high"] as const;

// The Copilot CLI cannot stop to ask when it is driven without a terminal, so
// the only real choice is whether its tools run at all.
export const COPILOT_PERMISSION_MODES = ["allow-all", "ask"] as const;

export const ANTIGRAVITY_EFFORTS = ["low", "medium", "high"] as const;

export const ANTIGRAVITY_PERMISSION_MODES = [
	"request-review",
	"always-proceed",
] as const;

// Vibe states permissions as the agent profile a run adopts (--agent).
export const VIBE_PERMISSION_MODES = [
	"default",
	"plan",
	"accept-edits",
	"auto-approve",
] as const;

/**
 * The effort levels each CLI accepts. Asked of the CLI's own flags rather than
 * probed: Cairn no longer runs a provider to ask it, and these are stable
 * enough that a stale entry is a missing choice, never a wrong one.
 */
export function effortsOf(cli: string): readonly string[] {
	switch (cli) {
		case "claude-code":
			return EFFORT_LEVELS;
		case "codex":
			return CODEX_EFFORTS;
		case "antigravity":
			return ANTIGRAVITY_EFFORTS;
		default:
			return [];
	}
}

/**
 * The permission vocabulary each CLI accepts. They disagree deeply: Claude Code
 * states an approval mode, Codex the sandbox its tools run in, Copilot whether
 * tools run at all, Vibe the agent profile a run adopts. Passing one CLI's word
 * to another would be rejected or, worse, quietly grant more than intended - so
 * a CLI with no vocabulary here offers none rather than a borrowed one.
 */
export function permissionModesOf(cli: string): readonly string[] {
	switch (cli) {
		case "claude-code":
			return PERMISSION_MODES;
		case "codex":
			return CODEX_SANDBOXES;
		case "copilot":
			return COPILOT_PERMISSION_MODES;
		case "antigravity":
			return ANTIGRAVITY_PERMISSION_MODES;
		case "vibe":
			return VIBE_PERMISSION_MODES;
		default:
			return [];
	}
}
