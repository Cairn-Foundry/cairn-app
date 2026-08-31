// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every user-visible string goes through `t()`, so a key present in one
// language and missing from the other renders as the raw key path in the app.
// Nothing at runtime complains, and the two files are three thousand lines
// each: the parity has to be checked rather than watched.

import { describe, expect, it } from "vitest";
import { en, enGreetings } from "./en";
import { fr, frGreetings } from "./fr";

type Tree = Record<string, unknown>;

/** Every leaf path of a dictionary, as `t()` addresses them. */
function leafPaths(tree: Tree, prefix = ""): string[] {
	const paths: string[] = [];
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			paths.push(...leafPaths(value as Tree, path));
		} else {
			paths.push(path);
		}
	}
	return paths;
}

/** The value at a leaf path, or undefined when the path leads nowhere. */
function valueAt(tree: Tree, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(node, key) => (node as Tree | undefined)?.[key],
			tree as unknown,
		);
}

const ENGLISH = leafPaths(en as Tree);
const FRENCH = leafPaths(fr as Tree);

describe("the two dictionaries carry the same keys", () => {
	it("finds a substantial number of keys", () => {
		expect(ENGLISH.length).toBeGreaterThan(500);
	});

	it("translates every English key into French", () => {
		const missing = ENGLISH.filter((path) => !FRENCH.includes(path));
		expect(missing).toEqual([]);
	});

	it("leaves no French key without its English original", () => {
		const extra = FRENCH.filter((path) => !ENGLISH.includes(path));
		expect(extra).toEqual([]);
	});

	it("nests the same keys the same way in both", () => {
		const shapeOf = (tree: Tree, path: string) => {
			const value = valueAt(tree, path);
			if (Array.isArray(value)) return "array";
			return value === null ? "null" : typeof value;
		};
		const mismatched = ENGLISH.filter(
			(path) => shapeOf(en as Tree, path) !== shapeOf(fr as Tree, path),
		);
		expect(mismatched).toEqual([]);
	});
});

describe("every translation says something", () => {
	/**
	 * `git.errors.codes.unknown.hint` is deliberately empty: an unrecognised
	 * git failure has no advice to offer, and the view renders no hint line.
	 * Any other empty entry is a translation nobody wrote.
	 */
	const DELIBERATELY_EMPTY = ["git.errors.codes.unknown.hint"];

	it("leaves no English string empty by accident", () => {
		const empty = ENGLISH.filter(
			(path) =>
				valueAt(en as Tree, path) === "" && !DELIBERATELY_EMPTY.includes(path),
		);
		expect(empty).toEqual([]);
	});

	it("leaves no French string empty by accident", () => {
		const empty = FRENCH.filter(
			(path) =>
				valueAt(fr as Tree, path) === "" && !DELIBERATELY_EMPTY.includes(path),
		);
		expect(empty).toEqual([]);
	});

	it("keeps an entry empty on both sides when it is meant to be", () => {
		for (const path of DELIBERATELY_EMPTY) {
			expect(valueAt(en as Tree, path), path).toBe("");
			expect(valueAt(fr as Tree, path), path).toBe("");
		}
	});

	/**
	 * A key is either a plain string or a function taking the values to
	 * interpolate - `stepOf: (step, total) => ...`. Anything else would not
	 * render.
	 */
	it("gives every key a string or an interpolating function", () => {
		const renderable = (value: unknown) =>
			typeof value === "string" || typeof value === "function";
		const wrong = ENGLISH.filter(
			(path) => !renderable(valueAt(en as Tree, path)),
		).concat(FRENCH.filter((path) => !renderable(valueAt(fr as Tree, path))));
		expect(wrong).toEqual([]);
	});

	it("takes the same arguments on both sides of an interpolating key", () => {
		const mismatched = ENGLISH.filter((path) => {
			const english = valueAt(en as Tree, path);
			const french = valueAt(fr as Tree, path);
			if (typeof english !== "function") return false;
			return typeof french !== "function" || english.length !== french.length;
		});
		expect(mismatched).toEqual([]);
	});

	/**
	 * A French entry left as its English original is usually an untranslated
	 * one. Plenty of words are legitimately identical, so this only reports the
	 * longer entries, where a real translation would differ.
	 */
	it("translates the long entries rather than copying them", () => {
		const untranslated = ENGLISH.filter((path) => {
			const english = valueAt(en as Tree, path);
			if (typeof english !== "string" || english.length < 40) return false;
			return english === valueAt(fr as Tree, path);
		});
		expect(untranslated).toEqual([]);
	});
});

describe("interpolation placeholders line up", () => {
	/** The `{name}` slots a string declares. */
	const slotsOf = (text: unknown): string[] =>
		typeof text === "string"
			? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
			: [];

	/**
	 * `env.valueHint` spells out an example of the syntax rather than carrying
	 * a slot, so its placeholder is translated along with the sentence.
	 */
	const SPELLS_OUT_AN_EXAMPLE = ["env.valueHint"];

	it("gives a translation the same slots as its original", () => {
		const mismatched = ENGLISH.filter((path) => {
			if (SPELLS_OUT_AN_EXAMPLE.includes(path)) return false;
			const english = slotsOf(valueAt(en as Tree, path));
			const french = slotsOf(valueAt(fr as Tree, path));
			return english.join(",") !== french.join(",");
		});
		expect(mismatched).toEqual([]);
	});
});

describe("the greeting pools", () => {
	it("offers the same buckets in both languages", () => {
		expect(Object.keys(enGreetings).sort()).toEqual(
			Object.keys(frGreetings).sort(),
		);
	});

	it("fills every bucket in both languages", () => {
		for (const [name, pool] of Object.entries(enGreetings)) {
			expect(Array.isArray(pool), `en.${name}`).toBe(true);
			expect((pool as string[]).length, `en.${name}`).toBeGreaterThan(0);
		}
		for (const [name, pool] of Object.entries(frGreetings)) {
			expect(Array.isArray(pool), `fr.${name}`).toBe(true);
			expect((pool as string[]).length, `fr.${name}`).toBeGreaterThan(0);
		}
	});

	it("leaves no greeting empty", () => {
		for (const pools of [enGreetings, frGreetings]) {
			for (const [name, pool] of Object.entries(pools)) {
				for (const greeting of pool as string[]) {
					expect(greeting.length, name).toBeGreaterThan(0);
				}
			}
		}
	});
});

describe("the strings follow the project's typography rules", () => {
	/**
	 * ASCII punctuation only: the codebase forbids the typographic variants
	 * (em and en dash, curly quotes, ellipsis, box drawing). Built from code
	 * points so this file never carries the characters it forbids.
	 */
	const FORBIDDEN = new RegExp(
		[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x2500]
			.map((code) => String.fromCharCode(code))
			.join("|"),
	);

	it("uses no typographic punctuation in English", () => {
		const offenders = ENGLISH.filter((path) => {
			const value = valueAt(en as Tree, path);
			return typeof value === "string" && FORBIDDEN.test(value);
		});
		expect(offenders).toEqual([]);
	});

	it("uses no typographic punctuation in French", () => {
		const offenders = FRENCH.filter((path) => {
			const value = valueAt(fr as Tree, path);
			return typeof value === "string" && FORBIDDEN.test(value);
		});
		expect(offenders).toEqual([]);
	});

	/** Accents are required, and a French dictionary that lost them is broken. */
	it("keeps the accents the French strings need", () => {
		const accented = FRENCH.filter((path) => {
			const value = valueAt(fr as Tree, path);
			return typeof value === "string" && /[À-ÿ]/.test(value);
		});
		expect(accented.length).toBeGreaterThan(50);
	});
});
