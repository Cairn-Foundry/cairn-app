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

export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
