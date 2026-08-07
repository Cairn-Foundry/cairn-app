import type {
	FormattingConfig,
	LanguageFormatting,
	StyleOptionInfo,
	StyleSet,
	StyleValue,
} from "$lib/services/formatting-service";

/** Where a resolved value came from, so the UI can show what it inherited. */
export type StyleOrigin = "default" | "common" | "language";

export interface ResolvedOption {
	id: string;
	value: StyleValue;
	origin: StyleOrigin;
}

export function languageEntry(
	config: FormattingConfig | null,
	languageId: string,
): LanguageFormatting | undefined {
	return config?.languages.find((l) => l.languageId === languageId);
}

/** The options that mean something for a language: the universal ones plus its own. */
export function optionsForLanguage(
	options: StyleOptionInfo[],
	languageId: string,
): StyleOptionInfo[] {
	return options.filter(
		(o) => o.languages.length === 0 || o.languages.includes(languageId),
	);
}

/**
 * The chain for one language, each value carrying the layer it came from.
 * Mirrors `resolve_style` in Rust: the two must agree, or the form shows one
 * thing and the formatter does another.
 */
export function resolveStyleDetailed(
	options: StyleOptionInfo[],
	config: FormattingConfig | null,
	languageId: string,
): Map<string, ResolvedOption> {
	const resolved = new Map<string, ResolvedOption>();
	for (const option of optionsForLanguage(options, languageId)) {
		resolved.set(option.id, {
			id: option.id,
			value: option.default,
			origin: "default",
		});
	}

	const layer = (set: StyleSet | undefined, origin: StyleOrigin) => {
		for (const [id, value] of Object.entries(set ?? {})) {
			if (!resolved.has(id)) continue;
			resolved.set(id, { id, value, origin });
		}
	};

	layer(config?.base, "common");
	layer(languageEntry(config, languageId)?.style, "language");
	return resolved;
}

/** The resolved style as a plain set, for anything that does not need origins. */
export function resolveStyle(
	options: StyleOptionInfo[],
	config: FormattingConfig | null,
	languageId: string,
): StyleSet {
	const out: StyleSet = {};
	for (const [id, option] of resolveStyleDetailed(
		options,
		config,
		languageId,
	)) {
		out[id] = option.value;
	}
	return out;
}

/**
 * What a level falls back to once it stops overriding an option: the common
 * style for a language row, and the catalogue default for the common style
 * itself. This is the value the field shows when nothing is set here.
 */
export function inheritedValue(
	options: StyleOptionInfo[],
	config: FormattingConfig | null,
	languageId: string,
	level: "common" | "language",
	optionId: string,
): StyleValue | undefined {
	const above: FormattingConfig | null = config
		? {
				...config,
				base: level === "common" ? {} : config.base,
				languages: config.languages.map((l) =>
					l.languageId === languageId ? { ...l, style: {} } : l,
				),
			}
		: null;
	return resolveStyleDetailed(options, above, languageId).get(optionId)?.value;
}

/** Whether a formatter can honour an option, for the greyed-out state and its reason. */
export function isSupported(
	supported: string[] | undefined,
	optionId: string,
): boolean {
	return supported?.includes(optionId) ?? true;
}

/** Sets an override on a level, or clears it when `value` is undefined. */
export function withOverride(
	set: StyleSet,
	optionId: string,
	value: StyleValue | undefined,
): StyleSet {
	const next = { ...set };
	if (value === undefined) {
		delete next[optionId];
	} else {
		next[optionId] = value;
	}
	return next;
}

/** Replaces one language entry, creating it when the config has none yet. */
export function withLanguage(
	config: FormattingConfig,
	languageId: string,
	patch: Partial<LanguageFormatting>,
): FormattingConfig {
	const existing = languageEntry(config, languageId);
	const next: LanguageFormatting = {
		languageId,
		enabled: true,
		formatterId: "",
		command: "",
		args: [],
		style: {},
		...existing,
		...patch,
	};
	return {
		...config,
		languages: existing
			? config.languages.map((l) => (l.languageId === languageId ? next : l))
			: [...config.languages, next],
	};
}

/**
 * The formatter that is not one: choosing it hands the document to the language
 * server. It carries an id of its own because an empty one already means
 * "whatever the catalogue picks for this language". Mirrors `LSP_FORMATTER_ID`
 * in Rust.
 */
export const LSP_FORMATTER_ID = "lsp";

/**
 * The formatter that will actually run for a language: the project's choice,
 * then the catalogue's first for that language.
 */
export function effectiveFormatterId(
	config: FormattingConfig | null,
	languageId: string,
	catalogue: { id: string; languageIds: string[] }[],
): string {
	const chosen = languageEntry(config, languageId)?.formatterId;
	if (chosen) return chosen;
	return catalogue.find((f) => f.languageIds.includes(languageId))?.id ?? "";
}
