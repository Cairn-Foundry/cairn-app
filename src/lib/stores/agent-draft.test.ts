// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCliProviders = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/cli-provider-service", () => ({ listCliProviders }));

import type {
	CliProviderDef,
	CliProviderId,
} from "$lib/services/cli-provider-service";
import {
	agentDraftRequest,
	clearAgentDraft,
	requestAgentDraft,
} from "./agent-draft";
import {
	cliProviderLabel,
	cliProviders,
	loadCliProviders,
} from "./cli-providers";

/** A provider as the registry describes it. */
const providerDef = (id: CliProviderId, label: string): CliProviderDef => ({
	id,
	label,
	hasLocalScope: true,
	installed: true,
	configured: true,
	path: null,
	version: null,
	resumable: true,
});

beforeEach(() => {
	clearAgentDraft();
	listCliProviders.mockReset();
	listCliProviders.mockResolvedValue([]);
});

describe("requestAgentDraft", () => {
	it("hands a prompt to the Agent step", () => {
		requestAgentDraft("i1", "fix this test");
		expect(get(agentDraftRequest)).toEqual({
			instanceId: "i1",
			text: "fix this test",
		});
	});

	it("scopes the request to its instance", () => {
		requestAgentDraft("i1", "text");
		expect(get(agentDraftRequest)?.instanceId).toBe("i1");
	});

	it("replaces a draft that was never consumed", () => {
		requestAgentDraft("i1", "first");
		requestAgentDraft("i2", "second");
		expect(get(agentDraftRequest)).toEqual({
			instanceId: "i2",
			text: "second",
		});
	});

	it("carries a multiline prompt whole", () => {
		requestAgentDraft("i1", "line one\nline two");
		expect(get(agentDraftRequest)?.text).toBe("line one\nline two");
	});

	it("hands over an empty prompt rather than refusing it", () => {
		requestAgentDraft("i1", "");
		expect(get(agentDraftRequest)).toEqual({ instanceId: "i1", text: "" });
	});
});

describe("clearAgentDraft", () => {
	it("empties the draft once the Agent step took it", () => {
		requestAgentDraft("i1", "text");
		clearAgentDraft();
		expect(get(agentDraftRequest)).toBeNull();
	});

	it("does nothing when there is no draft", () => {
		clearAgentDraft();
		expect(get(agentDraftRequest)).toBeNull();
	});
});

describe("agentDraftRequest", () => {
	it("exposes no setter, so the draft only moves through the two functions", () => {
		expect(agentDraftRequest).not.toHaveProperty("set");
		expect(agentDraftRequest).not.toHaveProperty("update");
	});
});

describe("loadCliProviders", () => {
	it("loads the provider list", async () => {
		cliProviders.set([]);
		listCliProviders.mockResolvedValue([
			providerDef("claude-code", "Claude Code"),
		]);
		await loadCliProviders();
		expect(get(cliProviders)).toEqual([
			providerDef("claude-code", "Claude Code"),
		]);
	});

	it("loads once, since the list is static for the app's lifetime", async () => {
		cliProviders.set([]);
		listCliProviders.mockResolvedValue([
			providerDef("claude-code", "Claude Code"),
		]);
		await loadCliProviders();
		await loadCliProviders();
		expect(listCliProviders).toHaveBeenCalledTimes(1);
	});

	it("tries again while the list is still empty", async () => {
		cliProviders.set([]);
		listCliProviders.mockResolvedValue([]);
		await loadCliProviders();
		await loadCliProviders();
		expect(listCliProviders).toHaveBeenCalledTimes(2);
	});
});

describe("cliProviderLabel", () => {
	it("names a known provider", () => {
		expect(
			cliProviderLabel("claude-code", [
				providerDef("claude-code", "Claude Code"),
			]),
		).toBe("Claude Code");
	});

	it("falls back to the raw id for a provider no longer known", () => {
		expect(
			cliProviderLabel("codex", [providerDef("claude-code", "Claude Code")]),
		).toBe("codex");
	});

	it("falls back when nothing is loaded yet", () => {
		expect(cliProviderLabel("claude-code", [])).toBe("claude-code");
	});
});
