// Normalized integration model, mirror of src-tauri/src/commands/integrations/model.rs.
// The frontend only ever manipulates these shapes; service JSON never leaves Rust.

/** The only place the frontend sees a service name: to pick an icon and a form. */
export type IntegrationKind = "gitlab" | "github" | "jira";

export type Capability = "tracker" | "forge" | "ci";

export interface IntegrationIdentity {
	login: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface IntegrationConnection {
	id: string;
	kind: IntegrationKind;
	label: string;
	baseUrl: string;
	/** The frontend never sees the token, only whether one is stored. */
	hasCredentials: boolean;
	identity: IntegrationIdentity | null;
	createdAt: number;
	/** Jira Cloud only: the account the token belongs to (Basic auth). */
	email?: string;
	/** Jira only, detected on save: "Cloud" or "Server". */
	deployment?: string;
}

export interface CredentialField {
	key: "token" | "email";
	labelKey: string;
	secret: boolean;
}

export type MergeRequestTerm = "mr" | "pr";

export interface KindTerms {
	mergeRequest: MergeRequestTerm;
}

export interface IntegrationKindDescriptor {
	kind: IntegrationKind;
	label: string;
	icon: string;
	defaultBaseUrl: string | null;
	credentialFields: CredentialField[];
	tokenHelpUrl: string;
	requiredScopes: string[];
	provides: Capability[];
	terms: KindTerms;
}

export interface TrackerBinding {
	connectionId: string;
	/** GitLab/GitHub: "group/repo"; Jira: the project key ("CAIRN"). */
	projectKey: string;
	label: string;
}

export interface RepoBinding {
	connectionId: string;
	repoPath: string;
}

export interface AutoTransition {
	onCreate: string | null;
	onFinalize: string | null;
}

export interface ProjectIntegrations {
	tracker: TrackerBinding | null;
	forge: RepoBinding | null;
	ci: RepoBinding | null;
	autoTransition: AutoTransition;
}

export interface ResolvedCapabilities {
	tracker: { kind: IntegrationKind; label: string } | null;
	forge: {
		kind: IntegrationKind;
		label: string;
		webUrl: string;
		terms: KindTerms;
	} | null;
	ci: { kind: IntegrationKind; label: string } | null;
}

/** A tracker project or a forge repository, as offered by the binding picker. */
export interface TrackerProject {
	key: string;
	label: string;
	url: string;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export type StatusCategory = "todo" | "in_progress" | "done" | "unknown";

export interface Ticket {
	/** Opaque service id (GitLab iid, GitHub number, Jira id). */
	id: string;
	/** What is displayed and put in the branch: "#123", "CAIRN-42". */
	key: string;
	title: string;
	/** Markdown. */
	description: string;
	status: string;
	statusCategory: StatusCategory;
	kind: string | null;
	labels: string[];
	assignees: { login: string; displayName: string }[];
	url: string;
	updatedAt: string;
}

export interface TicketQuery {
	scope: "assigned" | "created" | "all";
	text: string;
	state: "open" | "closed" | "all";
	page: number;
}

export interface TicketTransition {
	id: string;
	name: string;
	toStatus: string;
}

export interface TrackerStatus {
	id: string;
	name: string;
	category: StatusCategory;
}

export interface TicketPage {
	items: Ticket[];
	hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Merge requests
// ---------------------------------------------------------------------------

export interface Actor {
	login: string;
	displayName: string;
	avatarUrl: string | null;
}

export type MergeRequestState = "open" | "merged" | "closed";

export interface MergeRequest {
	id: string;
	/** What is displayed: "!12", "#340". */
	number: string;
	title: string;
	description: string;
	state: MergeRequestState;
	isDraft: boolean;
	sourceBranch: string;
	targetBranch: string;
	author: Actor;
	reviewers: Actor[];
	assignees: Actor[];
	labels: string[];
	approvals: {
		approved: number;
		required: number | null;
		approvedByMe: boolean;
	};
	mergeable: "yes" | "no" | "unknown";
	hasConflicts: boolean;
	headSha: string;
	pipelineStatus: PipelineStatus | null;
	url: string;
	createdAt: string;
	updatedAt: string;
}

export interface MergeRequestDraft {
	title: string;
	description: string;
	isDraft: boolean;
	sourceBranch: string;
	targetBranch: string;
	reviewers: string[];
	assignees: string[];
	labels: string[];
	removeSourceBranch: boolean;
	/** GitLab only: squash the commits when the merge request is merged. */
	isSquash: boolean;
	/** Becomes "Closes #123" / "Resolves CAIRN-42" depending on the service. */
	linkedTicketKey: string | null;
}

export interface DiscussionAnchor {
	path: string;
	line: number;
	side: "old" | "new";
	sha: string;
}

export interface Comment {
	id: string;
	author: Actor;
	body: string;
	createdAt: string;
	isSystem: boolean;
}

export interface Discussion {
	id: string;
	resolved: boolean;
	resolvable: boolean;
	/** null = general comment, not attached to a line. */
	anchor: DiscussionAnchor | null;
	comments: Comment[];
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export type PipelineStatus =
	| "pending"
	| "running"
	| "success"
	| "failed"
	| "canceled"
	| "skipped"
	| "manual"
	| "unknown";

export interface PipelinePage {
	items: Pipeline[];
	/** Read from the page the forge returned, before the text pass narrowed it. */
	hasMore: boolean;
}

/** Kept in step with `PIPELINES_PER_PAGE` on the Rust side. */
export const PIPELINE_PAGE_SIZE = 20;

/** Applied by the provider on the whole branch history, never on the loaded page. */
export interface PipelineQuery {
	status: PipelineStatus | null;
	/** A sha prefix, a pipeline number, or a commit title fragment. */
	text: string;
	username: string | null;
	source: string | null;
}

export const EMPTY_PIPELINE_QUERY: PipelineQuery = {
	status: null,
	text: "",
	username: null,
	source: null,
};

export interface PipelineJob {
	id: string;
	name: string;
	status: PipelineStatus;
	durationMs: number | null;
	startedAt: string | null;
	canRetry: boolean;
	canCancel: boolean;
	isManual: boolean;
	url: string;
}

export interface PipelineStage {
	name: string;
	status: PipelineStatus;
	jobs: PipelineJob[];
}

export interface Pipeline {
	id: string;
	/** "#8241" */
	number: string;
	status: PipelineStatus;
	ref: string;
	sha: string;
	/** The commit message. */
	title: string;
	source: string | null;
	/** GitHub Actions: one stage per workflow, its jobs inside. */
	stages: PipelineStage[];
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
	url: string;
	/** Shortcut for the "Fix with agent" banner. */
	failedJobId: string | null;
}

export interface JobLog {
	jobId: string;
	text: string;
	truncated: boolean;
	failureExcerpt: string | null;
}

// ---------------------------------------------------------------------------
// Errors, links and events
// ---------------------------------------------------------------------------

export const INTEGRATION_ERROR_CODES = [
	"no_connection",
	"not_bound",
	"unauthenticated",
	"forbidden",
	"not_found",
	"rate_limited",
	"network",
	"unsupported",
	"provider",
] as const;

export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

export interface IntegrationError {
	code: IntegrationErrorCode;
	message: string;
	retryAfterMs: number | null;
}

/** Sent as `{ type: 'file', ... }`; `ref` is a branch, tag or sha. */
export type WebLinkTarget =
	| { type: "file"; path: string; line?: number | null; ref: string }
	| { type: "commit"; sha: string }
	| { type: "branch"; name: string }
	| { type: "compare"; base: string; head: string };

/** Emitted only when the watched value changed; `data` matches `kind`. */
export type IntegrationUpdateEvent =
	| { projectId: string; instanceId: string; kind: "pipeline"; data: Pipeline }
	| {
			projectId: string;
			instanceId: string;
			kind: "merge_request";
			data: MergeRequest;
	  };
