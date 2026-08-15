/** AI provider configuration, plus what each provider reports it supports. */
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
	type DiscoveredModel,
	discoverProvider,
	getAiProvidersConfig,
	getApiKeyStatuses,
	type ProbeResult,
	type ProviderCapabilities,
	type ProviderSettings,
	probeProvider,
	saveAiProvidersConfig,
} from "$lib/services/ai-provider-service";

export type { ProbeResult, ProviderSettings };

const PERSIST_DELAY_MS = 400;

/** Overlays stored settings on each provider's defaults, so a provider added by a new release appears configured. */
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

/** Provider configuration and the default provider; never holds an API key. */
export const aiProviders = writable<AiProvidersConfig>({
	providers: mergedDefaults({}),
	defaultProviderId: "claude-code-cli",
});

/** Whether a key is stored for each provider; the key itself never reaches the frontend. */
export const apiKeyStatus = writable<Record<string, ApiKeyStatus>>({});
/** Last reachability probe per provider; a failed probe leaves the previous result in place. */
export const probeResults = writable<Record<string, ProbeResult>>({});
/** Providers with a probe in flight. */
export const probing = writable<Record<string, boolean>>({});

/**
 * What each provider answered when asked what it accepts. Cairn ships a short
 * fallback per provider, but a hardcoded catalogue goes stale on every release
 * and would strand anyone who has not updated Cairn, so what the provider
 * itself reports always wins.
 */
export const providerCapabilities = writable<
	Record<string, ProviderCapabilities>
>({});
/** Providers whose capabilities are being discovered. */
export const loadingModels = writable<Record<string, boolean>>({});
/** Last discovery error per provider, empty once it succeeds. */
export const modelsError = writable<Record<string, string>>({});

/** Asks a provider what it supports; failures are reported in modelsError rather than thrown. */
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

/** Discovered values when there are any, shipped ones otherwise, plus whatever is already selected. */
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

/** Reasoning effort levels to offer for a provider. */
export function effortsOf(
	providerId: string,
	found: Record<string, ProviderCapabilities>,
	selected = "",
): string[] {
	return optionsOf(
		found[providerId]?.efforts,
		providerById(providerId)?.efforts ?? EFFORT_LEVELS,
		selected,
	);
}

/** Permission modes to offer for a provider. */
export function permissionModesOf(
	providerId: string,
	found: Record<string, ProviderCapabilities>,
	selected = "",
): string[] {
	return optionsOf(
		found[providerId]?.permissionModes,
		providerById(providerId)?.permissionModes ?? PERMISSION_MODES,
		selected,
	);
}

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Loads the configuration once, then discovers the enabled providers and their key status in the background. */
export async function loadAiProviders(): Promise<void> {
	if (loaded) return;
	loaded = true;

	const config = await getAiProvidersConfig().catch(() => null);

	aiProviders.set({
		providers: mergedDefaults(config?.providers ?? {}),
		defaultProviderId: config?.defaultProviderId || "claude-code-cli",
	});

	for (const def of PROVIDERS) {
		if (def.status !== "coming-soon" && providerSettingsOf(def.id).enabled) {
			void refreshProviderModels(def.id);
		}
	}

	void getApiKeyStatuses()
		.then((stored) => {
			apiKeyStatus.set(
				Object.fromEntries(
					PROVIDERS.filter((p) => p.hasApiKey).map((p) => [
						p.id,
						{ set: stored[p.id] === true },
					]),
				),
			);
		})
		.catch(() => {});
}

/** Debounced write of the whole configuration; a settings slider fires on every step.
 */
function persist(): void {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		void saveAiProvidersConfig(get(aiProviders)).catch(() => {});
	}, PERSIST_DELAY_MS);
}

/** Patches one provider's settings and schedules the write. */
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

/** Sets the provider a new conversation starts with. */
export function setDefaultProvider(providerId: string): void {
	aiProviders.update((config) => ({
		...config,
		defaultProviderId: providerId,
	}));
	persist();
}

/** Non-reactive settings of a provider, falling back to its defaults. */
export function providerSettingsOf(providerId: string): ProviderSettings {
	const def = providerById(providerId);
	return (
		get(aiProviders).providers[providerId] ??
		(def ? defaultConfig(def) : defaultConfig(PROVIDERS[0]))
	);
}

/** Checks that a provider is reachable: the CLI is installed, or the endpoint answers. */
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
