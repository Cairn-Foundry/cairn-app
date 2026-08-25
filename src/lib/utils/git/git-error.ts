import { type TranslationKey, t } from "$lib/i18n";
import {
	type GitError,
	type GitErrorCode,
	isKnownGitErrorCode,
} from "$lib/services/git-service";

/** A one-click recovery the banner can offer for a given error code. */
export type GitErrorAction = "setUpstream" | "pullThenPush" | "removeLock";

/** A git error as the banner renders it. */
export type DescribedGitError = {
	title: string;
	hint: string;
	raw: string;
	action: GitErrorAction | null;
};

const ACTIONS: Partial<Record<GitErrorCode, GitErrorAction>> = {
	no_upstream: "setUpstream",
	non_fast_forward: "pullThenPush",
	lock_exists: "removeLock",
};

/**
 * Turns a classified git error into what the UI renders: a translated title, an
 * actionable hint, the raw git output, and the recovery action available for
 * that code, if any. A code with no translation falls back to `unknown` so a
 * newly added Rust code can never render an empty banner.
 */
export function describeGitError(error: GitError): DescribedGitError {
	const code = isKnownGitErrorCode(error.code) ? error.code : "unknown";
	return {
		title: t(`git.errors.codes.${code}.title` as TranslationKey) as string,
		hint: t(`git.errors.codes.${code}.hint` as TranslationKey) as string,
		raw: error.raw,
		action: ACTIONS[code] ?? null,
	};
}

/**
 * Path of the worktree holding the branch, from the git message behind a
 * `branch_in_use` failure. git quotes it, and both wordings ("is already used
 * by worktree at", "is already checked out at") end with the same path.
 */
export function worktreeInUsePath(raw: string): string | null {
	const match = raw.match(
		/(?:is already used by worktree at|is already checked out at)\s+'([^']+)'/,
	);
	return match ? match[1] : null;
}
