// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFilePreview = vi.fn();
const readFileBase64 = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readFilePreview: (...a: unknown[]) => readFilePreview(...a),
	readFileBase64: (...a: unknown[]) => readFileBase64(...a),
}));

vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (p: string) => `asset://${p}`,
}));

const openPath = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
	openPath: (...a: unknown[]) => openPath(...a),
}));

const { default: BinaryPreview } = await import("./BinaryPreview.svelte");

function mount(props: Record<string, unknown> = {}) {
	return render(BinaryPreview, {
		path: "/repo/logo.png",
		kind: "image",
		source: null,
		reloadToken: 0,
		...props,
	});
}

/** Lets the load effect and its promises settle. */
async function settle() {
	await tick();
	await tick();
	await tick();
}

const image = () =>
	document.querySelector("img.preview-image") as HTMLImageElement;
const hex = () => document.querySelector(".preview-hex")?.textContent;
const message = () => document.querySelector(".preview-message")?.textContent;
const spinner = () => document.querySelector(".preview-center .spinner");
const pdf = () => document.querySelector("embed.preview-pdf") as HTMLElement;

beforeEach(() => {
	readFilePreview.mockReset();
	readFilePreview.mockResolvedValue({ size: 1024, headHex: "48656c6c6f" });
	readFileBase64.mockReset();
	readFileBase64.mockResolvedValue("QUJD");
	openPath.mockReset().mockResolvedValue(undefined);
});

describe("BinaryPreview", () => {
	describe("loading", () => {
		it("shows a spinner rather than a word while it reads", () => {
			readFilePreview.mockReturnValue(new Promise(() => {}));
			mount();
			expect(spinner()).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("reads the file it was given", async () => {
			mount({ path: "/repo/doc.pdf", kind: "pdf" });
			await settle();
			expect(readFilePreview).toHaveBeenCalledWith("/repo/doc.pdf");
		});

		it("says so when the file cannot be read at all", async () => {
			readFilePreview.mockRejectedValue(new Error("gone"));
			mount();
			await settle();
			expect(message()).toBeTruthy();
			expect(image()).toBeNull();
		});

		it("reads the file again when the path changes", async () => {
			const { rerender } = mount();
			await settle();
			await rerender({
				path: "/repo/other.png",
				kind: "image",
				source: null,
				reloadToken: 0,
			});
			await settle();
			expect(readFilePreview).toHaveBeenLastCalledWith("/repo/other.png");
		});

		/**
		 * A reload leaves the tab open on the same path, so the path alone cannot
		 * trigger the re-read; the token is what does.
		 */
		it("reads the file again when the reload token is bumped", async () => {
			const { rerender } = mount();
			await settle();
			expect(readFilePreview).toHaveBeenCalledTimes(1);
			await rerender({
				path: "/repo/logo.png",
				kind: "image",
				source: null,
				reloadToken: 1,
			});
			await settle();
			expect(readFilePreview).toHaveBeenCalledTimes(2);
		});

		/** A slow read for a path the user has moved past must not land. */
		it("drops a read that arrives after the path moved on", async () => {
			const pending: ((v: unknown) => void)[] = [];
			readFilePreview.mockImplementation(
				() =>
					new Promise((resolve) => {
						pending.push(resolve);
					}),
			);
			const { rerender } = mount({ path: "/repo/a.bin", kind: "binary" });
			await settle();
			await rerender({
				path: "/repo/b.bin",
				kind: "binary",
				source: null,
				reloadToken: 0,
			});
			await settle();

			pending[1]?.({ size: 2, headHex: "4242" });
			await settle();
			pending[0]?.({ size: 1, headHex: "4141" });
			await settle();
			expect(hex()).toContain("42");
			expect(hex()).not.toContain("41 41");
		});
	});

	describe("images", () => {
		/**
		 * Images always load through a data URL: the asset protocol is cached by
		 * path in the webview, so a file replaced on disk keeps showing the old
		 * bytes.
		 */
		it("shows an image through a data URL, not the asset protocol", async () => {
			mount();
			await settle();
			expect(image().src.startsWith("data:")).toBe(true);
			expect(image().src).not.toContain("asset://");
		});

		it("names the image for a screen reader", async () => {
			mount({ path: "/repo/deep/logo.png" });
			await settle();
			expect(image().getAttribute("alt")).toBe("logo.png");
		});

		/** A file too large to inline falls back to the asset protocol. */
		it("falls back to the asset protocol for a very large image", async () => {
			readFilePreview.mockResolvedValue({
				size: 40 * 1024 * 1024,
				headHex: "",
			});
			mount();
			await settle();
			expect(readFileBase64).not.toHaveBeenCalled();
			expect(image().src).toContain("asset://");
		});

		/** Retries once through a data URL before giving up on the image. */
		it("retries through a data URL before declaring the image broken", async () => {
			readFilePreview.mockResolvedValue({
				size: 40 * 1024 * 1024,
				headHex: "",
			});
			mount();
			await settle();
			readFileBase64.mockClear();
			await image().dispatchEvent(new Event("error"));
			await settle();
			expect(readFileBase64).toHaveBeenCalled();
			expect(document.querySelector(".preview-note")).toBeNull();
		});

		it("declares the image broken once the retry fails too", async () => {
			readFilePreview.mockResolvedValue({
				size: 40 * 1024 * 1024,
				headHex: "",
			});
			readFileBase64.mockRejectedValue(new Error("nope"));
			mount();
			await settle();
			image().dispatchEvent(new Event("error"));
			await settle();
			expect(document.querySelector(".preview-note")?.textContent).toBeTruthy();
		});
	});

	describe("svg", () => {
		/** An SVG is already loaded as text, so nothing is read from disk. */
		it("renders the source it was given without reading the file", async () => {
			mount({
				path: "/repo/icon.svg",
				kind: "svg",
				source: "<svg></svg>",
			});
			await settle();
			expect(readFilePreview).not.toHaveBeenCalled();
			expect(image().src.startsWith("data:")).toBe(true);
		});
	});

	describe("pdf", () => {
		it("shows a small pdf inline", async () => {
			mount({ path: "/repo/doc.pdf", kind: "pdf" });
			await settle();
			expect(pdf()).not.toBeNull();
			expect(pdf().getAttribute("src")?.startsWith("data:")).toBe(true);
		});

		/** Too large to inline: it offers to open it elsewhere instead. */
		it("offers to open a very large pdf with the system app", async () => {
			readFilePreview.mockResolvedValue({
				size: 40 * 1024 * 1024,
				headHex: "",
			});
			mount({ path: "/repo/doc.pdf", kind: "pdf" });
			await settle();
			expect(pdf()).toBeNull();
			expect(document.querySelector(".preview-open")).not.toBeNull();
		});
	});

	describe("anything else", () => {
		it("shows the first bytes of a binary file", async () => {
			mount({ path: "/repo/a.bin", kind: "binary" });
			await settle();
			expect(hex()).toContain("48");
			expect(hex()?.toLowerCase()).toContain("hello");
		});

		it("names the file it cannot show", async () => {
			mount({ path: "/repo/deep/a.bin", kind: "binary" });
			await settle();
			expect(document.querySelector(".preview-name")?.textContent).toBe(
				"a.bin",
			);
		});

		it("opens the file with the system application on request", async () => {
			mount({ path: "/repo/a.bin", kind: "binary" });
			await settle();
			await userEvent.click(
				document.querySelector(".preview-open") as HTMLElement,
			);
			expect(openPath).toHaveBeenCalledWith("/repo/a.bin");
		});

		/**
		 * Read on a kind that reaches the same fallback panel as a binary file: a
		 * small pdf renders inline instead, so it would hide the hex behind the
		 * branch rather than behind the kind check this is about.
		 */
		it("shows no hex dump for a file that is not binary", async () => {
			readFilePreview.mockResolvedValue({
				size: 40 * 1024 * 1024,
				headHex: "48656c6c6f",
			});
			mount({ path: "/repo/doc.pdf", kind: "pdf" });
			await settle();
			expect(document.querySelector(".preview-open")).not.toBeNull();
			expect(hex()).toBeUndefined();
		});
	});
});
