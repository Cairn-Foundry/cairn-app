// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getLocale, type Locale } from "$lib/i18n";
import releases from "./changelog.json";

export type ChangeKind = "added" | "changed" | "fixed" | "removed";

/** Section order inside a release. */
export const CHANGE_KINDS: ChangeKind[] = [
	"added",
	"changed",
	"fixed",
	"removed",
];

type LocalizedText = Record<Locale, string>;

export interface ChangelogChange {
	kind: ChangeKind;
	text: LocalizedText;
}

interface ChangelogRelease {
	version: string;
	/** ISO date, empty while the version is still in development. */
	date: string;
	summary: LocalizedText;
	changes: ChangelogChange[];
}

export function localized(text: LocalizedText): string {
	return text[getLocale()];
}

export const CHANGELOG = releases as ChangelogRelease[];
