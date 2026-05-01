import { writable } from "svelte/store";
import {
	type CairnSettings,
	getSettings,
	updateSettings,
} from "$lib/services/settings-service";
import { DEFAULT_ACCENT } from "$lib/utils/home/appearance";
import { DEFAULT_WF_TABS } from "$lib/utils/home/workflow-tabs";

const DEFAULTS: CairnSettings = {
	treePanelWidth: 220,
	showMinimap: true,
	editorFontSize: 13,
	fontFamily: "'JetBrains Mono', ui-monospace, monospace",
	splitMode: false,
	splitLeftWidth: 0,
	shortcuts: [],
	theme: "dark",
	accentColor: DEFAULT_ACCENT,
	workflowTabs: DEFAULT_WF_TABS,
	sidebarPosition: "left",
	showWhitespace: false,
	saveOn: "blur",
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

async function load() {
	try {
		set(mergeWithDefaults(DEFAULTS, await getSettings()));
	} catch {}
}

async function save(patch: Partial<CairnSettings>) {
	update((s) => {
		const next = { ...s, ...patch };
		updateSettings(next)
			.then((returned) => {
				update((current) => mergeWithDefaults(current, returned));
			})
			.catch(() => {});
		return next;
	});
}

export const settings = { subscribe, load, save };
