// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which build is running, and where it keeps its data.
 *
 * A beta or a development build owns its own directory rather than sharing
 * `~/.cairn` with the installed app, so anything naming that directory on screen
 * asks this store instead of spelling the path out. Read once on launch: nothing
 * about it changes while the app runs.
 */
import { readable } from "svelte/store";
import { type ChannelInfo, getChannel } from "$lib/services/settings-service";

/** What the release build is, and what a failed read falls back to. */
const RELEASE: ChannelInfo = {
	label: null,
	dir: "",
	displayDir: "~/.cairn",
};

export const channel = readable<ChannelInfo>(RELEASE, (set) => {
	// Anything short of a complete answer leaves the release default standing:
	// this store is read while rendering, so an undefined value here is a crash
	// rather than a wrong label.
	getChannel()
		.then((info) => {
			if (info?.displayDir) set(info);
		})
		.catch(() => {});
});
