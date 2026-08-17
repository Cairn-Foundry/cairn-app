import { t } from "$lib/i18n";
import { SHORTCUT_DEFS, SHORTCUT_GROUP_LABELS } from "$lib/stores/shortcuts";

// A flat index of every setting, so the settings search can find a row without
// each tab component having to register itself.

/** The settings screens a search hit can send the user to. */
export type SettingsTab =
	| "general"
	| "appearance"
	| "editor"
	| "shortcuts"
	| "project"
	| "languages"
	| "languageServers"
	| "git"
	| "agent";

/** One searchable setting and where it lives. */
export interface SettingEntry {
	label: string;
	desc: string;
	tab: SettingsTab;
	group: string;
}

const s = t as (k: string) => string;

const STATIC_SETTINGS: SettingEntry[] = [
	{
		label: s("settings.general.updates.autoCheck"),
		desc: s("settings.general.updates.autoCheckDesc"),
		tab: "general",
		group: s("settings.general.updates.groupTitle"),
	},
	{
		label: s("settings.general.updates.check"),
		desc: s("settings.general.updates.checkDesc"),
		tab: "general",
		group: s("settings.general.updates.groupTitle"),
	},
	{
		label: s("settings.appearance.themeGroup"),
		desc: s("settings.appearance.themeDesc"),
		tab: "appearance",
		group: s("settings.appearance.themeGroup"),
	},
	{
		label: s("settings.appearance.accentGroup"),
		desc: s("settings.appearance.accentDesc"),
		tab: "appearance",
		group: s("settings.appearance.accentGroup"),
	},
	{
		label: s("settings.appearance.fontGroup"),
		desc: s("settings.appearance.fontDesc"),
		tab: "appearance",
		group: s("settings.appearance.fontGroup"),
	},
	{
		label: s("settings.syntax.groupTitle"),
		desc: s("settings.syntax.desc"),
		tab: "editor",
		group: s("settings.syntax.groupTitle"),
	},
	{
		label: s("settings.editor.fileExplorerPosition"),
		desc: s("settings.editor.fileExplorerPositionDesc"),
		tab: "editor",
		group: s("settings.editor.layoutGroup"),
	},
	{
		label: s("settings.project.sidebarPosition"),
		desc: s("settings.project.sidebarPositionDesc"),
		tab: "project",
		group: s("settings.project.layoutGroup"),
	},
	{
		label: s("settings.project.showPinnedCommandsSidebar"),
		desc: s("settings.project.showPinnedCommandsSidebarDesc"),
		tab: "project",
		group: s("settings.project.layoutGroup"),
	},
	{
		label: s("settings.editor.treePanelWidth"),
		desc: s("settings.editor.treePanelWidthDesc"),
		tab: "editor",
		group: s("settings.editor.layoutGroup"),
	},
	{
		label: s("settings.editor.fontSize"),
		desc: s("settings.editor.fontSizeDesc"),
		tab: "editor",
		group: s("settings.editor.codeEditorGroup"),
	},
	{
		label: s("settings.editor.showMinimap"),
		desc: s("settings.editor.showMinimapDesc"),
		tab: "editor",
		group: s("settings.editor.codeEditorGroup"),
	},
	{
		label: s("settings.editor.stickyScroll"),
		desc: s("settings.editor.stickyScrollDesc"),
		tab: "editor",
		group: s("settings.editor.codeEditorGroup"),
	},
	{
		label: s("settings.project.workflowTabsGroup"),
		desc: s("settings.project.workflowTabsHint"),
		tab: "project",
		group: s("settings.project.workflowTabsGroup"),
	},
	...(
		[
			["messagesGroup", "showMessageTime"],
			["messagesGroup", "showThinking"],
			["messagesGroup", "showMessageCopy"],
			["messagesGroup", "showResponseStats"],
			["composerGroup", "showModelChip"],
			["composerGroup", "showEffortChip"],
			["composerGroup", "showPermissionChip"],
			["composerGroup", "showContextWindow"],
			["composerGroup", "showConversationCost"],
			["composerGroup", "showRateLimit"],
			["activityGroup", "showLiveActivity"],
			["activityGroup", "activityShowTime"],
			["activityGroup", "activityShowToolArgs"],
			["activityGroup", "activityAutoScroll"],
		] as const
	).map(([group, key]) => ({
		label: s(`settings.agent.${key}`),
		desc: s(`settings.agent.${key}Desc`),
		tab: "agent" as SettingsTab,
		group: s(`settings.agent.${group}`),
	})),
	{
		label: s("settings.languages.groupTitle"),
		desc: s("settings.languages.desc"),
		tab: "languages",
		group: s("settings.languages.groupTitle"),
	},
	{
		label: s("languageServers.behaviourGroup"),
		desc: s("languageServers.suggestOnOpenDesc"),
		tab: "languageServers",
		group: s("languageServers.behaviourGroup"),
	},
	{
		label: s("languageServers.serversGroup"),
		desc: s("languageServers.searchPlaceholder"),
		tab: "languageServers",
		group: s("languageServers.serversGroup"),
	},
];

/** Every setting: the hand-written ones plus one entry per shortcut. */
export const SETTINGS_REGISTRY: SettingEntry[] = [
	...STATIC_SETTINGS,
	...SHORTCUT_DEFS.map((d) => ({
		label: d.label,
		desc: d.description,
		tab: "shortcuts" as SettingsTab,
		group:
			SHORTCUT_GROUP_LABELS[d.group] ?? s("settings.shortcuts.groupFallback"),
	})),
];

/** Substring match over label and description; an empty query matches nothing. */
export function searchSettings(query: string): SettingEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return SETTINGS_REGISTRY.filter(
		(e) =>
			e.label.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q),
	);
}
