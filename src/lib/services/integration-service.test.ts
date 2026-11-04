// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EMPTY_PIPELINE_QUERY,
	INTEGRATION_ERROR_CODES,
	type IntegrationConnection,
	type IntegrationError,
	type IntegrationUpdateEvent,
	PIPELINE_PAGE_SIZE,
	type ProjectIntegrations,
	type TicketQuery,
} from "#lib/types/integrations";
import {
	ciCancelPipeline,
	ciGetPipeline,
	ciJobLog,
	ciListPipelines,
	ciPlayJob,
	ciRetryJob,
	deleteIntegrationConnection,
	forgeApprove,
	forgeCreateDiscussion,
	forgeCreateMergeRequest,
	forgeFindMergeRequest,
	forgeListDiscussions,
	forgeListLabels,
	forgeListMembers,
	forgeReply,
	forgeResolve,
	forgeSubmitReview,
	forgeWebLink,
	getProjectCapabilities,
	getProjectIntegrations,
	integrationKinds,
	integrationUnwatch,
	integrationWatch,
	isKnownIntegrationErrorCode,
	listIntegrationConnections,
	listTrackerProjects,
	onIntegrationUpdate,
	saveIntegrationConnection,
	saveProjectIntegrations,
	suggestProjectIntegrations,
	testIntegrationConnection,
	toIntegrationError,
	trackerGetTicket,
	trackerListStatuses,
	trackerListTickets,
	trackerListTransitions,
	trackerResolveUrl,
	trackerTransition,
} from "./integration-service";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

describe("command forwarding", () => {
	const connection = { id: "c1" } as IntegrationConnection;
	const bindings = { tracker: null } as unknown as ProjectIntegrations;
	const ticketQuery = { text: "bug" } as unknown as TicketQuery;
	const anchor = { path: "a.ts" } as never;
	const draft = { title: "t" } as never;
	const target = { kind: "branch" } as never;
	const comments = [
		{ id: "l1", path: "a.ts", line: 3, side: "new" as const, body: "b" },
	];
	const cases: [string, () => Promise<unknown>, string, unknown?][] = [
		["integrationKinds", () => integrationKinds(), "integration_kinds"],
		[
			"listIntegrationConnections",
			() => listIntegrationConnections(),
			"list_integration_connections",
		],
		[
			"saveIntegrationConnection",
			() => saveIntegrationConnection(connection, { token: "x" }),
			"save_integration_connection",
			{ connection, credentials: { token: "x" } },
		],
		[
			"deleteIntegrationConnection",
			() => deleteIntegrationConnection("c1"),
			"delete_integration_connection",
			{ id: "c1" },
		],
		[
			"testIntegrationConnection",
			() => testIntegrationConnection("c1"),
			"test_integration_connection",
			{ id: "c1" },
		],
		[
			"getProjectIntegrations",
			() => getProjectIntegrations("p1"),
			"get_project_integrations",
			{ projectId: "p1" },
		],
		[
			"saveProjectIntegrations",
			() => saveProjectIntegrations("p1", bindings),
			"save_project_integrations",
			{ projectId: "p1", bindings },
		],
		[
			"suggestProjectIntegrations",
			() => suggestProjectIntegrations("p1", "git@host:a/b.git"),
			"suggest_project_integrations",
			{ projectId: "p1", remoteUrl: "git@host:a/b.git" },
		],
		[
			"getProjectCapabilities",
			() => getProjectCapabilities("p1"),
			"get_project_capabilities",
			{ projectId: "p1" },
		],
		[
			"listTrackerProjects",
			() => listTrackerProjects("c1", "ca"),
			"list_tracker_projects",
			{ connectionId: "c1", text: "ca" },
		],
		[
			"trackerListTickets",
			() => trackerListTickets("p1", ticketQuery),
			"tracker_list_tickets",
			{ projectId: "p1", query: ticketQuery, force: false },
		],
		[
			"trackerListTickets forced",
			() => trackerListTickets("p1", ticketQuery, true),
			"tracker_list_tickets",
			{ projectId: "p1", query: ticketQuery, force: true },
		],
		[
			"trackerGetTicket",
			() => trackerGetTicket("p1", "K-1"),
			"tracker_get_ticket",
			{ projectId: "p1", key: "K-1", force: false },
		],
		[
			"trackerGetTicket forced",
			() => trackerGetTicket("p1", "K-1", true),
			"tracker_get_ticket",
			{ projectId: "p1", key: "K-1", force: true },
		],
		[
			"trackerResolveUrl",
			() => trackerResolveUrl("p1", "https://t/K-1"),
			"tracker_resolve_url",
			{ projectId: "p1", url: "https://t/K-1" },
		],
		[
			"trackerListTransitions",
			() => trackerListTransitions("p1", "K-1"),
			"tracker_list_transitions",
			{ projectId: "p1", key: "K-1" },
		],
		[
			"trackerListStatuses",
			() => trackerListStatuses("p1"),
			"tracker_list_statuses",
			{ projectId: "p1" },
		],
		[
			"trackerTransition",
			() => trackerTransition("p1", "K-1", "t9"),
			"tracker_transition",
			{ projectId: "p1", key: "K-1", transitionId: "t9" },
		],
		[
			"forgeFindMergeRequest",
			() => forgeFindMergeRequest("p1", "feat"),
			"forge_find_merge_request",
			{ projectId: "p1", branch: "feat", force: false },
		],
		[
			"forgeFindMergeRequest forced",
			() => forgeFindMergeRequest("p1", "feat", true),
			"forge_find_merge_request",
			{ projectId: "p1", branch: "feat", force: true },
		],
		[
			"forgeCreateMergeRequest",
			() => forgeCreateMergeRequest("p1", draft),
			"forge_create_merge_request",
			{ projectId: "p1", draft },
		],
		[
			"forgeListDiscussions",
			() => forgeListDiscussions("p1", "m1"),
			"forge_list_discussions",
			{ projectId: "p1", mrId: "m1", force: false },
		],
		[
			"forgeListDiscussions forced",
			() => forgeListDiscussions("p1", "m1", true),
			"forge_list_discussions",
			{ projectId: "p1", mrId: "m1", force: true },
		],
		[
			"forgeReply",
			() => forgeReply("p1", "m1", "d1", "hello"),
			"forge_reply",
			{ projectId: "p1", mrId: "m1", discussionId: "d1", body: "hello" },
		],
		[
			"forgeResolve",
			() => forgeResolve("p1", "m1", "d1", true),
			"forge_resolve",
			{ projectId: "p1", mrId: "m1", discussionId: "d1", resolved: true },
		],
		[
			"forgeApprove",
			() => forgeApprove("p1", "m1", false),
			"forge_approve",
			{ projectId: "p1", mrId: "m1", approve: false },
		],
		[
			"forgeCreateDiscussion",
			() => forgeCreateDiscussion("p1", "m1", anchor, "note"),
			"forge_create_discussion",
			{ projectId: "p1", mrId: "m1", anchor, body: "note" },
		],
		[
			"forgeSubmitReview",
			() => forgeSubmitReview("p1", "m1", comments, "changes", "body"),
			"forge_submit_review",
			{
				projectId: "p1",
				mrId: "m1",
				comments,
				verdict: "changes",
				body: "body",
			},
		],
		[
			"forgeListMembers",
			() => forgeListMembers("p1", "al"),
			"forge_list_members",
			{ projectId: "p1", text: "al", force: false },
		],
		[
			"forgeListMembers forced",
			() => forgeListMembers("p1", "al", true),
			"forge_list_members",
			{ projectId: "p1", text: "al", force: true },
		],
		[
			"forgeListLabels",
			() => forgeListLabels("p1"),
			"forge_list_labels",
			{ projectId: "p1", force: false },
		],
		[
			"forgeListLabels forced",
			() => forgeListLabels("p1", true),
			"forge_list_labels",
			{ projectId: "p1", force: true },
		],
		[
			"forgeWebLink",
			() => forgeWebLink("p1", target),
			"forge_web_link",
			{ projectId: "p1", target },
		],
		[
			"ciListPipelines defaults",
			() => ciListPipelines("p1", "main"),
			"ci_list_pipelines",
			{
				projectId: "p1",
				gitRef: "main",
				query: EMPTY_PIPELINE_QUERY,
				limit: PIPELINE_PAGE_SIZE,
				page: 1,
				force: false,
			},
		],
		[
			"ciListPipelines explicit",
			() =>
				ciListPipelines(
					"p1",
					"main",
					{ ...EMPTY_PIPELINE_QUERY, text: "x" },
					5,
					3,
					true,
				),
			"ci_list_pipelines",
			{
				projectId: "p1",
				gitRef: "main",
				query: { ...EMPTY_PIPELINE_QUERY, text: "x" },
				limit: 5,
				page: 3,
				force: true,
			},
		],
		[
			"ciGetPipeline",
			() => ciGetPipeline("p1", "7"),
			"ci_get_pipeline",
			{ projectId: "p1", id: "7", force: false },
		],
		[
			"ciGetPipeline forced",
			() => ciGetPipeline("p1", "7", true),
			"ci_get_pipeline",
			{ projectId: "p1", id: "7", force: true },
		],
		[
			"ciJobLog",
			() => ciJobLog("p1", "j1"),
			"ci_job_log",
			{ projectId: "p1", jobId: "j1" },
		],
		[
			"ciRetryJob",
			() => ciRetryJob("p1", "j1"),
			"ci_retry_job",
			{ projectId: "p1", jobId: "j1" },
		],
		[
			"ciCancelPipeline",
			() => ciCancelPipeline("p1", "7"),
			"ci_cancel_pipeline",
			{ projectId: "p1", id: "7" },
		],
		[
			"ciPlayJob",
			() => ciPlayJob("p1", "j1"),
			"ci_play_job",
			{ projectId: "p1", jobId: "j1" },
		],
		[
			"integrationWatch",
			() => integrationWatch("p1", "i1", "feat"),
			"integration_watch",
			{ projectId: "p1", instanceId: "i1", branch: "feat" },
		],
		[
			"integrationUnwatch",
			() => integrationUnwatch("p1", "i1"),
			"integration_unwatch",
			{ projectId: "p1", instanceId: "i1" },
		],
	];

	it.each(cases)(
		"%s forwards its arguments and result",
		async (_name, call, command, payload) => {
			mockInvoke.mockResolvedValue("answer");
			await expect(call()).resolves.toBe("answer");
			expect(mockInvoke).toHaveBeenCalledTimes(1);
			expect(mockInvoke.mock.calls[0]).toEqual(
				payload === undefined ? [command] : [command, payload],
			);
		},
	);

	it("propagates a backend rejection untouched", async () => {
		const failure = { code: "auth", message: "denied" };
		mockInvoke.mockRejectedValue(failure);
		await expect(integrationKinds()).rejects.toBe(failure);
	});
});

describe("onIntegrationUpdate", () => {
	it("listens on integration-update and hands the payload to the handler", async () => {
		const unlisten = vi.fn();
		mockListen.mockResolvedValue(unlisten);
		const handler = vi.fn();
		await expect(onIntegrationUpdate(handler)).resolves.toBe(unlisten);
		expect(mockListen).toHaveBeenCalledWith(
			"integration-update",
			expect.any(Function),
		);
		const payload = { projectId: "p1" } as unknown as IntegrationUpdateEvent;
		const listener = mockListen.mock.calls[0][1] as (e: unknown) => void;
		listener({ payload });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(payload);
	});
});

describe("isKnownIntegrationErrorCode", () => {
	it("accepts every code the backend can send", () => {
		for (const code of INTEGRATION_ERROR_CODES) {
			expect(isKnownIntegrationErrorCode(code), code).toBe(true);
		}
	});

	it("rejects a code from an older or newer backend", () => {
		expect(isKnownIntegrationErrorCode("not_a_code")).toBe(false);
		expect(isKnownIntegrationErrorCode("")).toBe(false);
	});
});

describe("toIntegrationError", () => {
	it("passes a well-formed error through, filling in retryAfterMs", () => {
		const error = { code: INTEGRATION_ERROR_CODES[0], message: "nope" };
		expect(toIntegrationError(error)).toEqual({
			code: INTEGRATION_ERROR_CODES[0],
			message: "nope",
			retryAfterMs: null,
		});
	});

	it("keeps a rate limit delay so the caller can back off", () => {
		const error = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "slow down",
			retryAfterMs: 30_000,
		};
		expect(toIntegrationError(error).retryAfterMs).toBe(30_000);
	});

	it("keeps a zero delay rather than replacing it with null", () => {
		const error = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "now",
			retryAfterMs: 0,
		};
		expect(toIntegrationError(error).retryAfterMs).toBe(0);
	});

	/**
	 * Unlike the git side, this one does check the code against its vocabulary:
	 * an unrecognised code is flattened to "provider" instead of reaching the UI.
	 */
	it("flattens an unrecognised code to provider, keeping the message", () => {
		expect(
			toIntegrationError({ code: "from_the_future", message: "detail" }),
		).toEqual({ code: "provider", message: "detail", retryAfterMs: null });
	});

	it("wraps a plain string rejection", () => {
		expect(toIntegrationError("network down")).toEqual({
			code: "provider",
			message: "network down",
			retryAfterMs: null,
		});
	});

	it("wraps an Error, keeping its message readable", () => {
		expect(toIntegrationError(new Error("boom")).message).toBe("Error: boom");
	});

	it("wraps what a rejected promise may carry instead of an error", () => {
		expect(toIntegrationError(undefined).code).toBe("provider");
		expect(toIntegrationError(null).message).toBe("null");
		expect(toIntegrationError(404).message).toBe("404");
	});

	it("wraps a half-shaped error rather than trusting it", () => {
		expect(toIntegrationError({ code: "provider" }).message).toBe(
			"[object Object]",
		);
		expect(toIntegrationError({ message: "text" }).code).toBe("provider");
		expect(toIntegrationError({ code: 1, message: "text" }).code).toBe(
			"provider",
		);
	});

	it("always answers with a shape the UI can render", () => {
		for (const value of [undefined, null, 0, "", [], {}, new Error("x")]) {
			const result = toIntegrationError(value);
			expect(isKnownIntegrationErrorCode(result.code), String(value)).toBe(
				true,
			);
			expect(typeof result.message, String(value)).toBe("string");
			expect(result, String(value)).toHaveProperty("retryAfterMs");
		}
	});

	it("normalizes an already normalized error to itself", () => {
		const once = toIntegrationError("failed");
		expect(toIntegrationError(once)).toEqual(once);
	});

	it("treats a missing retryAfterMs as no delay", () => {
		const error: IntegrationError = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "m",
			retryAfterMs: null,
		};
		expect(toIntegrationError(error).retryAfterMs).toBeNull();
	});
});
