import { invoke } from "@tauri-apps/api/core";
import type { ManagerOption } from "$lib/services/lsp-service";

/** A style value. Flat scalars only, so a style stays diffable and inheritable. */
export type StyleValue = string | number | boolean;

/** Sparse by design: a missing key means "inherit from the level above". */
export type StyleSet = Record<string, StyleValue>;

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

export interface FormattingConfig {
	enabled: boolean;
	formatOnSave: boolean;
	respectRepoConfig: boolean;
	base: StyleSet;
	languages: LanguageFormatting[];
}

export const DEFAULT_FORMATTING: FormattingConfig = {
	enabled: true,
	formatOnSave: false,
	respectRepoConfig: true,
	base: {},
	languages: [],
};

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

export interface FormatOutcome {
	text: string;
	changed: boolean;
	/** A formatter id, `lsp`, `builtin`, or empty when nothing could run. */
	formatterId: string;
	repoConfig: string | null;
	/** The style in force, so the language server fallback obeys the same one. */
	style: StyleSet;
}

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

export interface DetectedConfig {
	formatterId: string;
	file: string;
}

export interface ExportResult {
	path: string;
	dropped: string[];
}

export function getProjectFormatting(
	projectId: string,
): Promise<FormattingConfig> {
	return invoke<FormattingConfig>("get_project_formatting", { projectId });
}

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

export function listStyleOptions(): Promise<StyleOptionInfo[]> {
	return invoke<StyleOptionInfo[]>("list_style_options");
}

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

export function detectRepoFormatters(
	worktree: string,
): Promise<DetectedConfig[]> {
	return invoke<DetectedConfig[]>("detect_repo_formatters", { worktree });
}

export function importFormattingConfig(path: string): Promise<ImportReport> {
	return invoke<ImportReport>("import_formatting_config", { path });
}

export function exportFormattingConfig(args: {
	path: string;
	target: string;
	config: FormattingConfig;
	style: StyleSet;
}): Promise<ExportResult> {
	return invoke<ExportResult>("export_formatting_config", args);
}

export function installFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("install_formatter", { formatterId, manager });
}

export function uninstallFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("uninstall_formatter", { formatterId, manager });
}

export function updateFormatter(
	formatterId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("update_formatter", { formatterId, manager });
}

export function uninstallManagerForFormatter(
	formatterId: string,
): Promise<string | null> {
	return invoke<string | null>("uninstall_manager_for_formatter", {
		formatterId,
	});
}

export function updateManagerForFormatter(
	formatterId: string,
): Promise<string | null> {
	return invoke<string | null>("update_manager_for_formatter", { formatterId });
}
