import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	PROVIDERS,
	providerById,
} from "$lib/components/home/agents/providers-data";
import type { ProviderCapabilities } from "$lib/services/ai-provider-service";

const getAiProvidersConfig = vi.hoisted(() => vi.fn());
const getApiKeyStatuses = vi.hoisted(() => vi.fn());
const discoverProvider = vi.hoisted(() => vi.fn());
const saveAiProvidersConfig = vi.hoisted(() => vi.fn());
const probeProvider = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/ai-provider-service", () => ({
	getAiProvidersConfig,
	getApiKeyStatuses,
	discoverProvider,
	saveAiProvidersConfig,
	probeProvider,
}));

import {
	aiProviders,
	apiKeyStatus,
	effortsOf,
	loadAiProviders,
	modelsError,
	modelsOf,
	permissionModesOf,
	providerCapabilities,
	providerSettingsOf,
	refreshProviderModels,
} from "./ai-providers";

const CLI = PROVIDERS.find(
	(p) => p.kind === "cli" && p.status !== "coming-soon",
);
const API = PROVIDERS.find((p) => p.kind === "api");

/** Capabilities as a provider would report them. */
function capabilities(
	overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
	return {
		models: [],
		efforts: [],
		permissionModes: [],
		...overrides,
	} as ProviderCapabilities;
}

beforeEach(() => {
	getAiProvidersConfig.mockReset();
	getApiKeyStatuses.mockReset();
	discoverProvider.mockReset();
	saveAiProvidersConfig.mockReset();
	getAiProvidersConfig.mockResolvedValue(null);
	getApiKeyStatuses.mockResolvedValue({});
	discoverProvider.mockResolvedValue(capabilities());
	saveAiProvidersConfig.mockResolvedValue(undefined);
	providerCapabilities.set({});
	modelsError.set({});
});

describe("modelsOf", () => {
	it("offers the shipped catalogue when nothing was discovered", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const shipped = (providerById(CLI.id)?.models ?? []).map((m) => m.id);
		expect(modelsOf(CLI.id, {}).map((m) => m.id)).toEqual(shipped);
	});

	it("replaces the fallback with what an API reports", () => {
		expect(API).toBeDefined();
		if (!API) return;
		const found = {
			[API.id]: capabilities({
				models: [{ id: "only-this", label: "Only this" }],
			}),
		};
		expect(modelsOf(API.id, found).map((m) => m.id)).toEqual(["only-this"]);
	});

	it("merges a CLI's few documented aliases with the shipped ones", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const shipped = (providerById(CLI.id)?.models ?? []).map((m) => m.id);
		const found = {
			[CLI.id]: capabilities({ models: [{ id: "extra", label: "Extra" }] }),
		};
		const ids = modelsOf(CLI.id, found).map((m) => m.id);
		expect(ids).toEqual([...shipped, "extra"]);
	});

	it("lists a model once when the CLI repeats a shipped one", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const shipped = providerById(CLI.id)?.models ?? [];
		if (shipped.length === 0) return;
		const found = {
			[CLI.id]: capabilities({
				models: [{ id: shipped[0].id, label: shipped[0].label }],
			}),
		};
		const ids = modelsOf(CLI.id, found).map((m) => m.id);
		expect(ids.filter((id) => id === shipped[0].id)).toHaveLength(1);
	});

	it("answers an empty list for a provider nobody knows", () => {
		expect(modelsOf("no-such-provider", {})).toEqual([]);
	});
});

describe("effortsOf", () => {
	it("offers the shipped levels when the provider reported none", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		expect(effortsOf(CLI.id, {}).length).toBeGreaterThan(0);
	});

	it("prefers what the provider reported", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ efforts: ["low", "high"] }) };
		expect(effortsOf(CLI.id, found)).toEqual(["low", "high"]);
	});

	it("keeps offering a level already in use the provider dropped", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ efforts: ["low"] }) };
		expect(effortsOf(CLI.id, found, "legacy")).toEqual(["low", "legacy"]);
	});

	it("adds no duplicate when the selected level is still offered", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ efforts: ["low", "high"] }) };
		expect(effortsOf(CLI.id, found, "low")).toEqual(["low", "high"]);
	});

	it("treats an empty reported list as nothing reported", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ efforts: [] }) };
		expect(effortsOf(CLI.id, found)).toEqual(effortsOf(CLI.id, {}));
	});
});

describe("permissionModesOf", () => {
	it("offers the shipped modes when the provider reported none", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		expect(permissionModesOf(CLI.id, {}).length).toBeGreaterThan(0);
	});

	it("prefers what the provider reported", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ permissionModes: ["plan"] }) };
		expect(permissionModesOf(CLI.id, found)).toEqual(["plan"]);
	});

	it("keeps a mode already in use that the provider dropped", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = { [CLI.id]: capabilities({ permissionModes: ["plan"] }) };
		expect(permissionModesOf(CLI.id, found, "old")).toEqual(["plan", "old"]);
	});
});

describe("refreshProviderModels", () => {
	it("stores what the provider reports", async () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		const found = capabilities({ models: [{ id: "m", label: "M" }] });
		discoverProvider.mockResolvedValue(found);
		await refreshProviderModels(CLI.id);
		expect(get(providerCapabilities)[CLI.id]).toEqual(found);
	});

	it("reports a discovery failure rather than throwing", async () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		discoverProvider.mockRejectedValue(new Error("unreachable"));
		await expect(refreshProviderModels(CLI.id)).resolves.toBeUndefined();
		expect(get(modelsError)[CLI.id]).toContain("unreachable");
	});

	it("clears a previous error once discovery succeeds", async () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		discoverProvider.mockRejectedValueOnce(new Error("down"));
		await refreshProviderModels(CLI.id);
		discoverProvider.mockResolvedValue(capabilities());
		await refreshProviderModels(CLI.id);
		expect(get(modelsError)[CLI.id]).toBe("");
	});

	it("asks nothing of a provider that is not shipped yet", async () => {
		const soon = PROVIDERS.find((p) => p.status === "coming-soon");
		if (!soon) return;
		await refreshProviderModels(soon.id);
		expect(discoverProvider).not.toHaveBeenCalled();
	});

	it("asks nothing of a provider nobody knows", async () => {
		await refreshProviderModels("no-such-provider");
		expect(discoverProvider).not.toHaveBeenCalled();
	});
});

describe("loadAiProviders", () => {
	it("gives every shipped provider a configuration", async () => {
		await loadAiProviders();
		for (const def of PROVIDERS) {
			expect(get(aiProviders).providers[def.id], def.id).toBeDefined();
		}
	});

	/**
	 * loadAiProviders guards itself with a module-level `loaded` flag, so the
	 * key statuses are fetched exactly once per process. The shape of what
	 * lands in the store is asserted rather than the timing of that one fetch.
	 */
	it("reports only whether a key is stored, never the key itself", async () => {
		await loadAiProviders();
		await vi.waitFor(() =>
			expect(Object.keys(get(apiKeyStatus)).length).toBeGreaterThan(0),
		);
		for (const [id, status] of Object.entries(get(apiKeyStatus))) {
			expect(Object.keys(status), id).toEqual(["set"]);
			expect(typeof status.set, id).toBe("boolean");
		}
	});

	it("tracks a key status only for the providers that take one", async () => {
		await loadAiProviders();
		await vi.waitFor(() =>
			expect(Object.keys(get(apiKeyStatus)).length).toBeGreaterThan(0),
		);
		for (const id of Object.keys(get(apiKeyStatus))) {
			expect(PROVIDERS.find((p) => p.id === id)?.hasApiKey, id).toBe(true);
		}
	});

	it("loads once, so a second call costs nothing", async () => {
		await loadAiProviders();
		const calls = getAiProvidersConfig.mock.calls.length;
		await loadAiProviders();
		expect(getAiProvidersConfig.mock.calls.length).toBe(calls);
	});
});

describe("providerSettingsOf", () => {
	it("answers with a configuration for a known provider", () => {
		expect(CLI).toBeDefined();
		if (!CLI) return;
		expect(providerSettingsOf(CLI.id)).toMatchObject({
			enabled: expect.any(Boolean),
		});
	});

	it("answers with defaults rather than undefined for an unknown one", () => {
		expect(providerSettingsOf("no-such-provider")).toBeDefined();
	});
});
