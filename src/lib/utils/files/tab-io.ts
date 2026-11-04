// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Text } from "@codemirror/state";
import {
	isWriteConflict,
	readFileVersioned,
	writeFile,
} from "#lib/services/file-service";
import { docFromString } from "./document-model";
import {
	denormalizeLineEndings,
	detectLineEndings,
	normalizeLineEndings,
} from "./files-indent";
import type { Tab } from "./files-persistence";

// Reading a file into a tab and writing a tab back, shared by the main editor
// and the detached editor windows.

export interface ReadTab {
	doc: Text;
	lineEndings: "LF" | "CRLF";
	version: string | null;
}

/** Reads a file the way a tab holds it: LF inside, the original line endings remembered. */
export async function readTabFile(absolute: string): Promise<ReadTab> {
	const read = await readFileVersioned(absolute);
	const raw = read.text ?? "";
	const lineEndings = detectLineEndings(raw);
	return {
		doc: docFromString(normalizeLineEndings(raw, lineEndings)),
		lineEndings,
		version: read.version,
	};
}

/** What a tab writes to disk: its buffer with its own line endings. */
export function diskContentOf(tab: Tab): string {
	return denormalizeLineEndings(tab.doc.toString(), tab.lineEndings ?? "LF");
}

/**
 * Writes a tab's content, refusing to clobber a file that moved since the tab
 * last read it. Returns whether the write went through; the caller decides what
 * a refusal means - raising the modal, or just marking the tab.
 *
 * The mtime check happens inside `write_file`, so nothing can slip between the
 * check and the write.
 */
export async function writeTab(
	tab: Tab,
	content: string,
	absolute: string,
): Promise<{ written: true } | { written: false; deleted: boolean }> {
	// The version comes from the read, not from a fresh stat taken here: stat'ing
	// now would compare the file against itself and wave through the very
	// overwrite this exists to catch. `readFile` records it as it receives the
	// bytes, so it provably belongs to the content the tab is showing.
	const outcome = await writeFile(absolute, content, tab.version ?? null);
	if (isWriteConflict(outcome))
		return { written: false, deleted: outcome.actualVersion === null };
	tab.version = outcome.version;
	tab.conflicted = false;
	return { written: true };
}
