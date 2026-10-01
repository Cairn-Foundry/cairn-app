// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { CliProviderId } from "$lib/services/cli-provider-service";
import {
	freshArgv,
	mintsSessionId,
	newConversationArgv,
	resumeArgv,
	statusArgv,
} from "./cli-launch";

const ALL: CliProviderId[] = [
	"claude-code",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"antigravity",
	"vibe",
];

const SID = "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70";

describe("reopening a conversation", () => {
	it("names the exact conversation, whatever the CLI calls the flag", () => {
		expect(resumeArgv("claude-code", SID)).toEqual(["claude", "--resume", SID]);
		expect(resumeArgv("gemini", SID)).toEqual(["gemini", "--resume", SID]);
		expect(resumeArgv("vibe", SID)).toEqual(["vibe", "--resume", SID]);
		expect(resumeArgv("copilot", SID)).toEqual(["copilot", `--resume=${SID}`]);
		expect(resumeArgv("codex", SID)).toEqual(["codex", "resume", SID]);
		expect(resumeArgv("opencode", SID)).toEqual(["opencode", "--session", SID]);
		expect(resumeArgv("antigravity", SID)).toEqual([
			"agy",
			"--conversation",
			SID,
		]);
	});

	/**
	 * The flags meaning "carry on with the most recent one" must never appear:
	 * the user picked one conversation out of a list, and any of these would open
	 * a different one.
	 */
	it("never asks a CLI to resume whatever ran last", () => {
		for (const cli of ALL) {
			const argv = resumeArgv(cli, SID);
			for (const forbidden of ["--last", "--continue", "-c"]) {
				expect(argv).not.toContain(forbidden);
			}
			expect(argv.some((a) => a.includes(SID))).toBe(true);
		}
	});

	it("starts fresh when no id was ever learned, rather than opening another session", () => {
		for (const cli of ALL) {
			expect(resumeArgv(cli, null)).toEqual(freshArgv(cli));
		}
	});
});

describe("starting a conversation", () => {
	it("imposes the id on the CLIs that document the flag", () => {
		for (const cli of ["claude-code", "gemini", "copilot"] as CliProviderId[]) {
			expect(mintsSessionId(cli)).toBe(true);
			expect(newConversationArgv(cli, SID)).toEqual([
				freshArgv(cli)[0],
				"--session-id",
				SID,
			]);
		}
	});

	it("hands no invented id to a CLI that mints its own", () => {
		for (const cli of [
			"codex",
			"opencode",
			"antigravity",
			"vibe",
		] as CliProviderId[]) {
			expect(mintsSessionId(cli)).toBe(false);
			expect(newConversationArgv(cli, SID)).toBeNull();
		}
	});
});

describe("reporting whose turn it is", () => {
	it("gives Claude Code hooks that write into the file the backend names", () => {
		const [flag, json] = statusArgv("claude-code");
		expect(flag).toBe("--settings");
		const { hooks } = JSON.parse(json);
		const command = (event: string) => hooks[event][0].hooks[0].command;
		expect(command("UserPromptSubmit")).toContain("printf working");
		expect(command("PostToolUse")).toContain("printf working");
		expect(command("Notification")).toContain("printf waiting");
		expect(command("Stop")).toContain("printf done");
		expect(command("Stop")).toContain('"$CAIRN_AGENT_SIGNAL"');
	});

	it("only counts a dialog as waiting, not the idle reminder after a turn", () => {
		const { hooks } = JSON.parse(statusArgv("claude-code")[1]);
		expect(hooks.Notification[0].matcher).toBe(
			"permission_prompt|elicitation_dialog",
		);
	});

	it("adds nothing for a CLI that has no hooks", () => {
		expect(statusArgv("codex")).toEqual([]);
		expect(statusArgv("gemini")).toEqual([]);
	});
});
