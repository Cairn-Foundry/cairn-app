// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { MIN_THUMB_WIDTH, scrollForThumb, sliderThumb } from "./scroll-slider";

describe("sliderThumb", () => {
	it("has no thumb when nothing overflows", () => {
		expect(
			sliderThumb({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }),
		).toBeNull();
		expect(
			sliderThumb({ scrollLeft: 0, scrollWidth: 401, clientWidth: 400 }),
		).toBeNull();
	});

	it("sizes the thumb to the visible share and moves it with the scroll", () => {
		expect(
			sliderThumb({ scrollLeft: 0, scrollWidth: 800, clientWidth: 400 }),
		).toEqual({ left: 0, width: 200 });
		expect(
			sliderThumb({ scrollLeft: 200, scrollWidth: 800, clientWidth: 400 }),
		).toEqual({ left: 100, width: 200 });
		expect(
			sliderThumb({ scrollLeft: 400, scrollWidth: 800, clientWidth: 400 }),
		).toEqual({ left: 200, width: 200 });
	});

	it("keeps the thumb wide enough to grab and inside the track", () => {
		expect(
			sliderThumb({ scrollLeft: 0, scrollWidth: 100_000, clientWidth: 400 })
				?.width,
		).toBe(MIN_THUMB_WIDTH);
		expect(
			sliderThumb({ scrollLeft: 9_999, scrollWidth: 800, clientWidth: 400 }),
		).toEqual({ left: 200, width: 200 });
	});
});

describe("scrollForThumb", () => {
	const metrics = { scrollLeft: 0, scrollWidth: 800, clientWidth: 400 };

	it("maps the thumb position back to a scroll offset", () => {
		expect(scrollForThumb(100, metrics)).toBe(200);
		expect(scrollForThumb(200, metrics)).toBe(400);
	});

	it("clamps a thumb dragged past either end", () => {
		expect(scrollForThumb(-50, metrics)).toBe(0);
		expect(scrollForThumb(900, metrics)).toBe(400);
	});

	it("answers 0 when nothing overflows", () => {
		expect(
			scrollForThumb(50, { scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }),
		).toBe(0);
	});
});
