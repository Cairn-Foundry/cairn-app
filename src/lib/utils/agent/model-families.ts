import { prettyModelName } from "$lib/components/home/agents/providers-data";
import type { DiscoveredModel } from "$lib/services/ai-provider-service";

export interface ModelFamily {
	key: string;
	label: string;
	models: DiscoveredModel[];
}

const NOISE = new Set(["latest", "preview", "exp"]);

function tokensOf(id: string): string[] {
	return id
		.replace(/^models\//, "")
		.replace(/:.*$/, "")
		.replace(/-\d{8}$/, "")
		.split("-")
		.filter((part) => part.length > 0 && !NOISE.has(part.toLowerCase()));
}

/** The tokens that name the model rather than its version. */
function familyTokens(id: string): string[] {
	const tokens = tokensOf(id);
	const version = tokens.findIndex((part) => /^\d/.test(part));
	return version <= 0 ? tokens : tokens.slice(0, version);
}

/**
 * The vendor word every multi-token id repeats - `claude` in
 * `claude-opus-4-5`. It names the provider, not the family, so dropping it is
 * what puts an `opus` alias and a `claude-opus-4-5` release side by side.
 */
function sharedPrefix(models: DiscoveredModel[]): string | null {
	const heads = models
		.map((m) => familyTokens(m.id))
		.filter((tokens) => tokens.length > 1)
		.map((tokens) => tokens[0]);
	if (heads.length < 2) return null;
	return heads.every((head) => head === heads[0]) ? heads[0] : null;
}

function isVersionless(id: string): boolean {
	return !/\d/.test(id);
}

/**
 * Groups a provider's catalogue into families, so a picker can offer the family
 * first and its releases second. Everything is derived from the ids the
 * provider reported: no family is known in advance.
 */
export function groupModelFamilies(models: DiscoveredModel[]): ModelFamily[] {
	const prefix = sharedPrefix(models);
	const families = new Map<string, ModelFamily>();

	for (const model of models) {
		const tokens = familyTokens(model.id);
		const named =
			prefix && tokens.length > 1 && tokens[0] === prefix
				? tokens.slice(1)
				: tokens;
		const key = (named.length > 0 ? named : tokens).join("-").toLowerCase();
		const family = families.get(key);
		if (family) {
			family.models.push(model);
		} else {
			families.set(key, {
				key,
				label: prettyModelName(key),
				models: [model],
			});
		}
	}

	for (const family of families.values()) {
		// The unversioned alias tracks the latest release, so it leads its family.
		family.models.sort((a, b) => {
			const aBare = isVersionless(a.id);
			const bBare = isVersionless(b.id);
			if (aBare !== bBare) return aBare ? -1 : 1;
			return b.id.localeCompare(a.id, undefined, { numeric: true });
		});
	}

	return [...families.values()];
}
