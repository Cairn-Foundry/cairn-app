import { type BlameEntry, gitBlame } from "$lib/services/file-service";
import { getFileAtHead } from "$lib/services/git-service";

export interface PaneDiffState {
	baseContent: string;
	currentBlame: Map<number, BlameEntry>;
}

export function emptyDiffState(): PaneDiffState {
	return {
		baseContent: "",
		currentBlame: new Map(),
	};
}

export async function loadPaneBase(
	worktreePath: string,
	path: string,
	status: string | undefined,
): Promise<PaneDiffState> {
	// Untracked or deleted files have no HEAD content to compare against:
	// the whole buffer reads as added (untracked) or the tab is gone (deleted).
	if (status === "untracked" || status === "deleted") {
		return emptyDiffState();
	}

	const blamePromise = gitBlame(worktreePath, path).catch((err) => {
		console.warn("gitBlame failed:", err);
		return new Map<number, BlameEntry>();
	});

	const [baseContent, currentBlame] = await Promise.all([
		getFileAtHead(worktreePath, path).catch(() => ""),
		blamePromise,
	]);

	return { baseContent, currentBlame };
}
