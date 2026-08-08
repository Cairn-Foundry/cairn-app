import { get, writable } from "svelte/store";
import {
	defaultConfig,
	EFFORT_LEVELS,
	PERMISSION_MODES,
	PROVIDERS,
	providerById,
} from "$lib/components/home/agents/providers-data";
import {
	type AiProvidersConfig,
	type ApiKeyStatus,
	type CustomAgent,
	type DiscoveredModel,
	discoverProvider,
	getAiProvidersConfig,
	getCustomAgents,
	hasProviderApiKey,
	type ProbeResult,
	type ProviderCapabilities,
	type ProviderSettings,
	probeProvider,
	saveAiProvidersConfig,
	saveCustomAgents,
} from "$lib/services/ai-provider-service";

export type { CustomAgent, ProbeResult, ProviderSettings };

const PERSIST_DELAY_MS = 400;

function mergedDefaults(
	stored: Partial<Record<string, Partial<ProviderSettings>>>,
): Record<string, ProviderSettings> {
	const out: Record<string, ProviderSettings> = {};
	for (const def of PROVIDERS) {
		const merged = { ...defaultConfig(def), ...(stored[def.id] ?? {}) };
		// A pin written before custom models existed becomes the first entry.
		if (
			merged.customModel &&
			!merged.customModels.includes(merged.customModel)
		) {
			merged.customModels = [...merged.customModels, merged.customModel];
		}
		merged.customModel = undefined;
		out[def.id] = merged;
	}
	return out;
}

export const aiProviders = writable<AiProvidersConfig>({
	providers: mergedDefaults({}),
	defaultProviderId: "claude-code-cli",
});

export const apiKeyStatus = writable<Record<string, ApiKeyStatus>>({});
export const probeResults = writable<Record<string, ProbeResult>>({});
export const probing = writable<Record<string, boolean>>({});
export const customAgents = writable<CustomAgent[]>([]);

/**
 * What each provider answered when asked what it accepts. Cairn ships a short
 * fallback per provider, but a hardcoded catalogue goes stale on every release
 * and would strand anyone who has not updated Cairn, so what the provider
 * itself reports always wins.
 */
export const providerCapabilities = writable<
	Record<string, ProviderCapabilities>
>({});
export const loadingModels = writable<Record<string, boolean>>({});
export const modelsError = writable<Record<string, string>>({});

export async function refreshProviderModels(providerId: string): Promise<void> {
	const def = providerById(providerId);
	if (!def || def.status === "coming-soon") return;
	loadingModels.update((m) => ({ ...m, [providerId]: true }));
	try {
		const found = await discoverProvider(
			providerId,
			providerSettingsOf(providerId).baseUrl || null,
		);
		providerCapabilities.update((m) => ({ ...m, [providerId]: found }));
		modelsError.update((m) => ({ ...m, [providerId]: "" }));
	} catch (e) {
		modelsError.update((m) => ({ ...m, [providerId]: String(e) }));
	} finally {
		loadingModels.update((m) => ({ ...m, [providerId]: false }));
	}
}

/**
 * What the model pickers must show. An API answers with its whole catalogue, so
 * it replaces the fallback; a CLI only documents a few aliases in its help, so
 * both are merged rather than losing the ones it did not spell out.
 */
export function modelsOf(
	providerId: string,
	found: Record<string, ProviderCapabilities>,
): DiscoveredModel[] {
	const def = providerById(providerId);
	const shipped = (def?.models ?? []).map((m) => ({
		id: m.id,
		label: m.label,
	}));
	const discovered = found[providerId]?.models ?? [];
	if (discovered.length === 0) return shipped;
	if (def?.kind !== "cli") return discovered;
	return [
		...shipped,
		...discovered.filter((m) => !shipped.some((s) => s.id === m.id)),
	];
}

function optionsOf(
	discovered: string[] | undefined,
	shipped: readonly string[],
	selected: string,
): string[] {
	const values =
		discovered && discovered.length > 0 ? discovered : [...shipped];
	// A value already in use stays offered, even when the provider no longer lists it.
	return selected && !values.includes(selected)
		? [...values, selected]
		: values;
}

export function effortsOf(
	providerId: string,
	found: Record<string, ProviderCapabilities>,
	selected = "",
): string[] {
	return optionsOf(found[providerId]?.efforts, EFFORT_LEVELS, selected);
}

export function permissionModesOf(
	providerId: string,
	found: Record<string, ProviderCapabilities>,
	selected = "",
): string[] {
	return optionsOf(
		found[providerId]?.permissionModes,
		PERMISSION_MODES,
		selected,
	);
}

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let agentsTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadAiProviders(): Promise<void> {
	if (loaded) return;
	loaded = true;

	const [config, agents] = await Promise.all([
		getAiProvidersConfig().catch(() => null),
		getCustomAgents().catch(() => []),
	]);

	aiProviders.set({
		providers: mergedDefaults(config?.providers ?? {}),
		defaultProviderId: config?.defaultProviderId || "claude-code-cli",
	});
	customAgents.set(agents);

	for (const def of PROVIDERS) {
		if (def.status !== "coming-soon" && providerSettingsOf(def.id).enabled) {
			void refreshProviderModels(def.id);
		}
		if (def.hasApiKey) {
			void hasProviderApiKey(def.id)
				.then((status) => {
					apiKeyStatus.update((m) => ({ ...m, [def.id]: status }));
				})
				.catch(() => {});
		}
	}
}

function persist(): void {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		void saveAiProvidersConfig(get(aiProviders)).catch(() => {});
	}, PERSIST_DELAY_MS);
}

export function updateProviderSettings(
	providerId: string,
	fields: Partial<ProviderSettings>,
): void {
	aiProviders.update((config) => ({
		...config,
		providers: {
			...config.providers,
			[providerId]: { ...config.providers[providerId], ...fields },
		},
	}));
	persist();
}

export function setDefaultProvider(providerId: string): void {
	aiProviders.update((config) => ({
		...config,
		defaultProviderId: providerId,
	}));
	persist();
}

export function providerSettingsOf(providerId: string): ProviderSettings {
	const def = providerById(providerId);
	return (
		get(aiProviders).providers[providerId] ??
		(def ? defaultConfig(def) : defaultConfig(PROVIDERS[0]))
	);
}

export async function runProbe(providerId: string): Promise<void> {
	const def = providerById(providerId);
	if (!def || def.status === "coming-soon") return;
	probing.update((m) => ({ ...m, [providerId]: true }));
	try {
		const settings = providerSettingsOf(providerId);
		const result = await probeProvider(
			providerId,
			def.kind,
			def.binaryName ?? null,
			settings.baseUrl || null,
		);
		probeResults.update((m) => ({ ...m, [providerId]: result }));
	} catch {
		// probe failures leave the previous result in place
	} finally {
		probing.update((m) => ({ ...m, [providerId]: false }));
	}
}

export function persistCustomAgents(): void {
	if (agentsTimer) clearTimeout(agentsTimer);
	agentsTimer = setTimeout(() => {
		agentsTimer = null;
		void saveCustomAgents(get(customAgents)).catch(() => {});
	}, PERSIST_DELAY_MS);
}

export function setCustomAgents(agents: CustomAgent[]): void {
	customAgents.set(agents);
	persistCustomAgents();
}
