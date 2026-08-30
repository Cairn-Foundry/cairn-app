// Integrations (GitLab, GitHub, Jira) behind capability-named commands.
// Only this layer calls invoke(); every failure normalizes to an IntegrationError.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
	type Actor,
	type Comment,
	type Discussion,
	type DiscussionAnchor,
	EMPTY_PIPELINE_QUERY,
	INTEGRATION_ERROR_CODES,
	type IntegrationConnection,
	type IntegrationError,
	type IntegrationIdentity,
	type IntegrationKindDescriptor,
	type IntegrationUpdateEvent,
	type JobLog,
	type MergeRequest,
	type MergeRequestDraft,
	PIPELINE_PAGE_SIZE,
	type Pipeline,
	type PipelinePage,
	type PipelineQuery,
	type ProjectIntegrations,
	type ResolvedCapabilities,
	type Ticket,
	type TicketPage,
	type TicketQuery,
	type TicketTransition,
	type TrackerProject,
	type TrackerStatus,
	type WebLinkTarget,
} from "$lib/types/integrations";

/** Guards a code coming from outside, an older backend included. */
export function isKnownIntegrationErrorCode(
	code: string,
): code is IntegrationError["code"] {
	return (INTEGRATION_ERROR_CODES as readonly string[]).includes(code);
}

function isIntegrationError(value: unknown): value is IntegrationError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as IntegrationError).code === "string" &&
		typeof (value as IntegrationError).message === "string"
	);
}

// Normalizes anything thrown by an `invoke()` call into an `IntegrationError`,
// so a rejection that never reached the backend mapping still has a code.
export function toIntegrationError(value: unknown): IntegrationError {
	if (isIntegrationError(value)) {
		return {
			code: isKnownIntegrationErrorCode(value.code) ? value.code : "provider",
			message: value.message,
			retryAfterMs: value.retryAfterMs ?? null,
		};
	}
	return { code: "provider", message: String(value), retryAfterMs: null };
}

// ---------------------------------------------------------------------------
// Kinds and connections
// ---------------------------------------------------------------------------

export async function integrationKinds(): Promise<IntegrationKindDescriptor[]> {
	return invoke("integration_kinds");
}

export async function listIntegrationConnections(): Promise<
	IntegrationConnection[]
> {
	return invoke("list_integration_connections");
}

/**
 * Writes the connection then stores the token encrypted. `credentials` carries
 * `token` and, for Jira Cloud, `email`; an empty `id` lets the backend mint one.
 */
export async function saveIntegrationConnection(
	connection: IntegrationConnection,
	credentials: Record<string, string>,
): Promise<IntegrationConnection> {
	return invoke("save_integration_connection", { connection, credentials });
}

export async function deleteIntegrationConnection(
	id: string,
): Promise<IntegrationConnection[]> {
	return invoke("delete_integration_connection", { id });
}

/** Calls the service's "who am I" endpoint and stores the identity it answers. */
export async function testIntegrationConnection(
	id: string,
): Promise<IntegrationIdentity> {
	return invoke("test_integration_connection", { id });
}

// ---------------------------------------------------------------------------
// Project bindings
// ---------------------------------------------------------------------------

export async function getProjectIntegrations(
	projectId: string,
): Promise<ProjectIntegrations> {
	return invoke("get_project_integrations", { projectId });
}

export async function saveProjectIntegrations(
	projectId: string,
	bindings: ProjectIntegrations,
): Promise<ProjectIntegrations> {
	return invoke("save_project_integrations", { projectId, bindings });
}

/** Bindings matching the remote's host among the known connections; all null when none matches. */
export async function suggestProjectIntegrations(
	projectId: string,
	remoteUrl: string,
): Promise<ProjectIntegrations> {
	return invoke("suggest_project_integrations", { projectId, remoteUrl });
}

export async function getProjectCapabilities(
	projectId: string,
): Promise<ResolvedCapabilities> {
	return invoke("get_project_capabilities", { projectId });
}

/** Tracker projects (Jira) or repositories (forges) of a connection, for the picker. */
export async function listTrackerProjects(
	connectionId: string,
	text: string,
): Promise<TrackerProject[]> {
	return invoke("list_tracker_projects", { connectionId, text });
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export async function trackerListTickets(
	projectId: string,
	query: TicketQuery,
	force = false,
): Promise<TicketPage> {
	return invoke("tracker_list_tickets", { projectId, query, force });
}

export async function trackerGetTicket(
	projectId: string,
	key: string,
	force = false,
): Promise<Ticket> {
	return invoke("tracker_get_ticket", { projectId, key, force });
}

/** null when the URL is not a ticket of the bound tracker. */
export async function trackerResolveUrl(
	projectId: string,
	url: string,
): Promise<Ticket | null> {
	return invoke("tracker_resolve_url", { projectId, url });
}

export async function trackerListTransitions(
	projectId: string,
	key: string,
): Promise<TicketTransition[]> {
	return invoke("tracker_list_transitions", { projectId, key });
}

export async function trackerListStatuses(
	projectId: string,
): Promise<TrackerStatus[]> {
	return invoke("tracker_list_statuses", { projectId });
}

export async function trackerTransition(
	projectId: string,
	key: string,
	transitionId: string,
): Promise<Ticket> {
	return invoke("tracker_transition", { projectId, key, transitionId });
}

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------

export async function forgeFindMergeRequest(
	projectId: string,
	branch: string,
	force = false,
): Promise<MergeRequest | null> {
	return invoke("forge_find_merge_request", { projectId, branch, force });
}

export async function forgeCreateMergeRequest(
	projectId: string,
	draft: MergeRequestDraft,
): Promise<MergeRequest> {
	return invoke("forge_create_merge_request", { projectId, draft });
}

export async function forgeListDiscussions(
	projectId: string,
	mrId: string,
	force = false,
): Promise<Discussion[]> {
	return invoke("forge_list_discussions", { projectId, mrId, force });
}

export async function forgeReply(
	projectId: string,
	mrId: string,
	discussionId: string,
	body: string,
): Promise<Comment> {
	return invoke("forge_reply", { projectId, mrId, discussionId, body });
}

export async function forgeResolve(
	projectId: string,
	mrId: string,
	discussionId: string,
	resolved: boolean,
): Promise<void> {
	return invoke("forge_resolve", { projectId, mrId, discussionId, resolved });
}

export async function forgeApprove(
	projectId: string,
	mrId: string,
	approve: boolean,
): Promise<MergeRequest> {
	return invoke("forge_approve", { projectId, mrId, approve });
}

/** One comment of a review, as the reviewer wrote it locally. */
export interface ReviewCommentDraft {
	id: string;
	path: string;
	line: number;
	startLine?: number;
	side: "old" | "new";
	body: string;
}

/** What actually reached the forge; a half-posted review reports both halves. */
export interface ReviewOutcome {
	/** Local comment id -> the id the forge gave it. */
	published: Record<string, string>;
	failed: { id: string; message: string }[];
}

export async function forgeCreateDiscussion(
	projectId: string,
	mrId: string,
	anchor: DiscussionAnchor,
	body: string,
): Promise<Discussion> {
	return invoke("forge_create_discussion", { projectId, mrId, anchor, body });
}

export async function forgeSubmitReview(
	projectId: string,
	mrId: string,
	comments: ReviewCommentDraft[],
	verdict: "approve" | "changes" | "comment",
	body: string,
): Promise<ReviewOutcome> {
	return invoke("forge_submit_review", {
		projectId,
		mrId,
		comments,
		verdict,
		body,
	});
}

export async function forgeListMembers(
	projectId: string,
	text: string,
	force = false,
): Promise<Actor[]> {
	return invoke("forge_list_members", { projectId, text, force });
}

export async function forgeListLabels(
	projectId: string,
	force = false,
): Promise<string[]> {
	return invoke("forge_list_labels", { projectId, force });
}

/** A browser URL on the bound forge for a file, a commit, a branch or a compare. */
export async function forgeWebLink(
	projectId: string,
	target: WebLinkTarget,
): Promise<string> {
	return invoke("forge_web_link", { projectId, target });
}

// ---------------------------------------------------------------------------
// CI
// ---------------------------------------------------------------------------

export async function ciListPipelines(
	projectId: string,
	gitRef: string,
	query: PipelineQuery = EMPTY_PIPELINE_QUERY,
	limit = PIPELINE_PAGE_SIZE,
	page = 1,
	force = false,
): Promise<PipelinePage> {
	return invoke("ci_list_pipelines", {
		projectId,
		gitRef,
		query,
		limit,
		page,
		force,
	});
}

export async function ciGetPipeline(
	projectId: string,
	id: string,
	force = false,
): Promise<Pipeline> {
	return invoke("ci_get_pipeline", { projectId, id, force });
}

export async function ciJobLog(
	projectId: string,
	jobId: string,
): Promise<JobLog> {
	return invoke("ci_job_log", { projectId, jobId });
}

export async function ciRetryJob(
	projectId: string,
	jobId: string,
): Promise<void> {
	return invoke("ci_retry_job", { projectId, jobId });
}

export async function ciCancelPipeline(
	projectId: string,
	id: string,
): Promise<void> {
	return invoke("ci_cancel_pipeline", { projectId, id });
}

export async function ciPlayJob(
	projectId: string,
	jobId: string,
): Promise<void> {
	return invoke("ci_play_job", { projectId, jobId });
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

/** Starts polling the branch's merge request and last pipeline for the instance. */
export async function integrationWatch(
	projectId: string,
	instanceId: string,
	branch: string,
): Promise<void> {
	return invoke("integration_watch", { projectId, instanceId, branch });
}

export async function integrationUnwatch(
	projectId: string,
	instanceId: string,
): Promise<void> {
	return invoke("integration_unwatch", { projectId, instanceId });
}

/** `integration-update` fires only when the watched MR or pipeline changed. */
export async function onIntegrationUpdate(
	handler: (event: IntegrationUpdateEvent) => void,
): Promise<UnlistenFn> {
	return listen<IntegrationUpdateEvent>("integration-update", (event) =>
		handler(event.payload),
	);
}
