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

/**
 * What an agent uses on one given provider. Everything else about the agent -
 * prompt, tools, params - is the same wherever it runs.
 */
export interface CustomAgent {
	id: string;
	name: string;
	description: string;
	color: string;
	icon: string;
	systemPrompt: string;
	/**
	 * The provider the agent runs on. Empty means it inherits the calling
	 * conversation's provider, model, effort and permission mode - and follows
	 * it when the conversation switches backend.
	 */
	providerId: string;
	/**
	 * Empty falls back to the provider's own default, never to the
	 * conversation's model: that one names a model of another backend.
	 */
	model: string;
	effort: string;
	permissionMode: string;
	/** Tool names the agent may use. Empty means "whatever the provider allows". */
	allowedTools: string[];
	/** Tool names the agent may never use. Applied on top of `allowedTools`. */
	disallowedTools: string[];
	overrideParams: boolean;
	temperature: number;
	maxTokens: number;
}

/** A Claude Code subagent definition found on disk, offered for import. */
export interface DiscoveredAgent {
	name: string;
	description: string;
	model: string;
	effort: string;
	permissionMode: string;
	/** Hex resolved from the definition's colour name; empty when unknown. */
	color: string;
	tools: string[];
	systemPrompt: string;
	scope: "project" | "global";
	path: string;
}

export interface AgentSlashCommand {
	name: string;
	description: string;
	scope: "project" | "global";
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

export async function getCustomAgents(): Promise<CustomAgent[]> {
	return await invoke("get_custom_agents");
}

export async function saveCustomAgents(agents: CustomAgent[]): Promise<void> {
	await invoke("save_custom_agents", { agents });
}

export async function listAgentCommands(
	workingDir: string,
): Promise<AgentSlashCommand[]> {
	return await invoke("list_agent_commands", { workingDir });
}

/** Claude Code subagents defined in the given projects and in the user's home. */
export async function listClaudeAgents(
	workingDirs: string[],
): Promise<DiscoveredAgent[]> {
	return await invoke("list_claude_agents", { workingDirs });
}

/** One agent flattened into what a Claude Code definition can carry. */
export interface ExportedAgent {
	name: string;
	description: string;
	model: string;
	effort: string;
	permissionMode: string;
	color: string;
	tools: string[];
	systemPrompt: string;
}

export interface ExportOutcome {
	name: string;
	path: string;
	/** Empty when the file was written; otherwise why it was not. */
	skipped: string;
}

/**
 * Writes the agents as `.claude/agents/*.md`, in `workingDir` when given and in
 * the user's home otherwise.
 */
export async function exportClaudeAgents(
	agents: ExportedAgent[],
	workingDir: string | null,
	overwrite: boolean,
): Promise<ExportOutcome[]> {
	return await invoke("export_claude_agents", {
		agents,
		workingDir,
		overwrite,
	});
}
