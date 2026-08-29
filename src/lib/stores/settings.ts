/** Global app settings, the single copy shared by every view. */
import { derived, writable } from "svelte/store";
import {
	type CairnSettings,
	getSettings,
	updateSettings,
} from "$lib/services/settings-service";
import { RESPONSE_STAT_FIELDS } from "$lib/utils/agent/response-stats";
import { normalizeSyntaxTokens } from "$lib/utils/editor/syntax-tokens";
import { DEFAULT_ACCENT } from "$lib/utils/home/appearance";
import { DEFAULT_WF_TABS } from "$lib/utils/home/workflow-tabs";
import { setCustomServers } from "$lib/utils/languages/servers";
import { reportPersistError } from "$lib/utils/persist-error";

/** Factory settings; must stay in sync with the Rust defaults in commands/settings.rs. */
const DEFAULTS: CairnSettings = {
	treePanelWidth: 220,
	showMinimap: true,
	stickyScroll: true,
	lineWrap: false,
	editorFontSize: 13,
	uiScale: 1,
	fontFamily: "Menlo, ui-monospace, monospace",
	splitMode: false,
	splitLeftWidth: 0,
	shortcuts: [],
	theme: "default",
	accentColor: DEFAULT_ACCENT,
	workflowTabs: DEFAULT_WF_TABS,
	sidebarPosition: "left",
	workspaceSidebarPosition: "left",
	showPinnedCommandsSidebar: true,
	transparencyEffects: true,
	iconAnimations: true,
	showWhitespace: false,
	saveOn: "blur",
	gitProfiles: [],
	agentActivityWidth: 300,
	quickSearchShowGitignored: false,
	autoCheckUpdates: true,
	integrationsPollSeconds: 10,
	branchTemplate: "feat/{{key}}-{{slug}}",
	syntaxThemes: [],
	activeSyntaxThemeId: "",
	languageServers: [],
	suggestLanguageServers: true,
	dismissedLanguageServers: [],
	customLanguageServers: [],
	agentShowLiveActivity: true,
	agentActivityShowTime: true,
	agentActivityShowToolArgs: true,
	agentActivityAutoScroll: true,
	agentShowMessageTime: true,
	agentShowThinking: true,
	agentShowMessageCopy: true,
	agentShowResponseStats: true,
	agentResponseStats: RESPONSE_STAT_FIELDS.map((f) => f.id),
	agentShowContextWindow: true,
	agentShowConversationCost: true,
	agentShowRateLimit: true,
	agentShowModelChip: true,
	agentShowEffortChip: true,
	agentShowPermissionChip: true,
	aiFeatures: {},
};

const { subscribe, set, update } = writable<CairnSettings>(DEFAULTS);

function mergeWithDefaults(
	base: CairnSettings,
	override: Partial<CairnSettings>,
): CairnSettings {
	const result = { ...base };
	for (const key of Object.keys(DEFAULTS) as (keyof CairnSettings)[]) {
		const v = override[key];
		if (v !== undefined && v !== null) Object.assign(result, { [key]: v });
	}

	const savedTabs = override.workflowTabs ?? [];
	const savedKeys = new Set(savedTabs.map((t) => t.key));
	const missingDefaults = DEFAULT_WF_TABS.filter((t) => !savedKeys.has(t.key));
	if (missingDefaults.length > 0) {
		result.workflowTabs = [...savedTabs, ...missingDefaults];
	}
	return result;
}

/** Reads settings.json; a failure leaves the defaults in place rather than throwing. */
async function load() {
	try {
		set(mergeWithDefaults(DEFAULTS, await getSettings()));
	} catch {}
}

/**
 * Answers once the settings are on disk. Callers that only change the UI can
 * ignore it; anything the backend re-reads from `settings.json` afterwards -
 * the language server catalogue, for one - has to wait for the write.
 */
async function save(patch: Partial<CairnSettings>): Promise<void> {
	let written: Promise<void> = Promise.resolve();
	update((s) => {
		const next = { ...s, ...patch };
		written = updateSettings(next)
			.then((returned) => {
				update((current) => mergeWithDefaults(current, returned));
			})
			.catch((e) => reportPersistError("the settings", e));
		return next;
	});
	await written;
}

/** Global app settings, merged with DEFAULTS on load so an older saved config stays valid. */
export const settings = { subscribe, load, save };

/**
 * The lookups that decide which server covers a file are plain functions, so
 * the servers the user declared are pushed to them from here - a file can be
 * opened long before the Language servers page has ever been shown.
 */
subscribe(($s) =>
	setCustomServers(
		$s.customLanguageServers.map((server) => ({
			id: server.id,
			name: server.name,
			extensions: server.extensions,
			languageIds: server.languageIds,
		})),
	),
);

/** Token styles the editor must render with: the selected theme, or the built-in one. */
export const activeSyntaxTokens = derived({ subscribe }, ($s) =>
	normalizeSyntaxTokens(
		$s.syntaxThemes.find((t) => t.id === $s.activeSyntaxThemeId)?.tokens,
		$s.theme,
	),
);
