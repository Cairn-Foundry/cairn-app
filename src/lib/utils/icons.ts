// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** One section of the icon picker. */
interface IconGroup {
	id: string;
	names: string[];
}

/**
 * Names an icon picker may offer. Purely navigational glyphs (chevrons, the app
 * logo, the overflow dots) are deliberately left out: they carry no meaning once
 * detached from the chrome they belong to.
 */
export const ICON_GROUPS: IconGroup[] = [
	{
		id: "run",
		names: [
			"play",
			"pause",
			"stop",
			"refresh",
			"undo",
			"zap",
			"flame",
			"rocket",
		],
	},
	{
		id: "build",
		names: [
			"package",
			"box",
			"container",
			"hammer",
			"layers",
			"beaker",
			"wand",
			"sparkles",
		],
	},
	{
		id: "infra",
		names: [
			"server",
			"database",
			"cloud",
			"globe",
			"terminal",
			"command",
			"gauge",
			"shield",
		],
	},
	{
		id: "code",
		names: [
			"file-code",
			"file",
			"folder",
			"folder-open",
			"git",
			"branch",
			"review",
			"tests",
			"ci",
			"bug",
			"agent",
		],
	},
	{
		id: "data",
		names: [
			"save",
			"download",
			"upload",
			"copy",
			"clipboard",
			"scissors",
			"trash",
			"edit",
			"list",
			"filter",
			"book",
			"search",
		],
	},
	{
		id: "signal",
		names: [
			"check",
			"alert",
			"info",
			"help",
			"eye",
			"bell",
			"clock",
			"flag",
			"bookmark",
			"pin",
			"ticket",
			"circle",
			"circle-dot",
			"lock",
			"key",
			"user",
			"at",
			"link",
			"external",
			"send",
			"attach",
			"settings",
		],
	},
];

/** Every offered name, flattened, for validating a stored icon. */
export const ICON_NAMES: string[] = ICON_GROUPS.flatMap((g) => g.names);

/** Fallback for a command whose name suggests nothing. */
export const DEFAULT_COMMAND_ICON = "play";
