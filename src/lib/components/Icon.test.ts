// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import Icon from "./Icon.svelte";
import { ICONS } from "./icon-paths";

/** The svg the component drew. */
const svg = (container: HTMLElement) =>
	container.querySelector("svg") as SVGElement;

/** A name the catalogue carries, whatever it holds today. */
const KNOWN = Object.keys(ICONS)[0];
/** A stroked icon and a solid one, when the catalogue has both. */
const STROKED = Object.entries(ICONS).find(([, def]) => !def.solid)?.[0];
const SOLID = Object.entries(ICONS).find(([, def]) => def.solid)?.[0];

describe("Icon", () => {
	it("draws the icon it is asked for", () => {
		const { container } = render(Icon, { name: KNOWN });
		expect(svg(container)).not.toBeNull();
		expect(svg(container).innerHTML.length).toBeGreaterThan(0);
	});

	it("draws at the size it is given", () => {
		const { container } = render(Icon, { name: KNOWN, size: 24 });
		expect(svg(container).getAttribute("width")).toBe("24");
		expect(svg(container).getAttribute("height")).toBe("24");
	});

	it("draws at a default size when given none", () => {
		const { container } = render(Icon, { name: KNOWN });
		expect(Number(svg(container).getAttribute("width"))).toBeGreaterThan(0);
	});

	it("keeps the same viewBox whatever the size, so it scales", () => {
		const { container: small } = render(Icon, { name: KNOWN, size: 10 });
		const { container: large } = render(Icon, { name: KNOWN, size: 32 });
		expect(svg(small).getAttribute("viewBox")).toBe(
			svg(large).getAttribute("viewBox"),
		);
	});

	/** The icon takes the colour of the text around it rather than its own. */
	it("follows the colour of the surrounding text", () => {
		const { container } = render(Icon, { name: KNOWN });
		const element = svg(container);
		// One of the two paints the shape and the other is off, depending on
		// whether the icon is solid or stroked.
		expect([
			element.getAttribute("stroke"),
			element.getAttribute("fill"),
		]).toContain("currentColor");
	});

	it("names itself in a class, so a caller can style one icon", () => {
		const { container } = render(Icon, { name: KNOWN });
		expect(svg(container).classList.contains("ic")).toBe(true);
		expect(svg(container).classList.contains(`ic-${KNOWN}`)).toBe(true);
	});

	it("keeps a class the caller passes alongside its own", () => {
		const { container } = render(Icon, { name: KNOWN, class: "mine" });
		expect(svg(container).classList.contains("ic")).toBe(true);
		expect(svg(container).classList.contains("mine")).toBe(true);
	});

	/**
	 * A name nobody knows draws the fallback rather than an empty box, so a
	 * typo shows as a visible icon instead of a hole in the interface.
	 */
	it("draws a fallback for a name the catalogue does not carry", () => {
		const { container } = render(Icon, { name: "no-such-icon" });
		expect(svg(container)).not.toBeNull();
		expect(svg(container).innerHTML.length).toBeGreaterThan(0);
	});

	it("draws a fallback for an empty name", () => {
		const { container } = render(Icon, { name: "" });
		expect(svg(container).innerHTML.length).toBeGreaterThan(0);
	});

	it("strokes an outline icon and fills a solid one", () => {
		if (STROKED) {
			const { container } = render(Icon, { name: STROKED });
			expect(svg(container).getAttribute("stroke")).toBe("currentColor");
			expect(svg(container).getAttribute("fill")).toBe("none");
		}
		if (SOLID) {
			const { container } = render(Icon, { name: SOLID });
			expect(svg(container).getAttribute("fill")).toBe("currentColor");
			expect(svg(container).getAttribute("stroke")).toBe("none");
		}
	});

	it("takes the stroke width it is given on an outline icon", () => {
		if (!STROKED) return;
		const { container } = render(Icon, { name: STROKED, sw: 3 });
		expect(svg(container).getAttribute("stroke-width")).toBe("3");
	});

	it("rounds the ends of an outline icon", () => {
		if (!STROKED) return;
		const { container } = render(Icon, { name: STROKED });
		expect(svg(container).getAttribute("stroke-linecap")).toBe("round");
		expect(svg(container).getAttribute("stroke-linejoin")).toBe("round");
	});

	it("passes an attribute the caller sets through to the svg", () => {
		const { container } = render(Icon, {
			name: KNOWN,
			"aria-hidden": "true",
		});
		expect(svg(container).getAttribute("aria-hidden")).toBe("true");
	});

	it("draws every icon of the catalogue without failing", () => {
		for (const name of Object.keys(ICONS)) {
			const { container } = render(Icon, { name });
			expect(svg(container).innerHTML.length, name).toBeGreaterThan(0);
		}
	});
});
