// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { renderCommitPrompt } from "./commit-message";

describe("renderCommitPrompt", () => {
	it("asks for the ticket when the instance carries one", () => {
		const rendered = renderCommitPrompt("Subject rules.{{ticket}}", "CAI-42");
		expect(rendered).toContain("CAI-42");
	});

	it("expands to nothing without a ticket", () => {
		expect(renderCommitPrompt("Subject rules.{{ticket}}", "")).toBe(
			"Subject rules.",
		);
	});

	it("leaves a template with no placeholder alone", () => {
		expect(renderCommitPrompt("Write a message.", "CAI-1")).toBe(
			"Write a message.",
		);
	});

	it("expands the ticket fields verbatim", () => {
		expect(
			renderCommitPrompt(
				"Key {{ticket.key}}, title {{ticket.title}}, url {{ticket.url}}.",
				"CAI-1",
				{ key: "CAI-1", title: "Add login", url: "https://j/CAI-1" },
			),
		).toBe("Key CAI-1, title Add login, url https://j/CAI-1.");
	});

	it("falls back to the typed id for the key and to nothing for the rest", () => {
		expect(
			renderCommitPrompt(
				"{{ticket.key}}|{{ticket.title}}|{{ticket.url}}",
				"X-9",
			),
		).toBe("X-9||");
	});
});
