export type ProviderStatus = "active" | "available" | "coming-soon";

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
	hasApiKey: boolean;
	hasBaseUrl: boolean;
	defaultBaseUrl?: string;
	hasCustomModel?: boolean;
	models: ModelOption[];
	accentColor: string;
	logo: string;
}

export interface ProviderConfig {
	enabled: boolean;
	apiKey: string;
	baseUrl: string;
	model: string;
	customModel: string;
	temperature: number;
	maxTokens: number;
	timeout: number;
	streaming: boolean;
}

export const PROVIDERS: ProviderDef[] = [
	{
		id: "claude-code-cli",
		name: "Claude Code CLI",
		desc: "Official Anthropic CLI — current Agent Bridge driver.",
		note: "No API key required. Uses your local Claude Code session.",
		status: "active",
		hasApiKey: false,
		hasBaseUrl: false,
		models: [],
		accentColor: "#D97757",
		logo: "CC",
	},
	{
		id: "anthropic",
		name: "Anthropic API",
		desc: "Direct access to Claude models via the Anthropic REST API.",
		status: "available",
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
		id: "openai",
		name: "OpenAI",
		desc: "GPT-4o, o1 and other OpenAI models.",
		status: "available",
		hasApiKey: true,
		hasBaseUrl: true,
		defaultBaseUrl: "https://api.openai.com/v1",
		models: [
			{ id: "gpt-4o", label: "GPT-4o", contextWindow: 128000 },
			{ id: "gpt-4o-mini", label: "GPT-4o mini", contextWindow: 128000 },
			{ id: "gpt-4-turbo", label: "GPT-4 Turbo", contextWindow: 128000 },
			{ id: "o1", label: "o1", contextWindow: 200000 },
			{ id: "o1-mini", label: "o1 mini", contextWindow: 128000 },
			{ id: "o3", label: "o3", contextWindow: 200000 },
			{ id: "o4-mini", label: "o4 mini", contextWindow: 200000 },
		],
		accentColor: "#10A37F",
		logo: "OA",
	},
	{
		id: "mistral",
		name: "Mistral",
		desc: "Mistral Large, Codestral and other Mistral models.",
		status: "available",
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
				id: "mistral-small-latest",
				label: "Mistral Small",
				contextWindow: 32000,
			},
			{ id: "codestral-latest", label: "Codestral", contextWindow: 32000 },
			{
				id: "open-mixtral-8x22b",
				label: "Mixtral 8×22B",
				contextWindow: 65000,
			},
			{ id: "mistral-nemo", label: "Mistral Nemo", contextWindow: 128000 },
		],
		accentColor: "#FF7000",
		logo: "Mi",
	},
	{
		id: "mistral-vibe",
		name: "Mistral Vibe",
		desc: "Mistral's agentic coding CLI, powered by Codestral.",
		note: "No API key required. Uses your Mistral account and local Mistral Vibe session.",
		status: "available",
		hasApiKey: false,
		hasBaseUrl: false,
		models: [],
		accentColor: "#FF7000",
		logo: "MV",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		desc: "Gemini 2.0 Flash, Gemini 1.5 Pro and other Google models.",
		status: "available",
		hasApiKey: true,
		hasBaseUrl: false,
		models: [
			{
				id: "gemini-2.0-flash",
				label: "Gemini 2.0 Flash",
				contextWindow: 1048576,
			},
			{
				id: "gemini-2.0-flash-lite",
				label: "Gemini 2.0 Flash Lite",
				contextWindow: 1048576,
			},
			{ id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", contextWindow: 2097152 },
			{
				id: "gemini-1.5-flash",
				label: "Gemini 1.5 Flash",
				contextWindow: 1048576,
			},
		],
		accentColor: "#4285F4",
		logo: "Ge",
	},
	{
		id: "copilot-cli",
		name: "GitHub Copilot CLI",
		desc: "GitHub Copilot agent via the official CLI.",
		note: "No API key required. Uses your GitHub Copilot subscription and local CLI session.",
		status: "available",
		hasApiKey: false,
		hasBaseUrl: false,
		models: [],
		accentColor: "#7B93A8",
		logo: "GH",
	},
	{
		id: "codex-cli",
		name: "Codex CLI",
		desc: "OpenAI Codex agent via the official CLI.",
		note: "No API key required. Uses your OpenAI account and local Codex CLI session.",
		status: "available",
		hasApiKey: false,
		hasBaseUrl: false,
		models: [],
		accentColor: "#10A37F",
		logo: "CX",
	},
	{
		id: "ollama",
		name: "Ollama",
		desc: "Run open-source models locally. No API key required.",
		note: "Make sure Ollama is running on your machine.",
		status: "available",
		hasApiKey: false,
		hasBaseUrl: true,
		defaultBaseUrl: "http://localhost:11434",
		hasCustomModel: true,
		models: [
			{ id: "llama3.3", label: "Llama 3.3", contextWindow: 131072 },
			{ id: "llama3.2", label: "Llama 3.2", contextWindow: 131072 },
			{ id: "qwen2.5", label: "Qwen 2.5", contextWindow: 131072 },
			{ id: "mistral", label: "Mistral 7B", contextWindow: 32768 },
			{ id: "codellama", label: "Code Llama", contextWindow: 16384 },
			{ id: "deepseek-r1", label: "DeepSeek R1", contextWindow: 131072 },
			{ id: "__custom__", label: "Custom…" },
		],
		accentColor: "#8B5CF6",
		logo: "Ol",
	},
];

export function defaultConfig(p: ProviderDef): ProviderConfig {
	return {
		enabled: p.status === "active",
		apiKey: "",
		baseUrl: p.defaultBaseUrl ?? "",
		model: p.models[0]?.id ?? "",
		customModel: "",
		temperature: 1.0,
		maxTokens: 8192,
		timeout: 60,
		streaming: true,
	};
}
