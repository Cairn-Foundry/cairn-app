import { en, enGreetings } from "./en";
import { fr, frGreetings } from "./fr";

const dictionaries = { en, fr } as const;

/** Content pools too varied for the flat t() lookup - home-screen splash-style greetings. */
export interface GreetingPools {
	morning: string[];
	afternoon: string[];
	evening: string[];
	night: string[];
	weekend: string[];
	splashes: string[];
}

export type Locale = keyof typeof dictionaries;

const greetingPools: Record<Locale, GreetingPools> = {
	en: enGreetings,
	fr: frGreetings,
};

const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "cairn:locale";

// --- Types ---
type Dictionary = typeof en;

type PathsToLeaf<T, Prefix extends string = ""> = T extends
	| string
	| ((...args: never[]) => string)
	? Prefix
	: {
			[K in keyof T]: PathsToLeaf<
				T[K],
				Prefix extends "" ? string & K : `${Prefix}.${string & K}`
			>;
		}[keyof T];

export type TranslationKey = PathsToLeaf<Dictionary>;

// --- Internals ---
const LOCALES = Object.keys(dictionaries) as Locale[];

function isLocale(value: string): value is Locale {
	return LOCALES.includes(value as Locale);
}

function loadLocale(): Locale {
	if (typeof localStorage !== "undefined") {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored && isLocale(stored)) return stored;
	}
	return DEFAULT_LOCALE;
}

type Leaf = string | ((...args: never[]) => string);

/** Flattened once: t() runs thousands of times per frame in templates. */
function flatten(
	obj: Record<string, unknown>,
	prefix = "",
): Record<string, Leaf> {
	const out: Record<string, Leaf> = {};
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object")
			Object.assign(out, flatten(value as Record<string, unknown>, path));
		else out[path] = value as Leaf;
	}
	return out;
}

const currentDict = flatten(
	dictionaries[loadLocale()] as unknown as Record<string, unknown>,
);

// --- Locale metadata ---
export const LOCALE_META: Record<
	Locale,
	{ nativeName: string; englishName: string }
> = {
	en: { nativeName: "English", englishName: "English" },
	fr: { nativeName: "Français", englishName: "French" },
};

// --- Public API ---
export function t(
	key: TranslationKey,
): string | ((...args: never[]) => string) {
	const value = currentDict[key];
	if (value === undefined) {
		console.error(`[i18n] Missing translation key: "${key}"`);
		return key as string;
	}
	return value;
}

export function getLocale(): Locale {
	return loadLocale();
}

export function getGreetingPools(): GreetingPools {
	return greetingPools[loadLocale()];
}

export function setLocale(locale: Locale): void {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(STORAGE_KEY, locale);
	}
	location.reload();
}
