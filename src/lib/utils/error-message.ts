// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Renders an unknown thrown value as a message a view can show.
 *
 * A rejected `invoke()` carries whatever the Rust side serialized, which is a
 * string for a `Result<_, String>` command but an object as soon as the error
 * type is a struct - and Tauri's own failures (argument deserialization, an
 * unknown command) always reject with one. `String(value)` turns those into
 * "[object Object]", which is what the user ends up reading, so the object is
 * unwrapped here: its usual message field if it has one, its JSON otherwise.
 */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (error !== null && typeof error === "object") {
		const record = error as Record<string, unknown>;
		for (const field of ["message", "error", "reason", "description"]) {
			const value = record[field];
			if (typeof value === "string" && value.trim() !== "") return value;
		}
		try {
			return JSON.stringify(error);
		} catch {
			// A cycle or a BigInt: nothing better than the default rendering.
		}
	}
	return String(error);
}
