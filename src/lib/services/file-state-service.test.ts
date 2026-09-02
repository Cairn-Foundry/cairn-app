// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FileState,
	flushFileStates,
	saveFileState,
} from "./file-state-service";

const mockInvoke = vi.mocked(invoke);

const stateWith = (recent: string[]): FileState => ({
	panes: [],
	expanded: [],
	splitMode: false,
	splitLeftWidth: 0.5,
	recentFiles: recent,
});

/** The states the backend actually received, in order. */
const written = () =>
	mockInvoke.mock.calls
		.filter((c) => c[0] === "save_file_state")
		.map((c) => c[1] as { instanceId: string; state: FileState });

beforeEach(() => {
	vi.useFakeTimers();
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

afterEach(() => {
	flushFileStates();
	vi.useRealTimers();
});

describe("saveFileState", () => {
	it("coalesces a burst on one instance into a single write of the last state", () => {
		saveFileState("p", "i", stateWith(["a"]));
		saveFileState("p", "i", stateWith(["a", "b"]));
		saveFileState("p", "i", stateWith(["a", "b", "c"]));
		expect(written()).toHaveLength(0);

		vi.advanceTimersByTime(400);
		expect(written()).toHaveLength(1);
		expect(written()[0].state.recentFiles).toEqual(["a", "b", "c"]);
	});

	it("keeps a timer per instance, so switching away still saves the one left behind", () => {
		saveFileState("p", "one", stateWith(["a"]));
		saveFileState("p", "two", stateWith(["b"]));

		vi.advanceTimersByTime(400);
		const ids = written().map((w) => w.instanceId);
		expect(ids).toHaveLength(2);
		expect(new Set(ids)).toEqual(new Set(["one", "two"]));
	});

	it("starts a new window once the pending write has landed", () => {
		saveFileState("p", "i", stateWith(["a"]));
		vi.advanceTimersByTime(400);
		saveFileState("p", "i", stateWith(["b"]));
		vi.advanceTimersByTime(400);

		expect(written().map((w) => w.state.recentFiles)).toEqual([["a"], ["b"]]);
	});
});

describe("flushFileStates", () => {
	it("writes what is pending instead of losing it when the window closes", () => {
		saveFileState("p", "i", stateWith(["a"]));
		flushFileStates();

		expect(written()).toHaveLength(1);
		expect(written()[0].state.recentFiles).toEqual(["a"]);
	});

	it("cancels the timer it flushed, so the state is not written twice", () => {
		saveFileState("p", "i", stateWith(["a"]));
		flushFileStates();
		vi.advanceTimersByTime(400);

		expect(written()).toHaveLength(1);
	});

	it("is a no-op when nothing is pending", () => {
		flushFileStates();
		expect(written()).toHaveLength(0);
	});
});
