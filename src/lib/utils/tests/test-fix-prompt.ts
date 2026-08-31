// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The prompt handed to the Agent step for a failing test. It is a starting
// point, not an order: the user reads it, adds what only they know, and sends.

import type { TestCase, TestRunnerId } from "$lib/types/tests";
import { type RunScope, scopedCommand } from "./test-scope";

/** How many stack frames are worth quoting; past that it is the runner's own plumbing. */
const MAX_FRAMES = 8;

/**
 * Describes the failure the way the user sees it in the detail panel - name,
 * location, expected against received, message, project frames - and asks for a
 * fix, without deciding whether the code or the test is what is wrong. That
 * call belongs to the user, who adds it before sending.
 */
export function buildTestFixPrompt(
	testCase: TestCase,
	runnerId: TestRunnerId,
	command: string,
	isWindows = false,
): string {
	const location = testCase.failure?.location;
	const line = location?.line ?? testCase.line;
	const where = line ? `${testCase.file}:${line}` : testCase.file;
	const suite =
		testCase.ancestors.length > 0 ? testCase.ancestors.join(" > ") : "";

	const parts: string[] = [
		`A test is failing in this worktree. Find out why and fix it.`,
		"",
		`Test: ${suite ? `${suite} > ` : ""}${testCase.name}`,
		`Location: ${where}`,
	];

	const failure = testCase.failure;
	if (failure) {
		if (failure.expected !== null || failure.received !== null) {
			parts.push(
				`Expected: ${failure.expected ?? "-"}`,
				`Received: ${failure.received ?? "-"}`,
			);
		}
		if (failure.message.trim() !== "") {
			parts.push("", "Failure:", "```", failure.message.trim(), "```");
		}

		const frames = failure.stack
			.filter((f) => f.inProject)
			.slice(0, MAX_FRAMES);
		if (frames.length > 0) {
			parts.push(
				"",
				"Stack (project frames only):",
				...frames.map((f) => `  at ${f.file}:${f.line}:${f.column}`),
			);
		}
	}

	const scope: RunScope = {
		kind: "case",
		file: testCase.file,
		name: testCase.name,
	};
	parts.push(
		"",
		"Re-run just this test to check your fix:",
		"```",
		scopedCommand(command, runnerId, scope, isWindows),
		"```",
	);

	return parts.join("\n");
}
