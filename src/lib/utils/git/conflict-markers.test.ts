// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { hasConflictMarkers } from "./conflict-markers";

const CONFLICT = `line before
<<<<<<< HEAD
ours
=======
theirs
>>>>>>> feature
line after`;

describe("hasConflictMarkers", () => {
	it("sees an unresolved conflict", () => {
		expect(hasConflictMarkers(CONFLICT)).toBe(true);
	});

	it("sees nothing in plain text", () => {
		expect(hasConflictMarkers("just a file\nwith lines")).toBe(false);
		expect(hasConflictMarkers("")).toBe(false);
	});

	it("needs both ends of the pair", () => {
		expect(hasConflictMarkers("<<<<<<< HEAD\nours")).toBe(false);
		expect(hasConflictMarkers("theirs\n>>>>>>> feature")).toBe(false);
	});

	it("requires the marker at the start of a line", () => {
		expect(hasConflictMarkers("a <<<<<<< b\nc >>>>>>> d")).toBe(false);
	});

	it("accepts the closing marker before the opening one, as the regexes do", () => {
		expect(hasConflictMarkers(">>>>>>> a\n<<<<<<< b")).toBe(true);
	});

	it("reads a marker on the very first line", () => {
		expect(hasConflictMarkers("<<<<<<< HEAD\n>>>>>>> other")).toBe(true);
	});

	it("is not fooled by a shorter run of angle brackets", () => {
		expect(hasConflictMarkers("<<<<<< six\n>>>>>> six")).toBe(false);
	});

	it("still matches when the run is longer than seven", () => {
		expect(hasConflictMarkers("<<<<<<<< eight\n>>>>>>>> eight")).toBe(true);
	});

	it("finds markers in a CRLF file", () => {
		expect(hasConflictMarkers(CONFLICT.replace(/\n/g, "\r\n"))).toBe(true);
	});

	it("treats a marker inside a code fence as a real one, since it cannot tell", () => {
		expect(hasConflictMarkers("```\n<<<<<<< a\n>>>>>>> b\n```")).toBe(true);
	});
});
