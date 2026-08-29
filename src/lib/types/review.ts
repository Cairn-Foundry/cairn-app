// The review guide and the reviewer's state on it. Mirrors the Rust
// `commands/review.rs` structs field for field.

/** What a remark is about, which is also how its gutter marker is coloured. */
export type RemarkKind = "issue" | "question" | "refactor" | "note";

/** Where a remark stands: untouched, waved away, or turned into a comment. */
export type RemarkStatus = "open" | "dismissed" | "commented";

export type DiffSide = "old" | "new";

/** A slice of one file the chapter is about, tied to the hunk that contains it. */
export interface GuideExcerpt {
	path: string;
	side: DiffSide;
	from: number;
	to: number;
	/** Content hash of the containing hunk: the key the "seen" state is on. */
	hunkHash: string;
}

/** One point the guide makes, anchored to a line. */
export interface GuideRemark {
	id: string;
	kind: RemarkKind;
	path: string;
	side: DiffSide;
	line: number;
	title: string;
	body: string;
	status: RemarkStatus;
	commentId?: string;
}

/** One chapter of the guide: an intention, its extracts and its remarks. */
export interface GuideChapter {
	id: string;
	title: string;
	summary: string;
	excerpts: GuideExcerpt[];
	remarks: GuideRemark[];
	isSeen: boolean;
}

/** The guide as generated for one state of the branch. */
export interface ReviewGuide {
	headSha: string;
	baseSha: string;
	generatedAt: string;
	overview: string;
	chapters: GuideChapter[];
}

/** A comment the reviewer wrote, still local until the review is submitted. */
export interface ReviewComment {
	id: string;
	path: string;
	side: DiffSide;
	line: number;
	body: string;
	remarkId?: string;
	createdAt: string;
	/** Set once pushed to the forge, so a second submit never duplicates it. */
	publishedAs?: string;
}

/** Everything the review step remembers for one instance. */
export interface ReviewState {
	guide: ReviewGuide | null;
	seenHunks: string[];
	comments: ReviewComment[];
	currentChapterId: string;
	currentExcerptIndex: number;
	isDiffMode: boolean;
	/** Whether the diff mode's discussion panel is open. */
	isDiscussionsOpen: boolean;
	/** The file the diff mode was last reading; empty falls back to the first. */
	selectedPath: string;
	/** Which threads the discussion panel lists; empty means all of them. */
	discussionFilter: string;
}

/** One hunk of the branch diff, as the backend reports it. */
export interface ReviewHunk {
	path: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	hunkHash: string;
}

/** The verdict carried by a submitted review. */
export type ReviewVerdict = "approve" | "changes" | "comment";

export function emptyReviewState(): ReviewState {
	return {
		guide: null,
		seenHunks: [],
		comments: [],
		currentChapterId: "",
		currentExcerptIndex: 0,
		isDiffMode: false,
		isDiscussionsOpen: true,
		selectedPath: "",
		discussionFilter: "all",
	};
}
