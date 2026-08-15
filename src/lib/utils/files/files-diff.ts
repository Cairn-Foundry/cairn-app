import { type BlameEntry, gitBlame } from "$lib/services/file-service";
import {
	checkIgnore,
	getFileAtHead,
	getFileInIndex,
} from "$lib/services/git-service";

// Loading what an editor pane needs to show git information: the baseline the
// diff gutter compares against, and the blame of the working copy.

/** `baseContent` is null when there is no baseline to diff against. */
export interface PaneDiffState {
	baseContent: string | null;
	currentBlame: Map<number, BlameEntry>;
}

/** CodeMirror works in LF, so a CRLF baseline must be normalized to compare. */
function toLf(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

/** An empty baseline: everything in the file reads as added. */
export function emptyDiffState(): PaneDiffState {
	return {
		baseContent: "",
		currentBlame: new Map(),
	};
}

/** The staged version when there is one, otherwise HEAD. */
async function loadBase(
	worktreePath: string,
	path: string,
): Promise<string | null> {
	const indexed = await getFileInIndex(worktreePath, path).catch(() => null);
	if (indexed !== null) return indexed;
	return getFileAtHead(worktreePath, path).catch(() => null);
}

/**
 * A deleted file diffs against nothing, while an untracked, conflicted or
 * git-ignored one has no baseline at all - the gutter stays off rather than
 * marking every line as added.
 */
export async function loadPaneBase(
	worktreePath: string,
	path: string,
	status: string | undefined,
): Promise<PaneDiffState> {
	if (status === "deleted") {
		return emptyDiffState();
	}

	if (status === "untracked" || status === "conflicted") {
		return { baseContent: null, currentBlame: new Map() };
	}

	const blamePromise = gitBlame(worktreePath, path).catch((err) => {
		console.warn("gitBlame failed:", err);
		return new Map<number, BlameEntry>();
	});

	if (!status) {
		const [ignored, baseContent, currentBlame] = await Promise.all([
			checkIgnore(worktreePath, [path]).catch(() => [] as string[]),
			loadBase(worktreePath, path),
			blamePromise,
		]);
		if (ignored.length > 0) {
			return { baseContent: null, currentBlame: new Map() };
		}
		return {
			baseContent: baseContent === null ? null : toLf(baseContent),
			currentBlame,
		};
	}

	const [baseContent, currentBlame] = await Promise.all([
		loadBase(worktreePath, path),
		blamePromise,
	]);

	return {
		baseContent: baseContent === null ? null : toLf(baseContent),
		currentBlame,
	};
}
