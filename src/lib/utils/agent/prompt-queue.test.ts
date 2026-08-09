import { describe, expect, it } from "vitest";
import { mergeIntoDraft } from "./prompt-queue";

describe("mergeIntoDraft", () => {
	it("keeps what was waiting in the order it was written, draft last", () => {
		expect(mergeIntoDraft(["first", "second"], "being typed")).toBe(
			"first\n\nsecond\n\nbeing typed",
		);
	});

	it("returns a lone prompt untouched when nothing was being typed", () => {
		expect(mergeIntoDraft(["only"], "")).toBe("only");
	});

	it("leaves no blank lines behind when an entry is empty", () => {
		expect(mergeIntoDraft(["kept", "   "], "typed")).toBe("kept\n\ntyped");
	});

	it("is empty when there is nothing to put back", () => {
		expect(mergeIntoDraft([], "  ")).toBe("");
	});
});
