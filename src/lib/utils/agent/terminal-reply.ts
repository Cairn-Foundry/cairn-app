// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const ESC = "\u001b";

const TERMINAL_REPLY = new RegExp(
	`^${ESC}(?:\\[[IO]|\\[[?>]?[\\d;]*[cRn]|\\[[?\\d;]*\\$y|[\\]P][\\s\\S]*)$`,
);

/**
 * Whether input that reached the PTY was produced by the terminal itself (a
 * reply to a query of the CLI, a focus report) rather than typed by the user.
 */
export function isTerminalReply(data: string): boolean {
	return TERMINAL_REPLY.test(data);
}
