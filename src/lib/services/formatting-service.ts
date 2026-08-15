// Code formatting: the formatter catalogue, the per-project style, and running
// a formatter over a document. Mirrors `commands/formatting.rs`.

import { invoke } from "@tauri-apps/api/core";
import type { ManagerOption } from "$lib/services/lsp-service";

/** A style value. Flat scalars only, so a style stays diffable and inheritable. */
export type StyleValue = string | number | boolean;

/** Sparse by design: a missing key means "inherit from the level above". */
export type StyleSet = Record<string, StyleValue>;

/** Declaration of one style option: how it is edited and where it applies. */
export interface StyleOptionInfo {
	id: string;
	kind: "boolean" | "number" | "enum";
	choices: string[];
	min: number | null;
	max: number | null;
	default: StyleValue;
	/** Empty means the option applies to every language. */
	languages: string[];
}

/** Per-language formatting, overriding the config's `base` style. */
export interface LanguageFormatting {
	languageId: string;
	enabled: boolean;
	/** Empty falls back to the catalogue's first formatter for the language. */
	formatterId: string;
	/** Empty uses the catalogue binary. */
	command: string;
	args: string[];
	style: StyleSet;
}

/** A project's whole formatting setup, as stored for that project. */
export interface FormattingConfig {
	enabled: boolean;
	formatOnSave: boolean;
	respectRepoConfig: boolean;
	base: StyleSet;
	languages: LanguageFormatting[];
}

/** Config a project starts from when it has none stored yet. */
export const DEFAULT_FORMATTING: FormattingConfig = {
	enabled: true,
	formatOnSave: false,
	respectRepoConfig: true,
	base: {},
	languages: [],
};

/** A catalogue formatter plus what was found for it on this machine. */
export interface FormatterStatus {
	id: string;
	name: string;
	binary: string;
	languageIds: string[];
	extensions: string[];
	/** The style options this formatter can honour. */
	supported: string[];
	configFiles: string[];
	docUrl: string;
	/** Ships with its language toolchain: Cairn points at it, never installs it. */
	toolchain: boolean;
	installed: boolean;
	binaryPath: string | null;
	version: string | null;
	/** Found in the project's own toolchain rather than on the PATH. */
	projectLocal: boolean;
	installOptions: ManagerOption[];
	uninstallOptions: ManagerOption[];
	updateOptions: ManagerOption[];
}

/** Result of one format run, including who ran and under which style. */
export interface FormatOutcome {
	text: string;
	changed: boolean;
	/** A formatter id, `lsp`, `builtin`, or empty when nothing could run. */
	formatterId: string;
	repoConfig: string | null;
	/** The style in force, so the language server fallback obeys the same one. */
	style: StyleSet;
}

/** What an imported native config yielded, and what had to be dropped. */
export interface ImportReport {
	source: string;
	style: StyleSet;
	/** Options read and mapped, as `[native, cairn]`. */
	mapped: [string, string][];
	unsupported: string[];
	unknown: string[];
	/** Present when the file was Cairn's own export. */
	config?: FormattingConfig | null;
}

/** A formatter config file the repo already carries. */
export interface DetectedConfig {
	formatterId: string;
	file: string;
}

/** Where the export landed, and the options the target format could not carry. */
export interface ExportResult {
	path: string;
	dropped: string[];
}

/** Falls back to DEFAULT_FORMATTING on the Rust side when nothing is stored. */
export function getProjectFormatting(
	projectId: string,
): Promise<FormattingConfig> {
	return invoke<FormattingConfig>("get_project_formatting", { projectId });
}

/** Replaces the stored config wholesale; there is no partial update. */
export function saveProjectFormatting(
	projectId: string,
	config: FormattingConfig,
): Promise<void> {
	return invoke("save_project_formatting", { projectId, config });
}

/**
 * Every formatter with its state on this machine. `root` is the worktree, so a
 * binary in the project's own toolchain is found and reported as the project's.
 */
export function listFormatters(root?: string): Promise<FormatterStatus[]> {
	return invoke<FormatterStatus[]>("list_formatters", { root: root ?? null });
}

/** The style vocabulary itself: every option Cairn knows how to express. */
export function listStyleOptions(): Promise<StyleOptionInfo[]> {
	return invoke<StyleOptionInfo[]>("list_style_options");
}

/** Language ids at least one catalogue formatter covers. */
export function listFormattableLanguages(): Promise<string[]> {
	return invoke<string[]>("list_formattable_languages");
}

/** Formats text and hands it back. Never writes to disk. */
export function formatDocument(args: {
	projectId: string | null;
	worktree: string;
	path: string;
	content: string;
}): Promise<FormatOutcome> {
	return invoke<FormatOutcome>("format_document", args);
}

/** Scans the worktree for native config files, so the repo's own style can win. */
export function detectRepoFormatters(
	worktree: string,
): Promise<DetectedConfig[]> {
	return invoke<DetectedConfig[]>("detect_repo_formatters", { worktree });
}

/** Reads a native config into Cairn's style vocabulary; reports nothing to disk. */
export function importFormattingConfig(path: string): Promise<ImportReport> {
	return invoke<ImportReport>("import_formatting_config", { path });
}

/** Writes the style out in `target`'s own format; options it cannot express are dropped. */
export function exportFormattingConfig(args: {
	path: string;
	target: string;
	config: FormattingConfig;
	style: StyleSet;
}): Promise<ExportResult> {
	return invoke<ExportResult>("export_formatting_config", args);
}

/** Runs the chosen package manager; resolves with its output. */
export function installFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("install_formatter", { formatterId, manager });
}

/** Runs the chosen package manager; resolves with its output. */
export function uninstallFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("uninstall_formatter", { formatterId, manager });
}

/** Runs the chosen package manager; resolves with its output. */
export function updateFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("update_formatter", { formatterId, manager });
}

/** Removes the manager the formatter was installed with; null when there is none. */
export function uninstallManagerForFormatter(
	formatterId: string,
): Promise<string | null> {
	return invoke<string | null>("uninstall_manager_for_formatter", {
		formatterId,
	});
}

/** Updates the manager the formatter was installed with; null when there is none. */
export function updateManagerForFormatter(
	formatterId: string,
): Promise<string | null> {
	return invoke<string | null>("update_manager_for_formatter", { formatterId });
}
