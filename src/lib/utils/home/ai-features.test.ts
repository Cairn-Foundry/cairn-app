// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
	ASSIST_CLI,
	ASSIST_CLIS,
	FEATURE_SCHEMAS,
	resolveAiFeature,
} from "./ai-features";

const installed =
	(...ids: string[]) =>
	(id: string) =>
		ids.includes(id);

describe("resolveAiFeature", () => {
	it("runs on the default provider when none was pinned", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{},
			installed(ASSIST_CLI),
		);
		expect(resolved.providerId).toBe(ASSIST_CLI);
		expect(resolved.unavailable).toBe(false);
	});

	it("honours the provider the feature was assigned", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{ commitMessage: { providerId: "codex", model: "", promptTemplate: "" } },
			installed("codex"),
		);
		expect(resolved.providerId).toBe("codex");
		expect(resolved.unavailable).toBe(false);
	});

	/**
	 * An assist quietly served by another model reads as if it came from the one
	 * that was chosen, so a missing CLI stops the run instead of falling back.
	 */
	it("reports a pinned provider that is not installed rather than swapping it", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{ commitMessage: { providerId: "codex", model: "", promptTemplate: "" } },
			installed(ASSIST_CLI),
		);
		expect(resolved.providerId).toBe("codex");
		expect(resolved.unavailable).toBe(true);
	});

	/** A provider Cairn no longer offers is a stale assignment, not a choice. */
	it("falls back to the default for a provider that cannot be forced into a shape", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{
				commitMessage: { providerId: "gemini", model: "", promptTemplate: "" },
			},
			installed(ASSIST_CLI),
		);
		expect(resolved.providerId).toBe(ASSIST_CLI);
		expect(resolved.unavailable).toBe(false);
	});

	it("keeps the pinned model and the custom template", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{
				commitMessage: {
					providerId: "",
					model: "opus",
					promptTemplate: "Write it my way.",
				},
			},
			installed(ASSIST_CLI),
		);
		expect(resolved.model).toBe("opus");
		expect(resolved.promptTemplate).toBe("Write it my way.");
	});

	it("falls back to the built-in template when the custom one is blank", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{ commitMessage: { providerId: "", model: "", promptTemplate: "   " } },
			installed(ASSIST_CLI),
		);
		expect(resolved.promptTemplate).toContain("Conventional Commits");
	});
});

describe("the assist CLI list", () => {
	/** Mirrors HEADLESS_CLIS in commands/oneshot.rs; the Rust side is the authority. */
	it("offers only the CLIs that can be held to a schema", () => {
		expect([...ASSIST_CLIS]).toEqual(["claude-code", "codex"]);
	});

	/**
	 * `cli-providers.ts` spells the same list out rather than importing it, to
	 * keep the feature registry out of every consumer of that store. This is
	 * what keeps the two from drifting: every offered CLI must be one that store
	 * reports as usable when it is installed.
	 */
	it("matches the list the provider store answers for", async () => {
		const { anyAssistCliInstalled, cliProviders } = await import(
			"$lib/stores/cli-providers"
		);
		for (const id of ASSIST_CLIS) {
			cliProviders.set([{ id, installed: true } as never]);
			expect(get(anyAssistCliInstalled)).toBe(true);
		}
		cliProviders.set([{ id: "gemini", installed: true } as never]);
		expect(get(anyAssistCliInstalled)).toBe(false);
	});
});

describe("the feature schemas", () => {
	it("asks the commit message for its two fields", () => {
		expect(FEATURE_SCHEMAS.commitMessage.required).toEqual(["subject", "body"]);
	});

	it("asks the merge request for its two fields", () => {
		expect(FEATURE_SCHEMAS.mrDescription.required).toEqual([
			"title",
			"description",
		]);
	});

	/** A field the model may invent is a field nobody reads. */
	it("closes both shapes to extra fields", () => {
		expect(FEATURE_SCHEMAS.commitMessage.additionalProperties).toBe(false);
		expect(FEATURE_SCHEMAS.mrDescription.additionalProperties).toBe(false);
	});
});
