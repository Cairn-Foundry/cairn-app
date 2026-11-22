// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The prompt handed to the Agent step for a failing test. It is a starting
// point, not an order: the user reads it, adds what only they know, and sends.

import type { AiFeatureAssignment } from "#lib/services/settings-service";
import type { TestCase, TestRunnerId } from "#lib/types/tests";
import {
	renderPromptTemplate,
	templateOf,
} from "#lib/utils/integrations/prompts";
import { type RunScope, scopedCommand } from "./test-scope";

/** How many stack frames are worth quoting; past that it is the runner's own plumbing. */
const MAX_FRAMES = 8;

/**
 * Describes the failure the way the user sees it in the detail panel - name,
 * location, expected against received, message, project frames - through the
 * test fix template, the user's or the default. A part the runner did not
 * report expands to nothing, and the blank lines it leaves are folded.
 */
export function buildTestFixPrompt(
	testCase: TestCase,
	runnerId: TestRunnerId,
	command: string,
	isWindows = false,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	const location = testCase.failure?.location;
	const line = location?.line ?? testCase.line;
	const suite =
		testCase.ancestors.length > 0 ? `${testCase.ancestors.join(" > ")} > ` : "";
	const failure = testCase.failure;

	const hasComparison =
		failure !== null &&
		(failure.expected !== null || failure.received !== null);
	const message = failure?.message.trim() ?? "";
	const frames = (failure?.stack ?? [])
		.filter((f) => f.inProject)
		.slice(0, MAX_FRAMES);
	const scope: RunScope = {
		kind: "case",
		file: testCase.file,
		name: testCase.name,
	};

	const rendered = renderPromptTemplate(templateOf("testFix", assignments), {
		test: `${suite}${testCase.name}`,
		location: line ? `${testCase.file}:${line}` : testCase.file,
		comparison: hasComparison
			? `Expected: ${failure?.expected ?? "-"}\nReceived: ${failure?.received ?? "-"}`
			: "",
		failure: message ? `Failure:\n\`\`\`\n${message}\n\`\`\`` : "",
		stack:
			frames.length > 0
				? [
						"Stack (project frames only):",
						...frames.map((f) => `  at ${f.file}:${f.line}:${f.column}`),
					].join("\n")
				: "",
		command: scopedCommand(command, runnerId, scope, isWindows),
	});
	return rendered.replace(/\n{3,}/g, "\n\n").trim();
}
