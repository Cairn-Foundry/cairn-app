import { describe, expect, it } from "vitest";
import { originOf, transportIcon } from "./mcp";

describe("originOf", () => {
	it("keeps the host, which is what identifies a remote server", () => {
		expect(originOf("https://mcp.example.com/v1/mcp?x=1")).toBe(
			"mcp.example.com",
		);
	});

	it("shows a malformed URL as typed rather than hiding it", () => {
		expect(originOf("not a url")).toBe("not a url");
	});

	it("marks an empty URL instead of returning nothing", () => {
		expect(originOf("   ")).toBe("-");
	});
});

describe("transportIcon", () => {
	it("separates a local process from a remote endpoint", () => {
		expect(transportIcon("stdio")).toBe("terminal");
		expect(transportIcon("http")).toBe("globe");
		expect(transportIcon("sse")).toBe("globe");
	});
});
