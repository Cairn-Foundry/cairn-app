import { type BlameEntry, gitBlame } from "$lib/services/file-service";
import { checkIgnore, getFileAtHead } from "$lib/services/git-service";

export interface PaneDiffState {
	baseContent: string | null;
	currentBlame: Map<number, BlameEntry>;
}

function toLf(text: string): string {
	return text.replace(/\r\n/g, "\n");
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
	if (status === "deleted") {
		return emptyDiffState();
	}

	if (status === "untracked") {
		return { baseContent: null, currentBlame: new Map() };
	}

	const blamePromise = gitBlame(worktreePath, path).catch((err) => {
		console.warn("gitBlame failed:", err);
		return new Map<number, BlameEntry>();
	});

	if (!status) {
		const [ignored, baseContent, currentBlame] = await Promise.all([
			checkIgnore(worktreePath, [path]).catch(() => [] as string[]),
			getFileAtHead(worktreePath, path).catch(() => null),
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
		getFileAtHead(worktreePath, path).catch(() => null),
		blamePromise,
	]);

	return {
		baseContent: baseContent === null ? null : toLf(baseContent),
		currentBlame,
	};
}
