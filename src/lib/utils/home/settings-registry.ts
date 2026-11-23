// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from "#lib/i18n";
import { SHORTCUT_DEFS, SHORTCUT_GROUP_LABELS } from "#lib/stores/shortcuts";
import {
	SETTINGS_SCHEMA,
	type SettingGroupDef,
	type SettingsTab,
} from "#lib/utils/home/settings-schema";

export type { SettingsTab };

/** One searchable setting and where it lives. */
export interface SettingEntry {
	label: string;
	desc: string;
	/** Matched by the search, never shown. */
	keywords: string[];
	tab: SettingsTab;
	group: string;
	/** Set when the setting lives on a home section rather than a settings tab. */
	homeSection?: string;
}

const s = t as (k: string) => string;

/** A group with rows gives one entry per row; a group without is one itself. */
function groupEntries(tab: SettingsTab, g: SettingGroupDef): SettingEntry[] {
	if (g.isAvailable === false) return [];
	const group = s(g.title);
	const rows = Object.values(g.rows);
	if (rows.length === 0) {
		return [
			{
				label: group,
				desc: g.desc ? s(g.desc) : "",
				keywords: (g.keywords ?? []).map(s),
				tab,
				group,
			},
		];
	}
	return rows.map((r) => ({
		label: s(r.label),
		desc: r.desc ? s(r.desc) : "",
		keywords: [...(g.keywords ?? []), ...(r.keywords ?? [])].map(s),
		tab,
		group,
	}));
}

const SCHEMA_SETTINGS: SettingEntry[] = (
	Object.entries(SETTINGS_SCHEMA) as [
		SettingsTab,
		Record<string, SettingGroupDef>,
	][]
).flatMap(([tab, groups]) =>
	Object.values(groups).flatMap((g) => groupEntries(tab, g)),
);

/** Settings that live on a home section rather than in a settings tab. */
const SECTION_SETTINGS: SettingEntry[] = [
	{
		label: s("integrations.addConnection"),
		desc: s("integrations.subtitle"),
		keywords: [],
		tab: "general",
		group: s("integrations.title"),
		homeSection: "integrations",
	},
	{
		label: s("integrations.bindings.title"),
		desc: s("integrations.bindings.desc"),
		keywords: [],
		tab: "general",
		group: s("integrations.title"),
		homeSection: "integrations",
	},
];

/** Every setting: the tabs' own, the home sections', and one per shortcut. */
export const SETTINGS_REGISTRY: SettingEntry[] = [
	...SCHEMA_SETTINGS,
	...SECTION_SETTINGS,
	...SHORTCUT_DEFS.map((d) => ({
		label: d.label,
		desc: d.description,
		keywords: [],
		tab: "shortcuts" as SettingsTab,
		group:
			SHORTCUT_GROUP_LABELS[d.group] ?? s("settings.shortcuts.groupFallback"),
	})),
];

/**
 * Substring match over label, description, group and tab, so the name of a
 * group or a tab finds every row under it; an empty query matches nothing.
 */
export function searchSettings(query: string): SettingEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return SETTINGS_REGISTRY.filter((e) =>
		[
			e.label,
			e.desc,
			e.group,
			e.homeSection ? "" : s(`settings.tabs.${e.tab}`),
			...e.keywords,
		].some((text) => text.toLowerCase().includes(q)),
	);
}
