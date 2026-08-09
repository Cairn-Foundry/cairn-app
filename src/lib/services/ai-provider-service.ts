import { invoke } from "@tauri-apps/api/core";

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

export interface AiProvidersConfig {
	providers: Record<string, ProviderSettings>;
	defaultProviderId: string;
}

export interface ApiKeyStatus {
	set: boolean;
}

export interface ProbeResult {
	available: boolean;
	version: string | null;
	detail: string | null;
	models: string[];
}

export interface AgentSlashCommand {
	name: string;
	description: string;
	scope: "project" | "global" | "plugin";
}

export async function getAiProvidersConfig(): Promise<AiProvidersConfig> {
	return await invoke("get_ai_providers_config");
}

export async function saveAiProvidersConfig(
	config: AiProvidersConfig,
): Promise<void> {
	await invoke("save_ai_providers_config", { config });
}

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

export async function deleteProviderApiKey(providerId: string): Promise<void> {
	await invoke("delete_provider_api_key", { providerId });
}

export async function probeProvider(
	providerId: string,
	kind: "cli" | "api",
	binary: string | null,
	baseUrl: string | null,
): Promise<ProbeResult> {
	return await invoke("probe_provider", { providerId, kind, binary, baseUrl });
}

export interface DiscoveredModel {
	id: string;
	label: string;
}

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

export async function listAgentCommands(
	workingDir: string,
): Promise<AgentSlashCommand[]> {
	return await invoke("list_agent_commands", { workingDir });
}
