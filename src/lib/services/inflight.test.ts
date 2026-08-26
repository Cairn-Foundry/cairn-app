import { describe, expect, it, vi } from "vitest";
import { dedupeInflight } from "./inflight";

/** A promise whose settlement this test controls. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("dedupeInflight", () => {
	it("runs the work and answers with its value", async () => {
		await expect(dedupeInflight("a", async () => 42)).resolves.toBe(42);
	});

	it("shares one call between callers asking for the same key", async () => {
		const run = vi.fn(() => deferred<number>().promise);
		const first = dedupeInflight("shared", run);
		const second = dedupeInflight("shared", run);
		expect(run).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("gives every waiter the same value", async () => {
		const d = deferred<string>();
		const run = vi.fn(() => d.promise);
		const results = Promise.all([
			dedupeInflight("k", run),
			dedupeInflight("k", run),
			dedupeInflight("k", run),
		]);
		d.resolve("once");
		expect(await results).toEqual(["once", "once", "once"]);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("keeps distinct keys independent", async () => {
		const run = vi.fn(async (n: number) => n);
		const [a, b] = await Promise.all([
			dedupeInflight("a", () => run(1)),
			dedupeInflight("b", () => run(2)),
		]);
		expect([a, b]).toEqual([1, 2]);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("releases the key once settled, so a later call runs afresh", async () => {
		const run = vi.fn(async () => "value");
		await dedupeInflight("k", run);
		await dedupeInflight("k", run);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("shares a rejection with every waiter", async () => {
		const d = deferred<number>();
		const run = vi.fn(() => d.promise);
		const first = dedupeInflight("k", run);
		const second = dedupeInflight("k", run);
		const cause = new Error("failed");
		d.reject(cause);
		await expect(first).rejects.toBe(cause);
		await expect(second).rejects.toBe(cause);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("releases the key after a rejection, so a retry is not poisoned", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("first"))
			.mockResolvedValueOnce("recovered");
		await expect(dedupeInflight("k", run)).rejects.toThrow("first");
		await expect(dedupeInflight("k", run)).resolves.toBe("recovered");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("does not dedupe a call issued after the first one settled", async () => {
		const run = vi.fn(async () => "a");
		const first = dedupeInflight("k", run);
		await first;
		const second = dedupeInflight("k", run);
		expect(second).not.toBe(first);
		await second;
	});

	it("carries a falsy value through rather than treating it as absent", async () => {
		await expect(dedupeInflight("zero", async () => 0)).resolves.toBe(0);
		await expect(dedupeInflight("empty", async () => "")).resolves.toBe("");
		await expect(dedupeInflight("null", async () => null)).resolves.toBeNull();
	});

	it("propagates a synchronous throw from the work", async () => {
		expect(() =>
			dedupeInflight("k", () => {
				throw new Error("sync");
			}),
		).toThrow("sync");
		// The key must not stay claimed by a call that never became a promise.
		await expect(dedupeInflight("k", async () => "after")).resolves.toBe(
			"after",
		);
	});
});
