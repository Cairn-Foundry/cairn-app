import { invoke } from "@tauri-apps/api/core";

export type LanguageServerStatus = "starting" | "ready" | "failed" | "stopped";

export interface ManagerOption {
	manager: string;
	command: string;
	available: boolean;
}

export interface LanguageServerInfo {
	id: string;
	name: string;
	binary: string;
	extensions: string[];
	installOptions: ManagerOption[];
	uninstallOptions: ManagerOption[];
	alsoRemoves: string[];
	docUrl: string;
	binaryPath: string | null;
	version: string | null;
	status: LanguageServerStatus;
	runningRoot: string | null;
}

/** Zero-based, exactly as the protocol sends them. */
export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspDiagnostic {
	range: LspRange;
	/** 1 error, 2 warning, 3 information, 4 hint. */
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

export interface LspLocation {
	path: string;
	line: number;
	character: number;
	endLine: number;
	endCharacter: number;
	text: string | null;
}

export interface LspCompletionItem {
	label: string;
	kind?: number;
	detail?: string;
	documentation?: string | { kind: string; value: string };
	sortText?: string;
	filterText?: string;
	insertText?: string;
	textEdit?: { range?: LspRange; newText: string };
}

export interface LspTextEdit {
	range: LspRange;
	newText: string;
}

export interface LspFileEdit {
	path: string;
	edits: LspTextEdit[];
}

export interface LspSignatureHelp {
	signatures: {
		label: string;
		documentation?: string | { kind: string; value: string };
		parameters?: { label: string | [number, number] }[];
	}[];
	activeSignature?: number;
	activeParameter?: number;
}

export interface LspHoverResult {
	contents:
		| string
		| { kind: string; value: string }
		| (string | { language?: string; value: string })[];
	range?: LspRange;
}

export interface LspStatusEvent {
	serverId: string;
	root: string;
	status: LanguageServerStatus;
	message: string | null;
}

export interface LspDiagnosticsEvent {
	serverId: string;
	root: string;
	path: string;
	diagnostics: LspDiagnostic[];
}

export interface LspDocRef {
	serverId: string;
	root: string;
	path: string;
}

export function listLanguageServers(
	root: string | null,
): Promise<LanguageServerInfo[]> {
	return invoke<LanguageServerInfo[]>("list_language_servers", { root });
}

/** What a cancelled command rejects with, so it can be told from a failure. */
export const COMMAND_CANCELLED = "cancelled";

export interface LspManagerEvent {
	serverId: string;
	line: string;
}

/** Runs the catalogue install command and answers with what it printed. */
export function installLanguageServer(
	serverId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("install_language_server", { serverId, manager });
}

/** Runs the catalogue removal command with the manager that owns the binary. */
export function uninstallLanguageServer(
	serverId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("uninstall_language_server", { serverId, manager });
}

/** Which manager should remove this server, or null when none can. */
export function uninstallManagerFor(serverId: string): Promise<string | null> {
	return invoke<string | null>("uninstall_manager_for", { serverId });
}

/** Stops an install or a removal in flight. */
export function cancelLanguageServerCommand(serverId: string): Promise<void> {
	return invoke("cancel_language_server_command", { serverId });
}

/** Answers with the workspace root the server was started on. */
export function startLanguageServer(
	serverId: string,
	worktree: string,
	filePath: string,
	command: string,
	args: string[],
): Promise<string> {
	return invoke<string>("start_language_server", {
		serverId,
		worktree,
		filePath,
		command,
		args,
	});
}

/** Stops a server on every root it runs on, wherever it was started from. */
export function stopLanguageServersWithId(serverId: string): Promise<void> {
	return invoke("stop_language_servers_with_id", { serverId });
}

export function stopLanguageServersFor(worktree: string): Promise<void> {
	return invoke("stop_language_servers_for", { worktree });
}

export function lspDidOpen(
	doc: LspDocRef,
	languageId: string,
	text: string,
): Promise<void> {
	return invoke("lsp_did_open", { ...doc, languageId, text });
}

export function lspDidChange(doc: LspDocRef, text: string): Promise<void> {
	return invoke("lsp_did_change", { ...doc, text });
}

export function lspDidSave(doc: LspDocRef, text: string): Promise<void> {
	return invoke("lsp_did_save", { ...doc, text });
}

export function lspDidClose(doc: LspDocRef): Promise<void> {
	return invoke("lsp_did_close", { ...doc });
}

export function lspCompletion(
	doc: LspDocRef,
	position: LspPosition,
): Promise<
	| LspCompletionItem[]
	| { items: LspCompletionItem[]; isIncomplete?: boolean }
	| null
> {
	return invoke("lsp_completion", { ...doc, ...position });
}

export function lspHover(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspHoverResult | null> {
	return invoke("lsp_hover", { ...doc, ...position });
}

export function lspSignatureHelp(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspSignatureHelp | null> {
	return invoke("lsp_signature_help", { ...doc, ...position });
}

export function lspDefinition(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspLocation[]> {
	return invoke<LspLocation[]>("lsp_definition", { ...doc, ...position });
}

export function lspImplementation(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspLocation[]> {
	return invoke<LspLocation[]>("lsp_implementation", { ...doc, ...position });
}

export function lspReferences(
	doc: LspDocRef,
	position: LspPosition,
	includeDeclaration: boolean,
): Promise<LspLocation[]> {
	return invoke<LspLocation[]>("lsp_references", {
		...doc,
		...position,
		includeDeclaration,
	});
}

export function lspRename(
	doc: LspDocRef,
	position: LspPosition,
	newName: string,
): Promise<LspFileEdit[]> {
	return invoke<LspFileEdit[]>("lsp_rename", { ...doc, ...position, newName });
}

export function lspFormat(
	doc: LspDocRef,
	tabSize: number,
	insertSpaces: boolean,
): Promise<LspTextEdit[] | null> {
	return invoke("lsp_format", { ...doc, tabSize, insertSpaces });
}
