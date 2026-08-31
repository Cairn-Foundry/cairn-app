// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	formatByteSize,
	formatHexDump,
	hexToBytes,
	previewKindFromPath,
	svgDataUrl,
} from "./files-preview";

describe("previewKindFromPath", () => {
	it("recognizes bitmap images", () => {
		expect(previewKindFromPath("src/assets/logo.PNG")).toBe("image");
		expect(previewKindFromPath("a/b/photo.jpeg")).toBe("image");
		expect(previewKindFromPath("icon.avif")).toBe("image");
	});

	it("recognizes svg and pdf", () => {
		expect(previewKindFromPath("icons/arrow.svg")).toBe("svg");
		expect(previewKindFromPath("docs/spec.pdf")).toBe("pdf");
	});

	it("falls back to binary", () => {
		expect(previewKindFromPath("build/app.wasm")).toBe("binary");
		expect(previewKindFromPath("LICENSE")).toBe("binary");
	});
});

describe("svgDataUrl", () => {
	it("percent-encodes the source", () => {
		expect(svgDataUrl('<svg id="a"/>')).toBe(
			"data:image/svg+xml;charset=utf-8,%3Csvg%20id%3D%22a%22%2F%3E",
		);
	});
});

describe("formatByteSize", () => {
	it("keeps small sizes in bytes", () => {
		expect(formatByteSize(0)).toBe("0 B");
		expect(formatByteSize(1023)).toBe("1023 B");
	});

	it("scales up with one decimal below ten", () => {
		expect(formatByteSize(1536)).toBe("1.5 KB");
		expect(formatByteSize(1024 * 1024 * 20)).toBe("20 MB");
	});
});

describe("hexToBytes", () => {
	it("parses a hex string", () => {
		expect(Array.from(hexToBytes("00ff10"))).toEqual([0, 255, 16]);
	});

	it("ignores a trailing half byte", () => {
		expect(Array.from(hexToBytes("00f"))).toEqual([0]);
	});
});

describe("formatHexDump", () => {
	it("lays out sixteen bytes per line with an ascii column", () => {
		const bytes = new Uint8Array(20);
		bytes.set([0x68, 0x69, 0x00], 0);
		const lines = formatHexDump(bytes).split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(
			"00000000  68 69 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |hi..............|",
		);
		expect(lines[1].startsWith("00000010  00 00 00 00")).toBe(true);
	});

	it("pads a short trailing line", () => {
		const lines = formatHexDump(new Uint8Array([0x41])).split("\n");
		expect(lines[0].endsWith("|A|")).toBe(true);
		expect(lines[0]).toHaveLength(
			formatHexDump(new Uint8Array(16)).length - 15,
		);
	});
});
