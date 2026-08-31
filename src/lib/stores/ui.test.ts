// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import {
	commandsActive,
	envActive,
	formattingActive,
	showTool,
	terminalActive,
} from "./ui";

const TOOLS = {
	terminal: terminalActive,
	commands: commandsActive,
	env: envActive,
	formatting: formattingActive,
} as const;

type ToolName = keyof typeof TOOLS;
const NAMES = Object.keys(TOOLS) as ToolName[];

/** Which tool flags are currently on. */
const openTools = () => NAMES.filter((name) => get(TOOLS[name]));

beforeEach(() => {
	showTool(null);
});

describe("showTool", () => {
	it("opens the tool it is given", () => {
		for (const name of NAMES) {
			showTool(name);
			expect(get(TOOLS[name]), name).toBe(true);
		}
	});

	it("keeps exactly one tool open, since they share the main area", () => {
		for (const name of NAMES) {
			showTool(name);
			expect(openTools(), name).toEqual([name]);
		}
	});

	it("closes the tool that was open when another is asked for", () => {
		showTool("terminal");
		showTool("commands");
		expect(get(terminalActive)).toBe(false);
		expect(get(commandsActive)).toBe(true);
	});

	it("closes every tool when given null", () => {
		showTool("env");
		showTool(null);
		expect(openTools()).toEqual([]);
	});

	it("leaves nothing open when null is asked for twice", () => {
		showTool(null);
		showTool(null);
		expect(openTools()).toEqual([]);
	});

	it("stays on the same tool when it is asked for again", () => {
		showTool("formatting");
		showTool("formatting");
		expect(openTools()).toEqual(["formatting"]);
	});

	it("never stacks two views, whatever the order of the calls", () => {
		for (const first of NAMES) {
			for (const second of NAMES) {
				showTool(first);
				showTool(second);
				expect(openTools().length, `${first} then ${second}`).toBe(1);
			}
		}
	});

	it("recovers a single open tool from two flags left on by hand", () => {
		terminalActive.set(true);
		commandsActive.set(true);
		showTool("env");
		expect(openTools()).toEqual(["env"]);
	});
});
