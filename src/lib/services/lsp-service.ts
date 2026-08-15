// Language server lifecycle - catalogue, install, start - and the LSP requests
// the editor sends once one is running.

import { invoke } from "@tauri-apps/api/core";

/** Lifecycle of one server on one root. */
export type LanguageServerStatus = "starting" | "ready" | "failed" | "stopped";

/** One way to install or remove a server; `available` is false when the manager is missing. */
export interface ManagerOption {
	manager: string;
	command: string;
	available: boolean;
}

/** A catalogue entry merged with what was found on this machine. */
export interface LanguageServerInfo {
	id: string;
	name: string;
	binary: string;
	args: string[];
	extensions: string[];
	languageIds: string[];
	rootMarkers: string[];
	/** A server the user declared: Cairn runs it but never installs or removes it. */
	custom: boolean;
	installOptions: ManagerOption[];
	uninstallOptions: ManagerOption[];
	updateOptions: ManagerOption[];
	/** Other server ids the same removal command would take away with it. */
	alsoRemoves: string[];
	docUrl: string;
	binaryPath: string | null;
	version: string | null;
	status: LanguageServerStatus;
	/** One of the roots it runs on, null when it is not running. */
	runningRoot: string | null;
}

/** Zero-based, exactly as the protocol sends them. */
export interface LspPosition {
	line: number;
	character: number;
}

/** A span, `end` exclusive as the protocol defines it. */
export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

/** One problem reported on a file. */
export interface LspDiagnostic {
	range: LspRange;
	/** 1 error, 2 warning, 3 information, 4 hint. */
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

/**
 * A place in the workspace, flattened out of the protocol's URI and range.
 * `text` is the source line, when the Rust side could read it for the preview.
 */
export interface LspLocation {
	path: string;
	line: number;
	character: number;
	endLine: number;
	endCharacter: number;
	text: string | null;
}

/** A completion candidate; `textEdit` wins over `insertText` when both are set. */
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

/** A replacement over a range; edits of one file never overlap. */
export interface LspTextEdit {
	range: LspRange;
	newText: string;
}

/** Every edit a refactor makes to one file. */
export interface LspFileEdit {
	path: string;
	edits: LspTextEdit[];
}

/** Signatures for the call being typed; a parameter label may be a range into the signature label. */
export interface LspSignatureHelp {
	signatures: {
		label: string;
		documentation?: string | { kind: string; value: string };
		parameters?: { label: string | [number, number] }[];
	}[];
	activeSignature?: number;
	activeParameter?: number;
}

/**
 * Hover payload. The union is the protocol's own history: a bare string, a
 * marked-up block, or the deprecated array form, and servers still send all three.
 */
export interface LspHoverResult {
	contents:
		| string
		| { kind: string; value: string }
		| (string | { language?: string; value: string })[];
	range?: LspRange;
}

/** Tauri event announcing a server changed state; `message` carries the failure reason. */
export interface LspStatusEvent {
	serverId: string;
	root: string;
	status: LanguageServerStatus;
	message: string | null;
}

/**
 * Tauri event pushing diagnostics for one file. The list is authoritative, so
 * an empty one means the file is clean, not that nothing was reported.
 */
export interface LspDiagnosticsEvent {
	serverId: string;
	root: string;
	path: string;
	diagnostics: LspDiagnostic[];
}

/** Identifies an open document: which server, on which root, for which file. */
export interface LspDocRef {
	serverId: string;
	root: string;
	path: string;
}

/** The catalogue, each entry resolved against what is installed; `root` decides which apply here. */
export function listLanguageServers(
	root: string | null,
): Promise<LanguageServerInfo[]> {
	return invoke<LanguageServerInfo[]>("list_language_servers", { root });
}

/** What a cancelled command rejects with, so it can be told from a failure. */
export const COMMAND_CANCELLED = "cancelled";

/** One output line of an install or removal in progress, streamed as it comes. */
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

/** Result of asking one manager whether the installed server is behind. */
export interface UpdateCheck {
	serverId: string;
	/**
	 * `true` outdated, `false` up to date, `null` when nothing could be
	 * established. An unknown state is never shown as up to date.
	 */
	outdated: boolean | null;
	/** The version the manager would install, when it names one. */
	latest: string | null;
	manager: string | null;
}

/**
 * Asks every installed server's manager whether a newer version exists. One
 * process and one network round-trip per server, so it only ever runs when the
 * user asks for it.
 */
export function checkLanguageServerUpdates(
	root: string | null,
): Promise<UpdateCheck[]> {
	return invoke<UpdateCheck[]>("check_language_server_updates", { root });
}

/**
 * Brings an installed server up to date. The server is stopped first, and the
 * next file of its language starts the new binary.
 */
export function updateLanguageServer(
	serverId: string,
	manager: string,
): Promise<string> {
	return invoke<string>("update_language_server", { serverId, manager });
}

/** Which manager should update this server, or null when none can. */
export function updateManagerFor(serverId: string): Promise<string | null> {
	return invoke<string | null>("update_manager_for", { serverId });
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

/** Stops every server started on a worktree, when its instance goes away. */
export function stopLanguageServersFor(worktree: string): Promise<void> {
	return invoke("stop_language_servers_for", { worktree });
}

/** Declares a document open; every later request on it needs this first. */
export function lspDidOpen(
	doc: LspDocRef,
	languageId: string,
	text: string,
): Promise<void> {
	return invoke("lsp_did_open", { ...doc, languageId, text });
}

/** Sends the whole new text, not an incremental change. */
export function lspDidChange(doc: LspDocRef, text: string): Promise<void> {
	return invoke("lsp_did_change", { ...doc, text });
}

/** Signals a save, which is what some servers wait for before rechecking. */
export function lspDidSave(doc: LspDocRef, text: string): Promise<void> {
	return invoke("lsp_did_save", { ...doc, text });
}

/** Closes the document; the server drops its diagnostics for it. */
export function lspDidClose(doc: LspDocRef): Promise<void> {
	return invoke("lsp_did_close", { ...doc });
}

/** Completions at a position; servers answer with either shape of the union. */
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

/** Documentation at a position, null when the server has nothing to say there. */
export function lspHover(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspHoverResult | null> {
	return invoke("lsp_hover", { ...doc, ...position });
}

/** Signatures for the call around the position, null outside a call. */
export function lspSignatureHelp(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspSignatureHelp | null> {
	return invoke("lsp_signature_help", { ...doc, ...position });
}

/** Where the symbol is defined; more than one location when it is ambiguous. */
export function lspDefinition(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspLocation[]> {
	return invoke<LspLocation[]>("lsp_definition", { ...doc, ...position });
}

/** Implementations of the interface or abstract symbol at the position. */
export function lspImplementation(
	doc: LspDocRef,
	position: LspPosition,
): Promise<LspLocation[]> {
	return invoke<LspLocation[]>("lsp_implementation", { ...doc, ...position });
}

/** Every use of the symbol across the workspace, the slowest of these requests. */
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

/** Edits a rename would make, across every file; applying them is up to the caller. */
export function lspRename(
	doc: LspDocRef,
	position: LspPosition,
	newName: string,
): Promise<LspFileEdit[]> {
	return invoke<LspFileEdit[]>("lsp_rename", { ...doc, ...position, newName });
}

/** Edits that format the whole document, null when the server declines. */
export function lspFormat(
	doc: LspDocRef,
	tabSize: number,
	insertSpaces: boolean,
): Promise<LspTextEdit[] | null> {
	return invoke("lsp_format", { ...doc, tabSize, insertSpaces });
}
