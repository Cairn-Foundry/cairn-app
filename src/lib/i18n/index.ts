import { en } from "./en";
import { fr } from "./fr";

const dictionaries = { en, fr } as const;

export type Locale = keyof typeof dictionaries;

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

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce((acc: unknown, key) => {
		if (acc === undefined || acc === null) return undefined;
		return (acc as Record<string, unknown>)[key];
	}, obj);
}

const currentDict = dictionaries[loadLocale()] as unknown as Record<
	string,
	unknown
>;

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
	const value = getNestedValue(currentDict, key);
	if (value === undefined) {
		console.error(`[i18n] Missing translation key: "${key}"`);
		return key as string;
	}
	return value as string | ((...args: never[]) => string);
}

export function getLocale(): Locale {
	return loadLocale();
}

export function setLocale(locale: Locale): void {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(STORAGE_KEY, locale);
	}
	location.reload();
}
