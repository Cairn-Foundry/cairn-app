import { describe, expect, it } from "vitest";
import { toHexColor } from "./color";

describe("toHexColor", () => {
	it("passes hex colours through", () => {
		expect(toHexColor("#1a2b3c")).toBe("#1a2b3c");
	});

	it("expands short hex colours", () => {
		expect(toHexColor("#abc")).toBe("#aabbcc");
	});

	it("converts oklch black and white", () => {
		expect(toHexColor("oklch(0 0 0)")).toBe("#000000");
		expect(toHexColor("oklch(1 0 0)")).toBe("#ffffff");
	});

	it("converts a chromatic oklch colour", () => {
		expect(toHexColor("oklch(0.72 0.19 295)")).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("accepts a percentage lightness", () => {
		expect(toHexColor("oklch(100% 0 0)")).toBe("#ffffff");
	});

	it("falls back to black on an unsupported notation", () => {
		expect(toHexColor("rebeccapurple")).toBe("#000000");
	});
});
