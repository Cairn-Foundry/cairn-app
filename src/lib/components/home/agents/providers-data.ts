export type ProviderStatus = "active" | "available" | "coming-soon";
export type ProviderKind = "cli" | "api";

export interface ModelOption {
	id: string;
	label: string;
	contextWindow?: number;
}

export interface ProviderDef {
	id: string;
	name: string;
	desc: string;
	note?: string;
	status: ProviderStatus;
	kind: ProviderKind;
	binaryName?: string;
	hasApiKey: boolean;
	hasBaseUrl: boolean;
	defaultBaseUrl?: string;
	supportsEffort?: boolean;
	supportsPermissionMode?: boolean;
	/**
	 * Whether the agent can be handed back its own session. The ones that cannot
	 * are resent the conversation with every prompt, so they still answer in
	 * context instead of meeting each message as if it were the first.
	 */
	keepsSession?: boolean;
	/**
	 * What this CLI calls its reasoning levels and its permission modes. Each
	 * agent has its own vocabulary; a provider that reports its own choices
	 * (Claude Code reads them out of its `--help`) overrides these.
	 */
	efforts?: readonly string[];
	permissionModes?: readonly string[];
	/**
	 * Fallback catalogue, used only until the provider answers `listProviderModels`.
	 * Never treat it as the list of models a provider serves: it goes stale on
	 * every release.
	 */
	models: ModelOption[];
	accentColor: string;
	logo: string;
}

interface ProviderConfig {
	enabled: boolean;
	baseUrl: string;
	model: string;
	/**
	 * Model names the user added by hand, offered alongside the catalogue the
	 * provider reports - the way to keep running an older release.
	 */
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

// Mirrors the Claude Code CLI's --effort choices.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

// Mirrors the Claude Code CLI's --permission-mode choices.
export const PERMISSION_MODES = [
	"auto",
	"acceptEdits",
	"plan",
	"manual",
	"dontAsk",
	"bypassPermissions",
] as const;

// Codex states permissions as the sandbox its tools run in (--sandbox).
export const CODEX_SANDBOXES = [
	"read-only",
	"workspace-write",
	"danger-full-access",
] as const;

export const CODEX_EFFORTS = ["minimal", "low", "medium", "high"] as const;

// The Copilot CLI cannot stop to ask when it is driven without a terminal, so
// the only real choice is whether its tools run at all.
export const COPILOT_PERMISSION_MODES = ["allow-all", "ask"] as const;

export const ANTIGRAVITY_EFFORTS = ["low", "medium", "high"] as const;

export const ANTIGRAVITY_PERMISSION_MODES = [
	"request-review",
	"always-proceed",
] as const;

// Vibe states permissions as the agent profile a run adopts (--agent).
export const VIBE_PERMISSION_MODES = [
	"default",
	"plan",
	"accept-edits",
	"auto-approve",
] as const;

/**
 * Ordered the way the list reads: the agentic CLIs first, the working one
 * leading, then the hosted APIs, then what runs on the machine. Alphabetical
 * inside each group - that is where a new provider goes.
 */
export const PROVIDERS: ProviderDef[] = [
	{
		id: "claude-code-cli",
		name: "Claude Code",
		desc: "Official Anthropic CLI - full agentic loop with tools.",
		note: "No API key required. Uses your local Claude Code session.",
		status: "active",
		kind: "cli",
		binaryName: "claude",
		hasApiKey: false,
		hasBaseUrl: false,
		supportsEffort: true,
		supportsPermissionMode: true,
		keepsSession: true,
		efforts: EFFORT_LEVELS,
		permissionModes: PERMISSION_MODES,
		models: [
			{ id: "fable", label: "Fable" },
			{ id: "opus", label: "Opus" },
			{ id: "sonnet", label: "Sonnet" },
			{ id: "haiku", label: "Haiku" },
		],
		accentColor: "#D97757",
		logo: "CC",
	},
	{
		id: "copilot-cli",
		name: "GitHub Copilot",
		desc: "GitHub Copilot agent via the official CLI.",
		note: "Answers in plain text: no tool activity, and no session to resume - each prompt is sent with the conversation so far.",
		status: "available",
		kind: "cli",
		binaryName: "copilot",
		hasApiKey: false,
		hasBaseUrl: false,
		supportsPermissionMode: true,
		keepsSession: false,
		permissionModes: COPILOT_PERMISSION_MODES,
		models: [],
		accentColor: "#7B93A8",
		logo: "GH",
	},
	{
		id: "antigravity-cli",
		name: "Google Antigravity",
		desc: "Google's agentic coding CLI, powered by Gemini.",
		status: "available",
		kind: "cli",
		binaryName: "agy",
		hasApiKey: false,
		hasBaseUrl: false,
		supportsEffort: true,
		supportsPermissionMode: true,
		keepsSession: true,
		efforts: ANTIGRAVITY_EFFORTS,
		permissionModes: ANTIGRAVITY_PERMISSION_MODES,
		models: [],
		accentColor: "#4285F4",
		logo: "AG",
	},
	{
		id: "mistral-vibe",
		name: "Mistral Vibe",
		desc: "Mistral's agentic coding CLI, powered by Codestral.",
		status: "available",
		kind: "cli",
		binaryName: "vibe",
		hasApiKey: false,
		hasBaseUrl: false,
		supportsPermissionMode: true,
		keepsSession: true,
		permissionModes: VIBE_PERMISSION_MODES,
		models: [],
		accentColor: "#FF7000",
		logo: "MV",
	},
	{
		id: "codex-cli",
		name: "OpenAI Codex",
		desc: "OpenAI Codex agent via the official CLI.",
		status: "available",
		kind: "cli",
		binaryName: "codex",
		hasApiKey: false,
		hasBaseUrl: false,
		supportsEffort: true,
		supportsPermissionMode: true,
		keepsSession: true,
		efforts: CODEX_EFFORTS,
		permissionModes: CODEX_SANDBOXES,
		models: [],
		accentColor: "#10A37F",
		logo: "CX",
	},
	{
		id: "anthropic",
		name: "Anthropic API",
		desc: "Direct access to Claude models via the Anthropic REST API. Chat only: no tools.",
		status: "available",
		kind: "api",
		hasApiKey: true,
		hasBaseUrl: true,
		defaultBaseUrl: "https://api.anthropic.com",
		models: [
			{
				id: "claude-opus-4-7",
				label: "Claude Opus 4.7",
				contextWindow: 200000,
			},
			{
				id: "claude-sonnet-4-6",
				label: "Claude Sonnet 4.6",
				contextWindow: 200000,
			},
			{
				id: "claude-haiku-4-5-20251001",
				label: "Claude Haiku 4.5",
				contextWindow: 200000,
			},
			{
				id: "claude-opus-4-5",
				label: "Claude Opus 4.5",
				contextWindow: 200000,
			},
		],
		accentColor: "#D97757",
		logo: "An",
	},
	{
		id: "gemini",
		name: "Google Gemini API",
		desc: "Gemini 3 and Gemini 2.5 models. Chat only: no tools.",
		status: "available",
		kind: "api",
		hasApiKey: true,
		hasBaseUrl: false,
		models: [
			{
				id: "gemini-3-pro-preview",
				label: "Gemini 3 Pro",
				contextWindow: 1048576,
			},
			{
				id: "gemini-2.5-pro",
				label: "Gemini 2.5 Pro",
				contextWindow: 1048576,
			},
			{
				id: "gemini-2.5-flash",
				label: "Gemini 2.5 Flash",
				contextWindow: 1048576,
			},
			{
				id: "gemini-2.5-flash-lite",
				label: "Gemini 2.5 Flash Lite",
				contextWindow: 1048576,
			},
		],
		accentColor: "#4285F4",
		logo: "Ge",
	},
	{
		id: "mistral",
		name: "Mistral API",
		desc: "Mistral Large, Codestral and other Mistral models. Chat only: no tools.",
		status: "available",
		kind: "api",
		hasApiKey: true,
		hasBaseUrl: true,
		defaultBaseUrl: "https://api.mistral.ai/v1",
		models: [
			{
				id: "mistral-large-latest",
				label: "Mistral Large",
				contextWindow: 128000,
			},
			{
				id: "mistral-medium-latest",
				label: "Mistral Medium",
				contextWindow: 128000,
			},
			{
				id: "mistral-small-latest",
				label: "Mistral Small",
				contextWindow: 32000,
			},
			{ id: "codestral-latest", label: "Codestral", contextWindow: 256000 },
			{
				id: "devstral-medium-latest",
				label: "Devstral",
				contextWindow: 128000,
			},
		],
		accentColor: "#FF7000",
		logo: "Mi",
	},
	{
		id: "openai",
		name: "OpenAI API",
		desc: "GPT-5 and o-series models. Chat only: no tools.",
		status: "available",
		kind: "api",
		hasApiKey: true,
		hasBaseUrl: true,
		defaultBaseUrl: "https://api.openai.com/v1",
		models: [
			{ id: "gpt-5.1", label: "GPT-5.1", contextWindow: 400000 },
			{ id: "gpt-5", label: "GPT-5", contextWindow: 400000 },
			{ id: "gpt-5-mini", label: "GPT-5 mini", contextWindow: 400000 },
			{ id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1000000 },
			{ id: "o3", label: "o3", contextWindow: 200000 },
			{ id: "o4-mini", label: "o4 mini", contextWindow: 200000 },
		],
		accentColor: "#10A37F",
		logo: "OA",
	},
	{
		id: "ollama",
		name: "Ollama",
		desc: "Run open-source models locally. Chat only: no tools.",
		note: "Make sure Ollama is running on your machine.",
		status: "available",
		kind: "api",
		hasApiKey: false,
		hasBaseUrl: true,
		defaultBaseUrl: "http://localhost:11434/v1",
		models: [
			{ id: "llama3.3", label: "Llama 3.3", contextWindow: 131072 },
			{ id: "qwen3", label: "Qwen 3", contextWindow: 131072 },
			{ id: "mistral", label: "Mistral 7B", contextWindow: 32768 },
			{ id: "deepseek-r1", label: "DeepSeek R1", contextWindow: 131072 },
		],
		accentColor: "#8B5CF6",
		logo: "Ol",
	},
];

export function providerById(id: string): ProviderDef | undefined {
	return PROVIDERS.find((p) => p.id === id);
}

const ACRONYMS: Record<string, string> = {
	gpt: "GPT",
	cli: "CLI",
	ai: "AI",
};

/**
 * Turns a raw model id into something readable, for the models a provider
 * reports without a display name of their own.
 */
export function prettyModelName(id: string): string {
	const cleaned = id
		.replace(/^models\//, "")
		.replace(/:latest$/, "")
		.replace(/-\d{8}$/, "")
		.replace(/-latest$/, "");
	const out: string[] = [];
	for (const part of cleaned.split(/[-_]/).filter(Boolean)) {
		const isNumber = /^\d+(\.\d+)*$/.test(part);
		const previous = out[out.length - 1];
		if (isNumber && previous && /^[\d.]+$/.test(previous)) {
			out[out.length - 1] = `${previous}.${part}`;
		} else if (isNumber) {
			out.push(part);
		} else {
			out.push(ACRONYMS[part] ?? part.charAt(0).toUpperCase() + part.slice(1));
		}
	}
	return out.join(" ") || id;
}

/**
 * The context window of a model, when Cairn knows it. Providers do not report
 * it, so this falls back to the shipped catalogue and matches by prefix: a
 * dated id (`claude-opus-4-5-20251101`) still resolves to its family entry.
 */
export function contextWindowOf(
	providerId: string,
	modelId: string,
): number | undefined {
	const models = providerById(providerId)?.models ?? [];
	const exact = models.find((m) => m.id === modelId);
	if (exact) return exact.contextWindow;
	return models.find(
		(m) =>
			m.contextWindow && (modelId.startsWith(m.id) || m.id.startsWith(modelId)),
	)?.contextWindow;
}

export function defaultConfig(p: ProviderDef): ProviderConfig {
	return {
		enabled: p.status === "active",
		baseUrl: p.defaultBaseUrl ?? "",
		model: p.kind === "cli" ? "" : (p.models[0]?.id ?? ""),
		customModels: [],
		temperature: 1.0,
		maxTokens: 8192,
		timeout: 60,
		streaming: true,
		binaryPath: "",
		effort: "",
		permissionMode: "",
		extraArgs: [],
	};
}
