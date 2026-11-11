// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { isTerminalReply } from "./terminal-reply";

describe("isTerminalReply", () => {
	it.each([
		"\u001b[I",
		"\u001b[O",
		"\u001b[?1;2c",
		"\u001b[>0;276;0c",
		"\u001b[12;40R",
		"\u001b[0n",
		"\u001b[?2004;2$y",
		"\u001b]11;rgb:0000/0000/0000\u001b\\",
	])("treats %j as a reply of the terminal", (data) => {
		expect(isTerminalReply(data)).toBe(true);
	});

	it.each([
		"a",
		"\r",
		"\u001b[A",
		"\u001b[1;5C",
		"\u001b",
		"hello world",
		"\u001b[200~x",
	])("treats %j as typed by the user", (data) => {
		expect(isTerminalReply(data)).toBe(false);
	});
});
