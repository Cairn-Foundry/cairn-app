import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { docFromString, isDirty, lspChangesOf } from "./document-model";

describe("document model", () => {
	it("is clean while the buffer equals the disk content, whatever the object", () => {
		const saved = docFromString("a\nb");
		expect(isDirty({ doc: saved, savedDoc: saved })).toBe(false);
		expect(isDirty({ doc: docFromString("a\nb"), savedDoc: saved })).toBe(
			false,
		);
		expect(isDirty({ doc: docFromString("a\nc"), savedDoc: saved })).toBe(true);
	});

	it("emits incremental changes a server can apply in order", () => {
		const start = Text.of(["hello world", "second"]);
		const changes = ChangeSet.of(
			[
				{ from: 0, to: 5, insert: "bye" },
				{ from: 12, to: 18, insert: "2nd" },
			],
			start.length,
		);
		const out = lspChangesOf(start, changes);
		expect(out).toEqual([
			{
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 6 },
				},
				text: "2nd",
			},
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				text: "bye",
			},
		]);
	});
});
