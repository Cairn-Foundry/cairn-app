// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormattingConfig } from "$lib/services/formatting-service";
import { formatting } from "./formatting";

const getProjectFormatting = vi.hoisted(() => vi.fn());
const saveProjectFormatting = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/formatting-service", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getProjectFormatting,
	saveProjectFormatting,
	listFormatters: vi.fn().mockResolvedValue([]),
	listStyleOptions: vi.fn().mockResolvedValue([]),
}));

const onDisk: FormattingConfig = {
	enabled: true,
	formatOnSave: true,
	respectRepoConfig: false,
	base: { indentSize: 8, lineWidth: 100 },
	languages: [
		{
			languageId: "javascript",
			enabled: true,
			formatterId: "",
			command: "",
			args: [],
			style: { quoteStyle: "single" },
		},
	],
};

describe("the formatting store", () => {
	beforeEach(() => {
		getProjectFormatting.mockReset().mockResolvedValue(structuredClone(onDisk));
		saveProjectFormatting.mockReset().mockResolvedValue(undefined);
	});

	it("merges a patch onto what the project has on disk", async () => {
		await formatting.loadProject("p1");
		await formatting.saveProject("p1", { base: { indentSize: 4 } });

		const written = saveProjectFormatting.mock.calls[0][1] as FormattingConfig;
		expect(written.base).toEqual({ indentSize: 4 });
		expect(written.formatOnSave).toBe(true);
		expect(written.languages).toHaveLength(1);
	});

	it("reads the project before saving when it never was", async () => {
		await formatting.saveProject("p2", { base: { indentSize: 4 } });

		expect(getProjectFormatting).toHaveBeenCalledWith("p2");
		const written = saveProjectFormatting.mock.calls[0][1] as FormattingConfig;
		// Everything the project had set survives the one edit rather than being
		// replaced by the catalogue defaults.
		expect(written.formatOnSave).toBe(true);
		expect(written.respectRepoConfig).toBe(false);
		expect(written.languages).toHaveLength(1);
	});

	it("writes nothing when the project cannot be read", async () => {
		getProjectFormatting.mockRejectedValue(new Error("unreadable"));
		await formatting.saveProject("p3", { base: { indentSize: 4 } });

		expect(saveProjectFormatting).not.toHaveBeenCalled();
		expect(get(formatting.projects).p3).toBeUndefined();
	});
});
