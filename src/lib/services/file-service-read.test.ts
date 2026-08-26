// readFile keeps its own ETag cache, so each test works on a fresh path: the
// cache is module state that outlives a single test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "./file-service";

let nextPath = 0;
/** A path no earlier test cached. */
const freshPath = () => `/repo/file-${nextPath++}.ts`;

interface Answer {
	status?: number;
	body?: string;
	bytes?: Uint8Array;
	etag?: string | null;
}

/** Stages what the next fetch answers, and records the requests made. */
function stageFetch(...answers: Answer[]) {
	const requests: RequestInit[] = [];
	const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
		requests.push(init ?? {});
		const answer = answers.shift() ?? {};
		const status = answer.status ?? 200;
		const payload =
			answer.bytes ?? new TextEncoder().encode(answer.body ?? "content");
		return {
			status,
			ok: status >= 200 && status < 300,
			headers: {
				get: (name: string) => {
					if (name.toLowerCase() !== "etag") return null;
					return answer.etag === undefined ? "etag-1" : answer.etag;
				},
			},
			arrayBuffer: async () =>
				payload.buffer.slice(
					payload.byteOffset,
					payload.byteOffset + payload.byteLength,
				),
			text: async () => answer.body ?? "error text",
		};
	});
	vi.stubGlobal("fetch", fetchMock);
	return { requests, fetchMock };
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("readFile", () => {
	it("reads the file's text", async () => {
		stageFetch({ body: "hello" });
		await expect(readFile(freshPath())).resolves.toBe("hello");
	});

	it("sends no validator the first time a path is read", async () => {
		const { requests } = stageFetch({ body: "a" });
		await readFile(freshPath());
		expect(requests[0].headers).toEqual({});
	});

	it("sends the stored ETag on the next read of the same path", async () => {
		const path = freshPath();
		const { requests } = stageFetch({ body: "a", etag: "v1" }, { status: 304 });
		await readFile(path);
		await readFile(path);
		expect(requests[1].headers).toEqual({ "If-None-Match": "v1" });
	});

	it("answers a 304 from the cache rather than from the response", async () => {
		const path = freshPath();
		stageFetch({ body: "cached text", etag: "v1" }, { status: 304 });
		await readFile(path);
		await expect(readFile(path)).resolves.toBe("cached text");
	});

	it("re-reads the body when the ETag changed", async () => {
		const path = freshPath();
		stageFetch({ body: "old", etag: "v1" }, { body: "new", etag: "v2" });
		await readFile(path);
		await expect(readFile(path)).resolves.toBe("new");
	});

	it("answers null for content that is not valid UTF-8", async () => {
		stageFetch({ bytes: new Uint8Array([0xff, 0xfe, 0xff]) });
		await expect(readFile(freshPath())).resolves.toBeNull();
	});

	it("caches the null of a binary file, so a 304 stays null", async () => {
		const path = freshPath();
		stageFetch(
			{ bytes: new Uint8Array([0xff, 0xfe]), etag: "v1" },
			{ status: 304 },
		);
		await expect(readFile(path)).resolves.toBeNull();
		await expect(readFile(path)).resolves.toBeNull();
	});

	it("throws the body of a failed response", async () => {
		stageFetch({ status: 404, body: "no such file" });
		await expect(readFile(freshPath())).rejects.toBe("no such file");
	});

	it("does not cache a failed read", async () => {
		const path = freshPath();
		const { requests } = stageFetch(
			{ status: 500, body: "boom" },
			{ body: "recovered" },
		);
		await expect(readFile(path)).rejects.toBe("boom");
		await expect(readFile(path)).resolves.toBe("recovered");
		expect(requests[1].headers).toEqual({});
	});

	it("does not cache a response that carries no ETag", async () => {
		const path = freshPath();
		const { requests } = stageFetch(
			{ body: "a", etag: null },
			{ body: "b", etag: null },
		);
		await readFile(path);
		await readFile(path);
		expect(requests[1].headers).toEqual({});
	});

	it("shares one read between concurrent callers of the same path", async () => {
		const path = freshPath();
		const { fetchMock } = stageFetch({ body: "shared" });
		const [a, b] = await Promise.all([readFile(path), readFile(path)]);
		expect([a, b]).toEqual(["shared", "shared"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reads an empty file as an empty string, not as null", async () => {
		stageFetch({ body: "" });
		await expect(readFile(freshPath())).resolves.toBe("");
	});

	it("decodes accents and characters outside the basic plane", async () => {
		stageFetch({ body: "café été 日本語" });
		await expect(readFile(freshPath())).resolves.toBe("café été 日本語");
	});

	it("keeps a CRLF file byte for byte", async () => {
		stageFetch({ body: "a\r\nb\r\n" });
		await expect(readFile(freshPath())).resolves.toBe("a\r\nb\r\n");
	});

	it("evicts the oldest entry once past the cache ceiling", async () => {
		// 65 distinct paths overflow the 64-entry cache by one, so the first
		// path read must have lost its ETag by the end.
		const paths = Array.from({ length: 65 }, () => freshPath());
		stageFetch(...paths.map((_, i) => ({ body: `body-${i}`, etag: `v${i}` })));
		for (const path of paths) await readFile(path);

		const { requests } = stageFetch({ body: "refetched" });
		await readFile(paths[0]);
		expect(requests[0].headers).toEqual({});
	});

	it("keeps a recently read entry when older ones are evicted", async () => {
		const paths = Array.from({ length: 65 }, () => freshPath());
		stageFetch(...paths.map((_, i) => ({ body: `body-${i}`, etag: `v${i}` })));
		for (const path of paths) await readFile(path);

		const { requests } = stageFetch({ status: 304 });
		await readFile(paths.at(-1) as string);
		expect(requests[0].headers).toEqual({ "If-None-Match": "v64" });
	});

	/**
	 * A 304 re-inserts the entry so it counts as recently used. Asserted on the
	 * re-insertion itself rather than on surviving an eviction sweep: the cache
	 * is module state shared with every other test in this file, so its exact
	 * occupancy here is not something a single test can pin down.
	 */
	it("keeps serving an entry that keeps being revalidated", async () => {
		const path = freshPath();
		const { requests } = stageFetch(
			{ body: "kept", etag: "keep" },
			{ status: 304 },
			{ status: 304 },
		);
		await readFile(path);
		await expect(readFile(path)).resolves.toBe("kept");
		await expect(readFile(path)).resolves.toBe("kept");
		expect(requests[1].headers).toEqual({ "If-None-Match": "keep" });
		expect(requests[2].headers).toEqual({ "If-None-Match": "keep" });
	});
});
