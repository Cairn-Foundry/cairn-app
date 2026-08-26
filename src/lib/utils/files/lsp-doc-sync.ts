import type { LspDocRef } from "$lib/services/lsp-service";
import {
	lspDidChange,
	lspDidClose,
	lspDidOpen,
	lspDidSave,
} from "$lib/services/lsp-service";
import {
	clearDiagnosticsFor,
	ensureDocument,
	forgetDocument,
} from "$lib/stores/language-server";
import { LSP_CHANGE_DEBOUNCE_MS } from "$lib/utils/timing";
import type { LspContentChange } from "./document-model";

/**
 * The documents the language servers hold open for one files view, keyed by
 * absolute path - never by the pane that showed them: a pane changes document
 * while a server is still starting, and a change attributed to the slot
 * rather than to the file lands in the wrong buffer. Changes are batched per
 * document and sent as increments.
 */
export class LspDocSync {
	private docs = new Map<string, LspDocRef>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private pending = new Map<string, LspContentChange[]>();

	get(absolute: string): LspDocRef | null {
		return this.docs.get(absolute) ?? null;
	}

	/** Lazy start plus `didOpen`; null for a file no enabled server covers. */
	async open(
		worktree: string,
		absolute: string,
		languageId: string,
		text: () => string,
	): Promise<LspDocRef | null> {
		const doc = await ensureDocument(worktree, absolute);
		if (!doc) return null;
		this.docs.set(absolute, doc);
		await lspDidOpen(doc, languageId, text()).catch(() => {
			this.docs.delete(absolute);
			forgetDocument(doc);
		});
		return doc;
	}

	change(absolute: string, changes: LspContentChange[]): void {
		const doc = this.docs.get(absolute);
		if (!doc || changes.length === 0) return;
		const queued = this.pending.get(doc.path) ?? [];
		queued.push(...changes);
		this.pending.set(doc.path, queued);
		const timer = this.timers.get(doc.path);
		if (timer) clearTimeout(timer);
		this.timers.set(
			doc.path,
			setTimeout(() => this.flush(doc), LSP_CHANGE_DEBOUNCE_MS),
		);
	}

	/** Sends what is queued for a document now; a save must not race its own edits. */
	flush(doc: LspDocRef): void {
		const timer = this.timers.get(doc.path);
		if (timer) clearTimeout(timer);
		this.timers.delete(doc.path);
		const queued = this.pending.get(doc.path);
		this.pending.delete(doc.path);
		if (queued?.length) lspDidChange(doc, queued).catch(() => {});
	}

	saved(absolute: string, text: string): void {
		const doc = this.docs.get(absolute);
		if (!doc) return;
		this.flush(doc);
		lspDidSave(doc, text).catch(() => {});
	}

	close(absolute: string): void {
		const doc = this.docs.get(absolute);
		if (!doc) return;
		const timer = this.timers.get(doc.path);
		if (timer) clearTimeout(timer);
		this.timers.delete(doc.path);
		this.pending.delete(doc.path);
		this.docs.delete(absolute);
		clearDiagnosticsFor(absolute);
		lspDidClose(doc).catch(() => {});
	}

	/**
	 * Leaving a scope closes every document the servers still hold for it: an
	 * idle tsserver otherwise keeps recomputing diagnostics for files nobody is
	 * looking at. They are reopened on return.
	 */
	closeAll(): void {
		for (const absolute of [...this.docs.keys()]) this.close(absolute);
	}
}
