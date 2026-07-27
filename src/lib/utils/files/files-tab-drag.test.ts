import { describe, expect, it } from "vitest";
import { computeTabInsertIndex } from "./files-tab-drag";

const ROW_HEIGHT = 30;

/** A vertical list of `count` rows, each 30px tall, starting at y = 0. */
function verticalList(count: number): HTMLElement {
	const bar = document.createElement("div");
	for (let i = 0; i < count; i++) {
		const row = document.createElement("div");
		row.className = "row";
		row.getBoundingClientRect = () =>
			({ top: i * ROW_HEIGHT, height: ROW_HEIGHT }) as DOMRect;
		bar.appendChild(row);
	}
	return bar;
}

const at = (bar: HTMLElement, y: number) =>
	computeTabInsertIndex(bar, y, { selector: ".row", axis: "y" });

describe("computeTabInsertIndex", () => {
	it("returns 0 on an empty container", () => {
		expect(at(verticalList(0), 40)).toBe(0);
	});

	it("inserts before a row when the pointer is in its upper half", () => {
		expect(at(verticalList(3), 35)).toBe(1);
	});

	it("inserts after the last row when the pointer is past it", () => {
		expect(at(verticalList(3), 200)).toBe(3);
	});

	it("inserts after a row when the pointer is in its lower half", () => {
		expect(at(verticalList(3), 50)).toBe(2);
	});
});
