// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	INTEGRATION_ERROR_CODES,
	type IntegrationError,
} from "$lib/types/integrations";
import {
	isKnownIntegrationErrorCode,
	toIntegrationError,
} from "./integration-service";

describe("isKnownIntegrationErrorCode", () => {
	it("accepts every code the backend can send", () => {
		for (const code of INTEGRATION_ERROR_CODES) {
			expect(isKnownIntegrationErrorCode(code), code).toBe(true);
		}
	});

	it("rejects a code from an older or newer backend", () => {
		expect(isKnownIntegrationErrorCode("not_a_code")).toBe(false);
		expect(isKnownIntegrationErrorCode("")).toBe(false);
	});
});

describe("toIntegrationError", () => {
	it("passes a well-formed error through, filling in retryAfterMs", () => {
		const error = { code: INTEGRATION_ERROR_CODES[0], message: "nope" };
		expect(toIntegrationError(error)).toEqual({
			code: INTEGRATION_ERROR_CODES[0],
			message: "nope",
			retryAfterMs: null,
		});
	});

	it("keeps a rate limit delay so the caller can back off", () => {
		const error = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "slow down",
			retryAfterMs: 30_000,
		};
		expect(toIntegrationError(error).retryAfterMs).toBe(30_000);
	});

	it("keeps a zero delay rather than replacing it with null", () => {
		const error = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "now",
			retryAfterMs: 0,
		};
		expect(toIntegrationError(error).retryAfterMs).toBe(0);
	});

	/**
	 * Unlike the git side, this one does check the code against its vocabulary:
	 * an unrecognised code is flattened to "provider" instead of reaching the UI.
	 */
	it("flattens an unrecognised code to provider, keeping the message", () => {
		expect(
			toIntegrationError({ code: "from_the_future", message: "detail" }),
		).toEqual({ code: "provider", message: "detail", retryAfterMs: null });
	});

	it("wraps a plain string rejection", () => {
		expect(toIntegrationError("network down")).toEqual({
			code: "provider",
			message: "network down",
			retryAfterMs: null,
		});
	});

	it("wraps an Error, keeping its message readable", () => {
		expect(toIntegrationError(new Error("boom")).message).toBe("Error: boom");
	});

	it("wraps what a rejected promise may carry instead of an error", () => {
		expect(toIntegrationError(undefined).code).toBe("provider");
		expect(toIntegrationError(null).message).toBe("null");
		expect(toIntegrationError(404).message).toBe("404");
	});

	it("wraps a half-shaped error rather than trusting it", () => {
		expect(toIntegrationError({ code: "provider" }).message).toBe(
			"[object Object]",
		);
		expect(toIntegrationError({ message: "text" }).code).toBe("provider");
		expect(toIntegrationError({ code: 1, message: "text" }).code).toBe(
			"provider",
		);
	});

	it("always answers with a shape the UI can render", () => {
		for (const value of [undefined, null, 0, "", [], {}, new Error("x")]) {
			const result = toIntegrationError(value);
			expect(isKnownIntegrationErrorCode(result.code), String(value)).toBe(
				true,
			);
			expect(typeof result.message, String(value)).toBe("string");
			expect(result, String(value)).toHaveProperty("retryAfterMs");
		}
	});

	it("normalizes an already normalized error to itself", () => {
		const once = toIntegrationError("failed");
		expect(toIntegrationError(once)).toEqual(once);
	});

	it("treats a missing retryAfterMs as no delay", () => {
		const error: IntegrationError = {
			code: INTEGRATION_ERROR_CODES[0],
			message: "m",
			retryAfterMs: null,
		};
		expect(toIntegrationError(error).retryAfterMs).toBeNull();
	});
});
