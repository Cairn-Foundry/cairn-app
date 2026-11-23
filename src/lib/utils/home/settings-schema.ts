// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TranslationKey } from "#lib/i18n";
import { IS_MAC } from "#lib/utils/platform";

// What every settings tab shows, as data: the tabs draw their groups and rows
// from it, and the settings search is built from it, so a row on screen is a
// row the search can find.

/** The settings screens a search hit can send the user to. */
export type SettingsTab =
	| "general"
	| "appearance"
	| "editor"
	| "shortcuts"
	| "project"
	| "languages"
	| "languageServers"
	| "providers"
	| "git";

/** One setting: its name, and the line under it when there is one. */
export interface SettingRowDef {
	label: TranslationKey;
	desc?: TranslationKey;
	/** Words the search matches without the row showing them. */
	keywords?: TranslationKey[];
}

/**
 * A titled block of a tab. With rows, each row is a search entry; without, the
 * group holds a control of its own (a list, a grid of cards) and is itself the
 * entry.
 */
export interface SettingGroupDef {
	title: TranslationKey;
	desc?: TranslationKey;
	keywords?: TranslationKey[];
	rows: Record<string, SettingRowDef>;
	/** False on a platform where the group is not drawn at all. */
	isAvailable?: boolean;
}

export const SETTINGS_SCHEMA = {
	general: {
		ai: {
			title: "settings.general.ai.groupTitle",
			rows: {
				enable: {
					label: "settings.general.ai.enable",
					desc: "settings.general.ai.enableDesc",
				},
				notifications: {
					label: "settings.general.ai.notifications",
					desc: "settings.general.ai.notificationsDesc",
				},
				toasts: {
					label: "settings.general.ai.toasts",
					desc: "settings.general.ai.toastsDesc",
				},
			},
		},
		cli: {
			title: "settings.general.cli.groupTitle",
			rows: {
				command: {
					label: "settings.general.cli.label",
					desc: "settings.general.cli.installDesc",
				},
			},
		},
		welcome: {
			title: "settings.general.welcome.groupTitle",
			rows: {
				replay: {
					label: "settings.general.welcome.replay",
					desc: "settings.general.welcome.replayDesc",
				},
			},
		},
		updates: {
			title: "settings.general.updates.groupTitle",
			rows: {
				version: {
					label: "settings.general.updates.currentVersion",
					keywords: ["settings.general.updates.check"],
				},
				autoCheck: {
					label: "settings.general.updates.autoCheck",
					desc: "settings.general.updates.autoCheckDesc",
				},
			},
		},
	},
	appearance: {
		theme: {
			title: "settings.appearance.themeGroup",
			keywords: ["settings.appearance.themeDesc"],
			rows: {},
		},
		accent: {
			title: "settings.appearance.accentGroup",
			keywords: ["settings.appearance.accentDesc"],
			rows: {},
		},
		font: {
			title: "settings.appearance.fontGroup",
			keywords: ["settings.appearance.fontDesc"],
			rows: {},
		},
		scale: {
			title: "settings.appearance.scaleGroup",
			rows: {
				uiScale: {
					label: "settings.appearance.uiScale",
					desc: "settings.appearance.uiScaleDesc",
				},
				iconAnimations: {
					label: "settings.appearance.iconAnimations",
					desc: "settings.appearance.iconAnimationsDesc",
				},
				transparency: {
					label: "settings.appearance.transparencyEffects",
					desc: "settings.appearance.transparencyEffectsDesc",
				},
			},
		},
		window: {
			title: "settings.appearance.windowGroup",
			isAvailable: !IS_MAC,
			rows: {
				titleBar: {
					label: "settings.appearance.titleBar",
					desc: "settings.appearance.titleBarDesc",
				},
				titleBarColor: {
					label: "settings.appearance.titleBarColor",
					desc: "settings.appearance.titleBarColorDesc",
				},
			},
		},
	},
	editor: {
		layout: {
			title: "settings.editor.layoutGroup",
			rows: {
				explorerPosition: {
					label: "settings.editor.fileExplorerPosition",
					desc: "settings.editor.fileExplorerPositionDesc",
				},
				treeWidth: {
					label: "settings.editor.treePanelWidth",
					desc: "settings.editor.treePanelWidthDesc",
				},
			},
		},
		codeEditor: {
			title: "settings.editor.codeEditorGroup",
			rows: {
				fontSize: {
					label: "settings.editor.fontSize",
					desc: "settings.editor.fontSizeDesc",
				},
				minimap: {
					label: "settings.editor.showMinimap",
					desc: "settings.editor.showMinimapDesc",
				},
				stickyScroll: {
					label: "settings.editor.stickyScroll",
					desc: "settings.editor.stickyScrollDesc",
				},
				lineWrap: {
					label: "settings.editor.lineWrap",
					desc: "settings.editor.lineWrapDesc",
				},
				saveOn: {
					label: "settings.editor.saveOn",
					desc: "settings.editor.saveOnDesc",
				},
			},
		},
		quickSearch: {
			title: "settings.editor.quickSearchGroup",
			rows: {
				gitignored: {
					label: "settings.editor.quickSearchGitignored",
					desc: "settings.editor.quickSearchGitignoredDesc",
				},
			},
		},
		syntax: {
			title: "settings.syntax.groupTitle",
			desc: "settings.syntax.desc",
			rows: {},
		},
	},
	project: {
		layout: {
			title: "settings.project.layoutGroup",
			rows: {
				sidebarPosition: {
					label: "settings.project.sidebarPosition",
					desc: "settings.project.sidebarPositionDesc",
				},
				pinnedCommands: {
					label: "settings.project.showPinnedCommandsSidebar",
					desc: "settings.project.showPinnedCommandsSidebarDesc",
				},
			},
		},
		workflowTabs: {
			title: "settings.project.workflowTabsGroup",
			desc: "settings.project.workflowTabsHint",
			rows: {},
		},
	},
	git: {
		profiles: {
			title: "settings.git.groupTitle",
			desc: "settings.git.groupDesc",
			rows: {},
		},
		diffs: {
			title: "settings.git.diffGroupTitle",
			rows: {
				maxDiffLines: {
					label: "settings.git.maxDiffLines",
					desc: "settings.git.maxDiffLinesDesc",
				},
			},
		},
		branches: {
			title: "settings.git.branchGroupTitle",
			desc: "settings.git.branchGroupDesc",
			keywords: ["settings.git.branchTemplate"],
			rows: {},
		},
	},
	languageServers: {
		behaviour: {
			title: "languageServers.behaviourGroup",
			rows: {
				suggestOnOpen: {
					label: "languageServers.suggestOnOpen",
					desc: "languageServers.suggestOnOpenDesc",
				},
			},
		},
		servers: {
			title: "languageServers.serversGroup",
			keywords: [
				"settings.tabDescs.languageServers",
				"languageServers.checkUpdates",
				"languageServers.customAdd",
			],
			rows: {},
		},
	},
	providers: {
		clis: {
			title: "home.providers.groupTitle",
			desc: "home.providers.absentHint",
			keywords: ["settings.tabDescs.providers"],
			rows: {},
		},
	},
	shortcuts: {},
	languages: {
		language: {
			title: "settings.languages.groupTitle",
			keywords: ["settings.languages.desc"],
			rows: {},
		},
	},
} satisfies Record<SettingsTab, Record<string, SettingGroupDef>>;
