import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgentActivity = vi.hoisted(() => vi.fn());
const saveAgentActivity = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/agent-activity-service", () => ({
	getAgentActivity,
	saveAgentActivity,
}));

import {
	agentActivityKey,
	agentBusy,
	agentBusyConversations,
	agentCompletionPing,
	agentDone,
	agentDoneConversation,
	clearProjectAgentActivity,
	doneConversationOf,
	loadAgentActivity,
	pingAgentCompletion,
	setAgentBusy,
	setAgentDone,
} from "./agent-activity";

const KEY = agentActivityKey("p1", "i1");

beforeEach(() => {
	getAgentActivity.mockReset();
	saveAgentActivity.mockReset();
	getAgentActivity.mockResolvedValue({});
	saveAgentActivity.mockResolvedValue(undefined);
	agentBusyConversations.set({});
	agentDoneConversation.set({});
});

describe("agentActivityKey", () => {
	it("indexes by project and instance", () => {
		expect(agentActivityKey("p", "i")).toBe("p:i");
	});

	it("keeps two instances of one project apart", () => {
		expect(agentActivityKey("p", "a")).not.toBe(agentActivityKey("p", "b"));
	});
});

describe("setAgentBusy", () => {
	it("marks a conversation as running", () => {
		setAgentBusy("p1", "i1", true, "c1");
		expect(get(agentBusyConversations)[KEY]).toEqual(["c1"]);
	});

	it("lets sibling conversations of one instance run in parallel", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", true, "c2");
		expect(get(agentBusyConversations)[KEY]).toEqual(["c1", "c2"]);
	});

	it("stops one conversation without stopping its siblings", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", true, "c2");
		setAgentBusy("p1", "i1", false, "c1");
		expect(get(agentBusyConversations)[KEY]).toEqual(["c2"]);
	});

	it("drops the key once nothing is running for the instance", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", false, "c1");
		expect(get(agentBusyConversations)).not.toHaveProperty(KEY);
	});

	it("adds a conversation once, however often it is marked running", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", true, "c1");
		expect(get(agentBusyConversations)[KEY]).toEqual(["c1"]);
	});

	it("ignores stopping a conversation that was not running", () => {
		setAgentBusy("p1", "i1", false, "c1");
		expect(get(agentBusyConversations)).toEqual({});
	});

	it("keeps instances apart", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i2", true, "c2");
		expect(get(agentBusyConversations)[agentActivityKey("p1", "i2")]).toEqual([
			"c2",
		]);
		expect(get(agentBusyConversations)[KEY]).toEqual(["c1"]);
	});
});

describe("agentBusy", () => {
	it("reports an instance with a running conversation", () => {
		setAgentBusy("p1", "i1", true, "c1");
		expect(get(agentBusy)[KEY]).toBe(true);
	});

	it("says nothing about an instance once its runs finished", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", false, "c1");
		expect(get(agentBusy)).not.toHaveProperty(KEY);
	});

	it("still reports the instance while one sibling is left running", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", true, "c2");
		setAgentBusy("p1", "i1", false, "c1");
		expect(get(agentBusy)[KEY]).toBe(true);
	});
});

describe("setAgentDone", () => {
	it("records which conversation holds the unread answer", () => {
		setAgentDone("p1", "i1", true, "c1");
		expect(get(agentDoneConversation)[KEY]).toBe("c1");
	});

	it("persists the marker so a restart still shows it", () => {
		setAgentDone("p1", "i1", true, "c1");
		expect(saveAgentActivity).toHaveBeenCalledWith({ [KEY]: "c1" });
	});

	it("clears the marker when the answer is read", () => {
		setAgentDone("p1", "i1", true, "c1");
		setAgentDone("p1", "i1", false);
		expect(get(agentDoneConversation)).not.toHaveProperty(KEY);
	});

	it("writes nothing when the marker did not change", () => {
		setAgentDone("p1", "i1", true, "c1");
		saveAgentActivity.mockClear();
		setAgentDone("p1", "i1", true, "c1");
		expect(saveAgentActivity).not.toHaveBeenCalled();
	});

	it("writes nothing when clearing a marker that was not set", () => {
		setAgentDone("p1", "i1", false);
		expect(saveAgentActivity).not.toHaveBeenCalled();
	});

	it("moves the marker when another conversation finishes", () => {
		setAgentDone("p1", "i1", true, "c1");
		setAgentDone("p1", "i1", true, "c2");
		expect(get(agentDoneConversation)[KEY]).toBe("c2");
		expect(saveAgentActivity).toHaveBeenCalledTimes(2);
	});

	it("keeps one instance's marker out of another's", () => {
		setAgentDone("p1", "i1", true, "c1");
		setAgentDone("p1", "i2", true, "c2");
		expect(get(agentDoneConversation)).toEqual({
			[KEY]: "c1",
			[agentActivityKey("p1", "i2")]: "c2",
		});
	});
});

describe("agentDone", () => {
	it("reports an instance carrying an unread answer", () => {
		setAgentDone("p1", "i1", true, "c1");
		expect(get(agentDone)[KEY]).toBe(true);
	});

	it("says nothing once the answer is read", () => {
		setAgentDone("p1", "i1", true, "c1");
		setAgentDone("p1", "i1", false);
		expect(get(agentDone)).not.toHaveProperty(KEY);
	});
});

describe("doneConversationOf", () => {
	it("names the conversation holding the unread answer", () => {
		setAgentDone("p1", "i1", true, "c1");
		expect(doneConversationOf("p1", "i1")).toBe("c1");
	});

	it("answers null when there is nothing unread", () => {
		expect(doneConversationOf("p1", "i1")).toBeNull();
	});

	it("answers null for an instance that never ran", () => {
		setAgentDone("p1", "i1", true, "c1");
		expect(doneConversationOf("p1", "other")).toBeNull();
	});
});

describe("loadAgentActivity", () => {
	it("restores the markers saved on disk", async () => {
		getAgentActivity.mockResolvedValue({ [KEY]: "c1" });
		await loadAgentActivity();
		expect(get(agentDoneConversation)).toEqual({ [KEY]: "c1" });
	});

	it("leaves nothing marked when the file is empty", async () => {
		getAgentActivity.mockResolvedValue({});
		await loadAgentActivity();
		expect(get(agentDoneConversation)).toEqual({});
	});
});

describe("pingAgentCompletion", () => {
	it("bumps on every completion, so a listener fires again", () => {
		const before = get(agentCompletionPing);
		pingAgentCompletion();
		pingAgentCompletion();
		expect(get(agentCompletionPing)).toBe(before + 2);
	});
});

describe("clearProjectAgentActivity", () => {
	it("drops both markers of a deleted instance", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentDone("p1", "i1", true, "c1");
		clearProjectAgentActivity("p1", "i1");
		expect(get(agentBusyConversations)).not.toHaveProperty(KEY);
		expect(get(agentDoneConversation)).not.toHaveProperty(KEY);
	});

	it("leaves the other instances alone", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i2", true, "c2");
		clearProjectAgentActivity("p1", "i1");
		expect(get(agentBusyConversations)[agentActivityKey("p1", "i2")]).toEqual([
			"c2",
		]);
	});

	it("drops every running conversation of the instance at once", () => {
		setAgentBusy("p1", "i1", true, "c1");
		setAgentBusy("p1", "i1", true, "c2");
		clearProjectAgentActivity("p1", "i1");
		expect(get(agentBusyConversations)).not.toHaveProperty(KEY);
	});

	it("does nothing for an instance with no activity", () => {
		clearProjectAgentActivity("p1", "i1");
		expect(get(agentBusyConversations)).toEqual({});
		expect(get(agentDoneConversation)).toEqual({});
	});
});
