import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import UpdateProgress from "./UpdateProgress.svelte";

/** The bar the component draws, read as a screen reader would find it. */
const bar = () => screen.getByRole("progressbar");
/** The filled part of the track. */
const fill = () => bar().querySelector(".fill") as HTMLElement;

describe("UpdateProgress", () => {
	it("reports how far the download went", () => {
		render(UpdateProgress, { downloaded: 50, total: 100 });
		expect(bar().getAttribute("aria-valuenow")).toBe("50");
		expect(fill().style.width).toBe("50%");
	});

	it("starts empty", () => {
		render(UpdateProgress, { downloaded: 0, total: 100 });
		expect(bar().getAttribute("aria-valuenow")).toBe("0");
		expect(fill().style.width).toBe("0%");
	});

	it("fills completely at the end", () => {
		render(UpdateProgress, { downloaded: 100, total: 100 });
		expect(bar().getAttribute("aria-valuenow")).toBe("100");
		expect(fill().style.width).toBe("100%");
	});

	it("rounds to a whole percent", () => {
		render(UpdateProgress, { downloaded: 333, total: 1000 });
		expect(bar().getAttribute("aria-valuenow")).toBe("33");
	});

	it("never reports more than a full download", () => {
		render(UpdateProgress, { downloaded: 200, total: 100 });
		expect(bar().getAttribute("aria-valuenow")).toBe("100");
		expect(fill().style.width).toBe("100%");
	});

	/**
	 * A server that sends no content length leaves the download unmeasurable,
	 * so the bar animates instead of claiming a figure it does not have.
	 */
	it("animates rather than inventing a figure when the size is unknown", () => {
		render(UpdateProgress, { downloaded: 500, total: null });
		expect(bar().hasAttribute("aria-valuenow")).toBe(false);
		expect(fill().classList.contains("indeterminate")).toBe(true);
	});

	it("animates for a total of zero too, which measures nothing", () => {
		render(UpdateProgress, { downloaded: 0, total: 0 });
		expect(bar().hasAttribute("aria-valuenow")).toBe(false);
		expect(fill().classList.contains("indeterminate")).toBe(true);
	});

	it("stops animating once a real size arrives", () => {
		const { rerender } = render(UpdateProgress, {
			downloaded: 10,
			total: null,
		});
		expect(fill().classList.contains("indeterminate")).toBe(true);
		rerender({ downloaded: 10, total: 100 });
		expect(fill().classList.contains("indeterminate")).toBe(false);
		expect(fill().style.width).toBe("10%");
	});

	it("follows the download as it advances", async () => {
		const { rerender } = render(UpdateProgress, { downloaded: 0, total: 100 });
		for (const downloaded of [25, 50, 75, 100]) {
			await rerender({ downloaded, total: 100 });
			expect(bar().getAttribute("aria-valuenow")).toBe(String(downloaded));
		}
	});

	it("declares the range a screen reader reads the figure against", () => {
		render(UpdateProgress, { downloaded: 50, total: 100 });
		expect(bar().getAttribute("aria-valuemin")).toBe("0");
		expect(bar().getAttribute("aria-valuemax")).toBe("100");
	});

	it("takes a thinner track where the caller asks for one", () => {
		render(UpdateProgress, { downloaded: 0, total: 100, thin: true });
		expect(bar().classList.contains("thin")).toBe(true);
	});

	it("uses the ordinary track by default", () => {
		render(UpdateProgress, { downloaded: 0, total: 100 });
		expect(bar().classList.contains("thin")).toBe(false);
	});
});
