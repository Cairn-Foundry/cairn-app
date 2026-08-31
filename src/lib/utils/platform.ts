// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/// `navigator.platform` is deprecated; `userAgentData` replaces it but is absent
/// from WebKit, which is exactly the engine the app runs in. The user agent
/// string is the only reading available everywhere.
export const IS_MAC =
	typeof navigator !== "undefined" &&
	(/mac/i.test(
		(navigator as { userAgentData?: { platform?: string } }).userAgentData
			?.platform ?? "",
	) ||
		/mac/i.test(navigator.userAgent));

/** Read the same way as IS_MAC, and for the same reason. */
export const IS_WINDOWS =
	typeof navigator !== "undefined" &&
	(/win/i.test(
		(navigator as { userAgentData?: { platform?: string } }).userAgentData
			?.platform ?? "",
	) ||
		/windows/i.test(navigator.userAgent));

/** The modifier as shortcuts print it. */
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
