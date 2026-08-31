// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Comment,
	Discussion,
	MergeRequest,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";

const forgeFindMergeRequest = vi.hoisted(() => vi.fn());
const forgeListDiscussions = vi.hoisted(() => vi.fn());
const forgeReply = vi.hoisted(() => vi.fn());
const forgeResolve = vi.hoisted(() => vi.fn());
const forgeApprove = vi.hoisted(() => vi.fn());
const forgeCreateMergeRequest = vi.hoisted(() => vi.fn());
const forgeListMembers = vi.hoisted(() => vi.fn());
const forgeListLabels = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/integration-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	forgeFindMergeRequest,
	forgeListDiscussions,
	forgeReply,
	forgeResolve,
	forgeApprove,
	forgeCreateMergeRequest,
	forgeListMembers,
	forgeListLabels,
}));

import {
	applyUpdate,
	approveMergeRequest,
	clearMergeRequest,
	loadDiscussions,
	loadMergeRequest,
	mergeRequestStateFor,
	mergeRequests,
	replyToDiscussion,
	selectDiscussion,
	setDiscussionResolved,
} from "./merge-request";

const KEY = integrationKey("p1", "i1");

const mr = (overrides: Partial<MergeRequest> = {}): MergeRequest =>
	({ id: "mr-1", title: "A change", ...overrides }) as MergeRequest;

const comment = (id: string): Comment => ({ id, body: id }) as Comment;

const discussion = (
	id: string,
	overrides: Partial<Discussion> = {},
): Discussion =>
	({ id, resolved: false, comments: [], ...overrides }) as Discussion;

/** The state of p1:i1 as the view reads it. */
const state = () => mergeRequestStateFor(get(mergeRequests), "p1", "i1");

beforeEach(() => {
	vi.clearAllMocks();
	forgeFindMergeRequest.mockResolvedValue(null);
	forgeListDiscussions.mockResolvedValue([]);
	forgeReply.mockResolvedValue(comment("new"));
	forgeResolve.mockResolvedValue(undefined);
	forgeApprove.mockResolvedValue(mr());
	clearMergeRequest("p1", "i1");
	clearMergeRequest("p1", "i2");
});

describe("mergeRequestStateFor", () => {
	it("answers an empty state for an instance that never loaded", () => {
		expect(mergeRequestStateFor({}, "p1", "i1")).toMatchObject({
			mergeRequest: null,
			discussions: [],
			isLoaded: false,
		});
	});
});

describe("loadMergeRequest", () => {
	it("stores the merge request of the branch", async () => {
		forgeFindMergeRequest.mockResolvedValue(mr({ title: "Add thing" }));
		await loadMergeRequest("p1", "i1", "feat/x");
		expect(state().mergeRequest?.title).toBe("Add thing");
		expect(forgeFindMergeRequest).toHaveBeenCalledWith("p1", "feat/x");
	});

	it("marks the state loaded even when the branch has no merge request", async () => {
		await loadMergeRequest("p1", "i1", "feat/x");
		expect(state()).toMatchObject({ mergeRequest: null, isLoaded: true });
	});

	it("lowers the refreshing flag once done", async () => {
		await loadMergeRequest("p1", "i1", "feat/x");
		expect(state().isRefreshing).toBe(false);
	});

	it("records a failure instead of throwing", async () => {
		forgeFindMergeRequest.mockRejectedValue(new Error("401"));
		await expect(
			loadMergeRequest("p1", "i1", "feat/x"),
		).resolves.toBeUndefined();
		expect(state().error).not.toBeNull();
		expect(state().isLoaded).toBe(true);
	});

	it("clears a previous error once a later load succeeds", async () => {
		forgeFindMergeRequest.mockRejectedValueOnce(new Error("401"));
		await loadMergeRequest("p1", "i1", "feat/x");
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
		expect(state().error).toBeNull();
	});

	it("keeps instances apart", async () => {
		forgeFindMergeRequest.mockResolvedValue(mr({ id: "mr-a" }));
		await loadMergeRequest("p1", "i1", "feat/a");
		forgeFindMergeRequest.mockResolvedValue(mr({ id: "mr-b" }));
		await loadMergeRequest("p1", "i2", "feat/b");
		expect(state().mergeRequest?.id).toBe("mr-a");
		expect(
			mergeRequestStateFor(get(mergeRequests), "p1", "i2").mergeRequest?.id,
		).toBe("mr-b");
	});
});

describe("applyUpdate", () => {
	it("lands a pushed update on the instance it describes", () => {
		applyUpdate(KEY, mr({ title: "Updated" }));
		expect(state().mergeRequest?.title).toBe("Updated");
		expect(state().isLoaded).toBe(true);
	});

	it("lands on its own instance even after the user switched", async () => {
		await loadMergeRequest("p1", "i2", "feat/b");
		applyUpdate(KEY, mr({ title: "For i1" }));
		expect(state().mergeRequest?.title).toBe("For i1");
		expect(
			mergeRequestStateFor(get(mergeRequests), "p1", "i2").mergeRequest,
		).toBeNull();
	});

	it("clears a previous error", async () => {
		forgeFindMergeRequest.mockRejectedValue(new Error("401"));
		await loadMergeRequest("p1", "i1", "feat/x");
		applyUpdate(KEY, mr());
		expect(state().error).toBeNull();
	});
});

describe("loadDiscussions", () => {
	beforeEach(async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
	});

	it("stores the discussions of the merge request", async () => {
		forgeListDiscussions.mockResolvedValue([discussion("d1")]);
		await loadDiscussions("p1", "i1");
		expect(state().discussions.map((d) => d.id)).toEqual(["d1"]);
		expect(state().areDiscussionsLoaded).toBe(true);
	});

	it("asks nothing when the branch has no merge request", async () => {
		clearMergeRequest("p1", "i1");
		await loadDiscussions("p1", "i1");
		expect(forgeListDiscussions).not.toHaveBeenCalled();
	});

	it("keeps the selected discussion when it is still there", async () => {
		forgeListDiscussions.mockResolvedValue([
			discussion("d1"),
			discussion("d2"),
		]);
		await loadDiscussions("p1", "i1");
		selectDiscussion("p1", "i1", "d2");
		await loadDiscussions("p1", "i1");
		expect(state().selectedDiscussionId).toBe("d2");
	});

	it("drops the selection when the discussion is gone", async () => {
		forgeListDiscussions.mockResolvedValue([discussion("d1")]);
		await loadDiscussions("p1", "i1");
		selectDiscussion("p1", "i1", "d1");
		forgeListDiscussions.mockResolvedValue([discussion("d2")]);
		await loadDiscussions("p1", "i1");
		expect(state().selectedDiscussionId).toBe("");
	});

	it("records a failure instead of throwing", async () => {
		forgeListDiscussions.mockRejectedValue(new Error("403"));
		await expect(loadDiscussions("p1", "i1")).resolves.toBeUndefined();
		expect(state().error).not.toBeNull();
		expect(state().areDiscussionsLoaded).toBe(true);
	});
});

describe("replyToDiscussion", () => {
	beforeEach(async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
		forgeListDiscussions.mockResolvedValue([
			discussion("d1", { comments: [comment("first")] }),
			discussion("d2"),
		]);
		await loadDiscussions("p1", "i1");
	});

	it("appends the comment the forge accepted", async () => {
		forgeReply.mockResolvedValue(comment("mine"));
		await replyToDiscussion("p1", "i1", "d1", "hello");
		expect(state().discussions[0].comments.map((c) => c.id)).toEqual([
			"first",
			"mine",
		]);
	});

	it("sends the reply to the right discussion of the right merge request", async () => {
		await replyToDiscussion("p1", "i1", "d1", "hello");
		expect(forgeReply).toHaveBeenCalledWith("p1", "mr-1", "d1", "hello");
	});

	it("leaves the other discussions alone", async () => {
		await replyToDiscussion("p1", "i1", "d1", "hello");
		expect(state().discussions[1].comments).toEqual([]);
	});

	it("adds nothing when the forge refuses the reply", async () => {
		forgeReply.mockRejectedValue(new Error("403"));
		await expect(replyToDiscussion("p1", "i1", "d1", "hello")).rejects.toThrow(
			"403",
		);
		expect(state().discussions[0].comments.map((c) => c.id)).toEqual(["first"]);
		expect(state().error).not.toBeNull();
	});
});

describe("setDiscussionResolved", () => {
	beforeEach(async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
		forgeListDiscussions.mockResolvedValue([
			discussion("d1"),
			discussion("d2"),
		]);
		await loadDiscussions("p1", "i1");
	});

	it("marks the discussion resolved once the forge agreed", async () => {
		await setDiscussionResolved("p1", "i1", "d1", true);
		expect(state().discussions[0].resolved).toBe(true);
	});

	it("reopens it again", async () => {
		await setDiscussionResolved("p1", "i1", "d1", true);
		await setDiscussionResolved("p1", "i1", "d1", false);
		expect(state().discussions[0].resolved).toBe(false);
	});

	it("leaves the other discussions alone", async () => {
		await setDiscussionResolved("p1", "i1", "d1", true);
		expect(state().discussions[1].resolved).toBe(false);
	});

	it("changes nothing when the forge refuses", async () => {
		forgeResolve.mockRejectedValue(new Error("403"));
		await expect(setDiscussionResolved("p1", "i1", "d1", true)).rejects.toThrow(
			"403",
		);
		expect(state().discussions[0].resolved).toBe(false);
		expect(state().error).not.toBeNull();
	});
});

describe("approveMergeRequest", () => {
	beforeEach(async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
	});

	it("takes the merge request the forge answers with", async () => {
		forgeApprove.mockResolvedValue(mr({ title: "Approved" }));
		await approveMergeRequest("p1", "i1", true);
		expect(state().mergeRequest?.title).toBe("Approved");
	});

	it("passes whether it is an approval or a withdrawal", async () => {
		await approveMergeRequest("p1", "i1", false);
		expect(forgeApprove).toHaveBeenCalledWith("p1", "mr-1", false);
	});

	/**
	 * Unlike the loads, which absorb a failure into the state, an action the
	 * user triggered publishes the error and rethrows, so the caller knows the
	 * forge refused it - the same policy as `mutate` on the git side.
	 */
	it("publishes the failure and rethrows, unlike a load", async () => {
		forgeApprove.mockRejectedValue(new Error("403"));
		await expect(approveMergeRequest("p1", "i1", true)).rejects.toThrow("403");
		expect(state().error).not.toBeNull();
	});

	it("does nothing when the branch has no merge request", async () => {
		clearMergeRequest("p1", "i1");
		await approveMergeRequest("p1", "i1", true);
		expect(forgeApprove).not.toHaveBeenCalled();
	});
});

describe("selectDiscussion", () => {
	it("records the selected discussion", () => {
		selectDiscussion("p1", "i1", "d1");
		expect(state().selectedDiscussionId).toBe("d1");
	});

	it("clears the selection when given nothing", () => {
		selectDiscussion("p1", "i1", "d1");
		selectDiscussion("p1", "i1", "");
		expect(state().selectedDiscussionId).toBe("");
	});
});

describe("clearMergeRequest", () => {
	it("forgets everything about the instance", async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i1", "feat/x");
		clearMergeRequest("p1", "i1");
		expect(state()).toMatchObject({ mergeRequest: null, isLoaded: false });
	});

	it("leaves the other instances alone", async () => {
		forgeFindMergeRequest.mockResolvedValue(mr());
		await loadMergeRequest("p1", "i2", "feat/b");
		clearMergeRequest("p1", "i1");
		expect(
			mergeRequestStateFor(get(mergeRequests), "p1", "i2").mergeRequest,
		).not.toBeNull();
	});
});
