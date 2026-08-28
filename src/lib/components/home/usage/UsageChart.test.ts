import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import UsageChart, { type ChartBar } from "./UsageChart.svelte";

function bar(value: number, overrides: Partial<ChartBar> = {}): ChartBar {
	return { label: "", value, title: `${value}`, ...overrides };
}

function mount(bars: ChartBar[], props: Record<string, unknown> = {}) {
	return render(UsageChart, {
		bars,
		format: (v: number) => String(Math.round(v)),
		...props,
	});
}

const columns = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".bar"));
const heights = () =>
	columns().map((c) => Number.parseFloat(c.style.height) || 0);
const axisLabels = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".tick-x"));
const scaleTicks = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".tick")).map(
		(t) => t.textContent,
	);

describe("UsageChart", () => {
	describe("the bars", () => {
		it("draws one column per entry", () => {
			mount([bar(1), bar(2), bar(3)]);
			expect(columns()).toHaveLength(3);
		});

		it("scales every bar against the tallest one", () => {
			mount([bar(100), bar(50), bar(25)]);
			expect(heights()).toEqual([100, 50, 25]);
		});

		/**
		 * A day that cost almost nothing still happened: it keeps a sliver of
		 * bar so it never looks identical to a day with no activity at all.
		 */
		it("keeps a visible sliver for a tiny value", () => {
			mount([bar(10000), bar(1)]);
			const [tall, tiny] = heights();
			expect(tall).toBe(100);
			expect(tiny).toBeGreaterThanOrEqual(2);
		});

		it("draws nothing for a value of zero", () => {
			mount([bar(100), bar(0)]);
			expect(heights()[1]).toBe(0);
		});

		it("marks an empty column apart from one that merely rounds small", () => {
			mount([bar(100), bar(0), bar(1)]);
			const [, empty, tiny] = columns();
			expect(empty.classList.contains("empty")).toBe(true);
			expect(tiny.classList.contains("empty")).toBe(false);
		});

		/**
		 * Read as the raw style rather than a parsed number: dividing by a zero
		 * maximum yields NaN, and "height: NaN%" parses back to 0, so a parsed
		 * assertion cannot tell a guarded zero from an unguarded one.
		 */
		it("draws no bar at all when every value is zero", () => {
			mount([bar(0), bar(0)]);
			const raw = columns().map((c) => c.style.height);
			expect(raw).toEqual(["0%", "0%"]);
			for (const h of raw) expect(h).not.toContain("NaN");
		});

		it("sets the current column apart", () => {
			mount([bar(1), bar(2, { current: true })]);
			expect(columns()[1].classList.contains("current")).toBe(true);
			expect(columns()[0].classList.contains("current")).toBe(false);
		});

		it("carries the title each column was given", () => {
			mount([bar(5, { title: "12 March: 5 requests" })]);
			expect(document.querySelector(".col")?.getAttribute("title")).toBe(
				"12 March: 5 requests",
			);
		});

		/**
		 * A new tallest value rescales every other column. Their own values have
		 * not changed, so the redraw has to come from the maximum moving.
		 */
		it("rescales the other columns when a taller one arrives", async () => {
			const { rerender } = mount([bar(50), bar(100)]);
			expect(heights()).toEqual([50, 100]);
			await rerender({
				bars: [bar(50), bar(200)],
				format: (v: number) => String(Math.round(v)),
			});
			expect(heights()).toEqual([25, 100]);
		});
	});

	describe("the scale", () => {
		it("labels the top, the middle and the bottom", () => {
			mount([bar(200)]);
			expect(scaleTicks()).toEqual(["200", "100", "0"]);
		});

		/** With nothing measured there is no scale to draw, only the baseline. */
		it("shows a single baseline when everything is zero", () => {
			mount([bar(0), bar(0)]);
			expect(scaleTicks()).toEqual(["0"]);
		});

		it("formats the scale through the formatter it was given", () => {
			mount([bar(1500)], { format: (v: number) => `$${v / 100}` });
			expect(scaleTicks()[0]).toBe("$15");
		});
	});

	describe("the axis labels", () => {
		it("shows only the labels that were filled in", () => {
			mount([bar(1, { label: "Mon" }), bar(2), bar(3, { label: "Wed" })]);
			expect(axisLabels().map((l) => l.textContent)).toEqual(["Mon", "Wed"]);
		});

		it("centres a label over the middle of its own column", () => {
			mount([bar(1), bar(2, { label: "mid" }), bar(3)]);
			const label = axisLabels()[0];
			expect(label.style.left).toBe("50%");
			expect(label.style.transform).toContain("-50%");
		});

		/**
		 * Centring the first and last labels would hang them outside the plot and
		 * drag the page sideways, so the edge ones align to their own side.
		 */
		it("aligns the first label to the left edge rather than centring it", () => {
			const bars = Array.from({ length: 20 }, (_, i) => bar(i + 1));
			bars[0].label = "first";
			mount(bars);
			expect(axisLabels()[0].style.transform).toContain("0");
			expect(axisLabels()[0].style.transform).not.toContain("-50%");
		});

		it("aligns the last label to the right edge", () => {
			const bars = Array.from({ length: 20 }, (_, i) => bar(i + 1));
			bars[19].label = "last";
			mount(bars);
			expect(axisLabels()[0].style.transform).toContain("-100%");
		});

		it("shows no axis at all when no column is labelled", () => {
			mount([bar(1), bar(2)]);
			expect(axisLabels()).toHaveLength(0);
		});
	});

	describe("edge cases", () => {
		it("renders an empty series without breaking", () => {
			mount([]);
			expect(columns()).toHaveLength(0);
			expect(axisLabels()).toHaveLength(0);
		});

		it("takes the height the caller asked for", () => {
			mount([bar(1)], { height: 240 });
			expect(
				(document.querySelector(".chart") as HTMLElement).style.cssText,
			).toContain("240px");
		});

		it("draws a single column at full height", () => {
			mount([bar(7)]);
			expect(heights()).toEqual([100]);
		});
	});
});
