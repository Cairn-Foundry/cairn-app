// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persist, reportPersistError } from "./persist-error";

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("reportPersistError", () => {
	it("names what failed to save and carries the cause", () => {
		const cause = new Error("EACCES");
		reportPersistError("settings", cause);
		expect(error).toHaveBeenCalledWith(
			"[cairn] failed to save settings:",
			cause,
		);
	});

	it("reports a rejection that is not an Error", () => {
		reportPersistError("ui state", "disk full");
		expect(error).toHaveBeenCalledWith(
			"[cairn] failed to save ui state:",
			"disk full",
		);
	});

	it("still reports when the rejection carries nothing", () => {
		reportPersistError("conversation", undefined);
		expect(error).toHaveBeenCalledWith(
			"[cairn] failed to save conversation:",
			undefined,
		);
	});
});

describe("persist", () => {
	it("stays quiet when the write lands", async () => {
		persist("settings", Promise.resolve());
		await Promise.resolve();
		expect(error).not.toHaveBeenCalled();
	});

	it("reports a rejected write instead of swallowing it", async () => {
		const cause = new Error("ENOSPC");
		persist("settings", Promise.reject(cause));
		await Promise.resolve();
		expect(error).toHaveBeenCalledWith(
			"[cairn] failed to save settings:",
			cause,
		);
	});

	it("does not reject its own caller, since nothing awaits it", async () => {
		expect(() =>
			persist("settings", Promise.reject(new Error("x"))),
		).not.toThrow();
		await Promise.resolve();
		expect(error).toHaveBeenCalled();
	});

	it("reports each failed write separately", async () => {
		persist("a", Promise.reject(new Error("1")));
		persist("b", Promise.reject(new Error("2")));
		await Promise.resolve();
		await Promise.resolve();
		expect(error).toHaveBeenCalledTimes(2);
	});

	it("resolves a write that answers with a value without reporting it", async () => {
		persist("settings", Promise.resolve({ ok: true }));
		await Promise.resolve();
		expect(error).not.toHaveBeenCalled();
	});
});
