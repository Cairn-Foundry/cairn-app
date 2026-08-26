import { describe, expect, it } from "vitest";
import { defaultConfig, PROVIDERS, providerById } from "./providers-data";

describe("providers-data", () => {
	it("has unique provider ids", () => {
		const ids = PROVIDERS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("gives CLI providers a non-empty binary name", () => {
		const cli = PROVIDERS.filter((p) => p.kind === "cli");
		expect(cli.length).toBeGreaterThan(0);
		for (const p of cli) {
			expect(typeof p.binaryName, p.id).toBe("string");
			expect(p.binaryName?.trim(), p.id).toBe(p.binaryName);
			expect(p.binaryName?.length, p.id).toBeGreaterThan(0);
		}
	});

	it("gives API providers no binary name", () => {
		for (const p of PROVIDERS.filter((p) => p.kind === "api")) {
			expect(p.binaryName, p.id).toBeUndefined();
		}
	});

	it("defaults CLI providers to the CLI's own model choice", () => {
		const claude = providerById("claude-code-cli");
		expect(claude?.id).toBe("claude-code-cli");
		expect(claude?.kind).toBe("cli");
		if (!claude) throw new Error("claude-code-cli is missing");
		expect(defaultConfig(claude).model).toBe("");
	});

	it("returns nothing for an id no provider carries", () => {
		expect(providerById("does-not-exist")).toBeUndefined();
		expect(providerById("")).toBeUndefined();
	});

	it("gives every provider the fields the UI reads", () => {
		for (const p of PROVIDERS) {
			expect(p.id, p.id).toMatch(/^[a-z0-9-]+$/);
			expect(p.name.length, p.id).toBeGreaterThan(0);
			expect(p.desc.length, p.id).toBeGreaterThan(0);
			expect(["cli", "api"], p.id).toContain(p.kind);
			expect(["active", "available", "coming-soon"], p.id).toContain(p.status);
		}
	});

	it("defaults API providers to their first model", () => {
		for (const p of PROVIDERS.filter(
			(p) => p.kind === "api" && p.models.length > 0,
		)) {
			expect(defaultConfig(p).model).toBe(p.models[0].id);
		}
	});

	it("only enables the active provider by default", () => {
		for (const p of PROVIDERS) {
			expect(defaultConfig(p).enabled).toBe(p.status === "active");
		}
	});
});
