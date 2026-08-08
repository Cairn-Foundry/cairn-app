import {
	EFFORT_LEVELS,
	PERMISSION_MODES,
} from "$lib/components/home/agents/providers-data";
import { t } from "$lib/i18n";

/** `acceptEdits` -> `Accept edits`, for a value Cairn has no translation for. */
export function humanizeOption(value: string): string {
	const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Providers may accept values this build knows nothing about - that is the
 * point of asking them - so an unknown value gets a readable label instead of a
 * missing translation key.
 */
export function effortLabel(level: string): string {
	return (EFFORT_LEVELS as readonly string[]).includes(level)
		? (t(
				`home.agents.effortLevels.${level}` as Parameters<typeof t>[0],
			) as string)
		: humanizeOption(level);
}

export function permissionModeLabel(mode: string): string {
	return (PERMISSION_MODES as readonly string[]).includes(mode)
		? (t(
				`home.agents.permissionModes.${mode}` as Parameters<typeof t>[0],
			) as string)
		: humanizeOption(mode);
}
