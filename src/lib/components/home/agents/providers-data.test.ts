import { describe, expect, it } from "vitest";
import { defaultConfig, PROVIDERS, providerById } from "./providers-data";

describe("providers-data", () => {
	it("has unique provider ids", () => {
		const ids = PROVIDERS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("gives CLI providers a binary name", () => {
		for (const p of PROVIDERS.filter((p) => p.kind === "cli")) {
			expect(p.binaryName, p.id).toBeTruthy();
		}
	});

	it("defaults CLI providers to the CLI's own model choice", () => {
		const claude = providerById("claude-code-cli");
		expect(claude).toBeDefined();
		if (!claude) return;
		expect(defaultConfig(claude).model).toBe("");
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
