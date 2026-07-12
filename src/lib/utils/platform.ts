export const IS_MAC =
	typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
