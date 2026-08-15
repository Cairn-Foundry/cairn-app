// AI provider configuration and the API keys that go with it. Keys never come
// back to the frontend: only whether one is stored.

import { invoke } from "@tauri-apps/api/core";

/** One provider's configuration; the CLI and API fields are both present, unused ones stay empty. */
export interface ProviderSettings {
	enabled: boolean;
	baseUrl: string;
	model: string;
	customModels: string[];
	/** Superseded by `customModels`; still read so an existing pin survives. */
	customModel?: string;
	temperature: number;
	maxTokens: number;
	timeout: number;
	streaming: boolean;
	binaryPath: string;
	effort: string;
	permissionMode: string;
	extraArgs: string[];
}

/** Contents of ai-providers.json, keyed by provider id. Secrets are not part of it. */
export interface AiProvidersConfig {
	providers: Record<string, ProviderSettings>;
	defaultProviderId: string;
}

/** Whether a key is on disk; the key itself is never sent to the frontend. */
export interface ApiKeyStatus {
	set: boolean;
}

/** Outcome of reaching for a provider: whether it answered, and what it reported. */
export interface ProbeResult {
	available: boolean;
	version: string | null;
	detail: string | null;
	models: string[];
}

/** A slash command the agent exposes, and where it was declared. */
export interface AgentSlashCommand {
	name: string;
	description: string;
	scope: "project" | "global" | "plugin";
}

/** Provider configuration as stored; missing providers are filled in by the caller. */
export async function getAiProvidersConfig(): Promise<AiProvidersConfig> {
	return await invoke("get_ai_providers_config");
}

/** Rewrites ai-providers.json wholesale, so pass a complete config. */
export async function saveAiProvidersConfig(
	config: AiProvidersConfig,
): Promise<void> {
	await invoke("save_ai_providers_config", { config });
}

/**
 * Encrypts the key into ai-keys.enc. An empty key is stored as such and still
 * answers `set: true`; only the status call treats it as absent.
 */
export async function setProviderApiKey(
	providerId: string,
	key: string,
): Promise<ApiKeyStatus> {
	return await invoke("set_provider_api_key", { providerId, key });
}

/** Whether a key is stored, for every provider, in one call. */
export async function getApiKeyStatuses(): Promise<Record<string, boolean>> {
	return await invoke("get_api_key_statuses");
}

/** Drops the provider's entry from ai-keys.enc entirely. */
export async function deleteProviderApiKey(providerId: string): Promise<void> {
	await invoke("delete_provider_api_key", { providerId });
}

/** Reaches for the provider to see whether it is actually usable; may block on the network. */
export async function probeProvider(
	providerId: string,
	kind: "cli" | "api",
	binary: string | null,
	baseUrl: string | null,
): Promise<ProbeResult> {
	return await invoke("probe_provider", { providerId, kind, binary, baseUrl });
}

/** A model the provider reported, with the label to show for it. */
export interface DiscoveredModel {
	id: string;
	label: string;
}

/** What a provider says it supports; empty lists mean it reported nothing, not that it supports nothing. */
export interface ProviderCapabilities {
	models: DiscoveredModel[];
	efforts: string[];
	permissionModes: string[];
}

/**
 * Asks the provider itself what it accepts. A CLI reports it through its own
 * `--help`, an API through its models endpoint.
 */
export async function discoverProvider(
	providerId: string,
	baseUrl: string | null,
): Promise<ProviderCapabilities> {
	return await invoke("discover_provider", { providerId, baseUrl });
}

/** Slash commands visible from `workingDir`, merging project, global and plugin scopes. */
export async function listAgentCommands(
	workingDir: string,
): Promise<AgentSlashCommand[]> {
	return await invoke("list_agent_commands", { workingDir });
}
