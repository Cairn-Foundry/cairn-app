// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ScrollMetrics {
	scrollLeft: number;
	scrollWidth: number;
	clientWidth: number;
}

export interface SliderThumb {
	left: number;
	width: number;
}

export const MIN_THUMB_WIDTH = 32;

/** Null when nothing overflows. */
export function sliderThumb({
	scrollLeft,
	scrollWidth,
	clientWidth,
}: ScrollMetrics): SliderThumb | null {
	const range = scrollWidth - clientWidth;
	if (range <= 1 || clientWidth <= 0) return null;
	const width = Math.min(
		clientWidth,
		Math.max(MIN_THUMB_WIDTH, (clientWidth * clientWidth) / scrollWidth),
	);
	const left =
		(Math.min(Math.max(scrollLeft, 0), range) / range) * (clientWidth - width);
	return { left, width };
}

export function scrollForThumb(
	thumbLeft: number,
	metrics: ScrollMetrics,
): number {
	const thumb = sliderThumb(metrics);
	if (!thumb) return 0;
	const travel = metrics.clientWidth - thumb.width;
	const range = metrics.scrollWidth - metrics.clientWidth;
	if (travel <= 0) return 0;
	return (Math.min(Math.max(thumbLeft, 0), travel) / travel) * range;
}
