import { syntaxTree } from "@codemirror/language";
import {
	type EditorState,
	type Extension,
	type Range,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { parentPathOf } from "$lib/utils/files/files-tree";

// Markdown rendered inline in the editor: headings, emphasis, links, rules,
// bullets, task boxes, images and tables are decorated and their markup hidden.
// There is no preview pane - the document stays editable, and the lines the
// selection touches reveal their raw source so the markup can be edited.

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

const headingLine = HEADING_LEVELS.map((level) =>
	Decoration.line({ class: `cm-md-heading cm-md-h${level}` }),
);

const quoteLine = Decoration.line({ class: "cm-md-quote" });
const LINK_HREF_ATTR = "data-cm-md-href";
const codeLine = Decoration.line({ class: "cm-md-code-block" });
const hidden = Decoration.replace({});

/** The edited file's path, needed to resolve relative images and links. */
export const setMarkdownDocPath = StateEffect.define<string | null>();

const markdownDocPath = StateField.define<string | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setMarkdownDocPath)) return effect.value;
		}
		return value;
	},
});

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** The handful of entities that appear in alt text and hrefs; unknown ones stay. */
export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1] === "x" || body[1] === "X"
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}

const SAFE_URL_SCHEME = /^(https?|data|blob):/i;
const ANY_URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A local image goes through Tauri's asset protocol, resolved against the
 * document's directory. A src carrying any scheme other than http, https, data
 * or blob is dropped: a `javascript:` or `file:` src must never be rendered.
 */
export function resolveImageSrc(src: string, docPath: string | null): string {
	const clean = decodeHtmlEntities(src.trim());
	if (SAFE_URL_SCHEME.test(clean)) return clean;
	if (ANY_URL_SCHEME.test(clean)) return "";

	const absolute = clean.startsWith("/")
		? clean
		: docPath
			? `${parentPathOf(docPath)}/${clean}`
			: null;
	if (!absolute) return "";
	try {
		return convertFileSrc(absolute);
	} catch {
		return "";
	}
}

/** An image and its optional intrinsic size, from either markdown or `<img>`. */
export interface HtmlImage {
	src: string;
	alt: string;
	width: string | null;
	height: string | null;
}

const HTML_IMG_TAG = /^<img\s([^>]*?)\/?>$/i;

/** One attribute value, quoted either way or bare. */
function htmlAttribute(attrs: string, name: string): string | null {
	const match = new RegExp(
		`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
		"i",
	).exec(attrs);
	if (!match) return null;
	return match[2] ?? match[3] ?? match[4] ?? null;
}

/**
 * Inline HTML is deliberately limited to `<img>`: every other tag is left as
 * raw text rather than injected, so a markdown file can never smuggle markup
 * into the editor.
 */
export function parseHtmlImage(source: string): HtmlImage | null {
	const tag = HTML_IMG_TAG.exec(source.trim());
	if (!tag) return null;
	const src = htmlAttribute(tag[1], "src");
	if (!src) return null;
	return {
		src,
		alt: decodeHtmlEntities(htmlAttribute(tag[1], "alt") ?? ""),
		width: htmlAttribute(tag[1], "width"),
		height: htmlAttribute(tag[1], "height"),
	};
}

const MARKDOWN_IMAGE =
	/^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)$/;

/** The destination of a `[text](href)` link, entities decoded. */
export function linkHref(source: string): string | null {
	const match = /\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/.exec(
		source.trim(),
	);
	return match ? decodeHtmlEntities(match[1]) : null;
}

const OPENABLE_LINK = /^(https?|mailto):/i;

/** Only http, https and mailto are handed to the system browser. */
export function isOpenableLink(href: string): boolean {
	return OPENABLE_LINK.test(href.trim());
}

/** What a link resolves to, once its scheme has been judged. */
export type LinkTarget =
	| { kind: "external"; href: string }
	| { kind: "anchor"; anchor: string }
	| { kind: "file"; path: string; anchor: string | null }
	| { kind: "unsupported" };

/**
 * Decides how a markdown link opens: http/mailto to the system browser,
 * #anchor in-document, a relative path as a new tab. Any other scheme is
 * ignored rather than followed.
 */
export function parseLinkTarget(href: string): LinkTarget {
	const clean = href.trim();
	if (!clean) return { kind: "unsupported" };
	if (isOpenableLink(clean)) return { kind: "external", href: clean };
	if (ANY_URL_SCHEME.test(clean)) return { kind: "unsupported" };
	if (clean.startsWith("#")) {
		return { kind: "anchor", anchor: clean.slice(1) };
	}

	const hash = clean.indexOf("#");
	const path = hash === -1 ? clean : clean.slice(0, hash);
	const anchor = hash === -1 ? null : clean.slice(hash + 1);
	if (!path) return { kind: "unsupported" };
	return { kind: "file", path: decodeURIComponent(path), anchor };
}

/** Resolves a link target against the edited file, applying `.` and `..`. */
export function resolveDocRelativePath(
	docPath: string | null,
	target: string,
): string | null {
	if (target.startsWith("/")) return target;
	if (!docPath) return null;

	const segments = parentPathOf(docPath).split("/").filter(Boolean);
	const leadingSlash = docPath.startsWith("/");
	for (const part of target.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") segments.pop();
		else segments.push(part);
	}
	const joined = segments.join("/");
	return leadingSlash ? `/${joined}` : joined;
}

const HEADING_LINE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** The anchor a heading answers to: markup stripped, spaces to dashes. */
export function slugifyHeading(text: string): string {
	return text
		.replace(/`([^`]*)`/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_~]/g, "")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.replace(/\s+/g, "-");
}

/** The 1-based line of the heading matching an anchor, null when there is none. */
export function findHeadingLine(doc: string, anchor: string): number | null {
	const wanted = anchor.trim().toLowerCase().replace(/^#/, "");
	if (!wanted) return null;
	const lines = doc.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const match = HEADING_LINE.exec(lines[i]);
		if (match && slugifyHeading(match[2]) === wanted) return i + 1;
	}
	return null;
}

/** `![alt](src)` on its own; the markdown form carries no size. */
export function parseMarkdownImage(source: string): HtmlImage | null {
	const match = MARKDOWN_IMAGE.exec(source.trim());
	if (!match) return null;
	return { src: match[2], alt: match[1], width: null, height: null };
}

class BulletWidget extends WidgetType {
	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = "cm-md-bullet";
		return el;
	}

	eq(): boolean {
		return true;
	}
}

class RuleWidget extends WidgetType {
	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = "cm-md-rule";
		return el;
	}

	eq(): boolean {
		return true;
	}
}

class TaskWidget extends WidgetType {
	constructor(
		readonly checked: boolean,
		readonly from: number,
		readonly to: number,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const el = document.createElement("span");
		el.className = `cm-md-task${this.checked ? " cm-md-task-done" : ""}`;
		el.addEventListener("mousedown", (event) => {
			event.preventDefault();
			if (view.state.readOnly) return;
			view.dispatch({
				changes: {
					from: this.from,
					to: this.to,
					insert: this.checked ? "[ ]" : "[x]",
				},
			});
		});
		return el;
	}

	eq(other: TaskWidget): boolean {
		return other.checked === this.checked && other.from === this.from;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class ImageWidget extends WidgetType {
	constructor(readonly image: HtmlImage) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement("span");
		wrap.className = "cm-md-image";

		const resolved = resolveImageSrc(
			this.image.src,
			view.state.field(markdownDocPath, false) ?? null,
		);
		if (!resolved) {
			wrap.classList.add("cm-md-image-missing");
			wrap.textContent = this.image.alt || this.image.src;
			return wrap;
		}

		const img = document.createElement("img");
		img.src = resolved;
		img.alt = this.image.alt;
		if (this.image.width)
			img.style.width = `${Number.parseInt(this.image.width, 10)}px`;
		if (this.image.height)
			img.style.height = `${Number.parseInt(this.image.height, 10)}px`;
		img.addEventListener("error", () => {
			wrap.classList.add("cm-md-image-missing");
			wrap.textContent = this.image.alt || this.image.src;
		});
		wrap.appendChild(img);
		return wrap;
	}

	eq(other: ImageWidget): boolean {
		return (
			other.image.src === this.image.src &&
			other.image.alt === this.image.alt &&
			other.image.width === this.image.width &&
			other.image.height === this.image.height
		);
	}
}

class CodeFenceWidget extends WidgetType {
	constructor(readonly language: string) {
		super();
	}

	toDOM(): HTMLElement {
		const el = document.createElement("div");
		el.className = "cm-md-fence";
		if (this.language) {
			const badge = document.createElement("span");
			badge.className = "cm-md-fence-lang";
			badge.textContent = this.language;
			el.appendChild(badge);
		}
		return el;
	}

	eq(other: CodeFenceWidget): boolean {
		return other.language === this.language;
	}
}

/** A parsed GFM table; `align` is empty when it has no delimiter row. */
interface TableModel {
	rows: string[][];
	align: (string | null)[];
	hasHeader: boolean;
}

const ALIGNMENT_CELL = /^:?-{1,}:?$/;

/** Splits on unescaped pipes, dropping the optional leading and trailing one. */
function splitRow(line: string): string[] {
	const cells: string[] = [];
	let cell = "";
	let escaped = false;
	for (const char of line.trim().replace(/^\||\|$/g, "")) {
		if (escaped) {
			cell += char;
			escaped = false;
		} else if (char === "\\") {
			escaped = true;
		} else if (char === "|") {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += char;
		}
	}
	cells.push(cell.trim());
	return cells;
}

/** The colons of a delimiter cell: `:-:` centre, `-:` right, `:-` left. */
function alignmentOf(cell: string): string | null {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return "center";
	if (right) return "right";
	if (left) return "left";
	return null;
}

/** Without a delimiter row the block is still drawn, as a headerless table. */
export function parseMarkdownTable(source: string): TableModel | null {
	const lines = source.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) return null;

	const rows = lines.map(splitRow);
	const delimiterIndex = rows.findIndex(
		(cells) => cells.length > 0 && cells.every((c) => ALIGNMENT_CELL.test(c)),
	);
	if (delimiterIndex < 0) return { rows, align: [], hasHeader: false };

	const align = rows[delimiterIndex].map(alignmentOf);
	rows.splice(delimiterIndex, 1);
	return { rows, align, hasHeader: delimiterIndex === 1 };
}

const CELL_LINK = /\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

/**
 * A cell is a widget, so the inline decorations never reach it: its links have
 * to be built here or they render as their raw `[text](href)` source.
 */
export function fillTableCell(cell: HTMLElement, text: string): void {
	CELL_LINK.lastIndex = 0;
	let last = 0;
	let match = CELL_LINK.exec(text);
	if (!match) {
		cell.textContent = text;
		return;
	}
	while (match) {
		if (match.index > last) {
			cell.appendChild(document.createTextNode(text.slice(last, match.index)));
		}
		const href = decodeHtmlEntities(match[2]);
		if (parseLinkTarget(href).kind === "unsupported") {
			cell.appendChild(document.createTextNode(match[0]));
		} else {
			const link = document.createElement("span");
			link.className = "cm-md-link";
			link.setAttribute(LINK_HREF_ATTR, href);
			link.title = href;
			link.textContent = match[1];
			cell.appendChild(link);
		}
		last = match.index + match[0].length;
		match = CELL_LINK.exec(text);
	}
	if (last < text.length) {
		cell.appendChild(document.createTextNode(text.slice(last)));
	}
}

class TableWidget extends WidgetType {
	constructor(readonly source: string) {
		super();
	}

	toDOM(): HTMLElement {
		const wrap = document.createElement("div");
		wrap.className = "cm-md-table-wrap";

		const model = parseMarkdownTable(this.source);
		if (!model) {
			wrap.textContent = this.source;
			return wrap;
		}

		const table = document.createElement("table");
		table.className = "cm-md-table";

		model.rows.forEach((cells, rowIndex) => {
			const isHeader = model.hasHeader && rowIndex === 0;
			const row = document.createElement("tr");
			cells.forEach((text, cellIndex) => {
				const cell = document.createElement(isHeader ? "th" : "td");
				fillTableCell(cell, text);
				const align = model.align[cellIndex];
				if (align) cell.style.textAlign = align;
				row.appendChild(cell);
			});
			table.appendChild(row);
		});

		wrap.appendChild(table);
		return wrap;
	}

	eq(other: TableWidget): boolean {
		return other.source === this.source;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

const bulletWidget = Decoration.replace({ widget: new BulletWidget() });
const ruleWidget = Decoration.replace({ widget: new RuleWidget() });

/** The lines any selection range touches: those reveal their raw markup. */
function activeLines(state: EditorState): Set<number> {
	const lines = new Set<number>();
	for (const range of state.selection.ranges) {
		const first = state.doc.lineAt(range.from).number;
		const last = state.doc.lineAt(range.to).number;
		for (let n = first; n <= last; n++) lines.add(n);
	}
	return lines;
}

/** The level of an `ATXHeading1`..`6` node, null for any other node. */
function headingLevel(name: string): number | null {
	if (!name.startsWith("ATXHeading")) return null;
	const level = Number(name.slice("ATXHeading".length));
	return Number.isFinite(level) && level >= 1 && level <= 6 ? level : null;
}

/**
 * The inline decorations of one viewport slice. Collected into an array and
 * sorted by `Decoration.set(ranges, true)`: a RangeSetBuilder cannot be used
 * here, because tree iteration yields a parent before its children, so the
 * ranges arrive unsorted, the builder throws, and CodeMirror silently tears the
 * plugin down - which reads as the markdown rendering randomly disappearing.
 */
export function collectInlineRanges(
	state: EditorState,
	from: number,
	to: number,
): Range<Decoration>[] {
	const ranges: Range<Decoration>[] = [];
	const revealed = activeLines(state);
	const doc = state.doc;
	const isRevealed = (pos: number) => revealed.has(doc.lineAt(pos).number);

	syntaxTree(state).iterate({
		from,
		to,
		enter: (node) => {
			const level = headingLevel(node.name);
			if (level !== null) {
				ranges.push(headingLine[level - 1].range(node.from));
				return;
			}

			switch (node.name) {
				case "Table":
					return false;
				case "Blockquote":
					for (let pos = node.from; pos <= node.to; ) {
						const line = doc.lineAt(pos);
						ranges.push(quoteLine.range(line.from));
						pos = line.to + 1;
					}
					return;
				case "FencedCode": {
					const first = doc.lineAt(node.from).number;
					const last = doc.lineAt(node.to).number;
					const revealedFence = isRevealed(node.from) || isRevealed(node.to);
					for (let n = first; n <= last; n++) {
						if (!revealedFence && (n === first || n === last)) continue;
						ranges.push(codeLine.range(doc.line(n).from));
					}
					return;
				}
				case "Link": {
					const href = linkHref(doc.sliceString(node.from, node.to));
					if (href) {
						ranges.push(
							Decoration.mark({
								class: "cm-md-link",
								attributes: { [LINK_HREF_ATTR]: href, title: href },
							}).range(node.from, node.to),
						);
					}
					return;
				}
				case "Image": {
					if (isRevealed(node.from)) return false;
					const image = parseMarkdownImage(doc.sliceString(node.from, node.to));
					if (!image) return false;
					ranges.push(
						Decoration.replace({ widget: new ImageWidget(image) }).range(
							node.from,
							node.to,
						),
					);
					return false;
				}
				case "HTMLTag": {
					if (isRevealed(node.from)) return false;
					const image = parseHtmlImage(doc.sliceString(node.from, node.to));
					if (!image) return false;
					ranges.push(
						Decoration.replace({ widget: new ImageWidget(image) }).range(
							node.from,
							node.to,
						),
					);
					return false;
				}
				case "HorizontalRule":
					if (!isRevealed(node.from))
						ranges.push(ruleWidget.range(node.from, node.to));
					return;
				case "TaskMarker": {
					if (isRevealed(node.from)) return;
					const checked =
						doc.sliceString(node.from, node.to).toLowerCase() !== "[ ]";
					ranges.push(
						Decoration.replace({
							widget: new TaskWidget(checked, node.from, node.to),
						}).range(node.from, node.to),
					);
					return;
				}
				case "ListMark": {
					if (isRevealed(node.from)) return;
					const mark = doc.sliceString(node.from, node.to);
					if (mark === "-" || mark === "*" || mark === "+") {
						ranges.push(bulletWidget.range(node.from, node.to));
					}
					return;
				}
				case "CodeMark":
					// Fenced markers belong to the fence lines, handled as blocks.
					if (node.node.parent?.name !== "InlineCode") return;
					if (isRevealed(node.from)) return;
					ranges.push(hidden.range(node.from, node.to));
					return;
				case "HeaderMark":
				case "QuoteMark":
				case "EmphasisMark":
				case "StrikethroughMark":
				case "LinkMark":
				case "LinkTitle":
					if (isRevealed(node.from)) return;
					ranges.push(hidden.range(node.from, node.to));
					return;
				case "URL":
					if (isRevealed(node.from)) return;
					if (node.node.parent?.name === "Link")
						ranges.push(hidden.range(node.from, node.to));
					return;
				default:
					return;
			}
		},
	});

	return ranges;
}

/**
 * The block decorations: tables and fenced code. These replace line breaks, so
 * they must come from a StateField rather than a ViewPlugin, and are computed
 * over the whole document rather than the viewport.
 */
export function collectBlockRanges(state: EditorState): Range<Decoration>[] {
	const ranges: Range<Decoration>[] = [];
	const revealed = activeLines(state);
	const doc = state.doc;

	const isRevealedBlock = (from: number, to: number) => {
		const first = doc.lineAt(from).number;
		const last = doc.lineAt(to).number;
		for (let n = first; n <= last; n++) if (revealed.has(n)) return true;
		return false;
	};

	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name === "Table") {
				if (isRevealedBlock(node.from, node.to)) return false;
				ranges.push(
					Decoration.replace({
						widget: new TableWidget(doc.sliceString(node.from, node.to)),
						block: true,
					}).range(node.from, node.to),
				);
				return false;
			}

			if (node.name === "FencedCode") {
				if (isRevealedBlock(node.from, node.to)) return false;

				const openLine = doc.lineAt(node.from);
				const closeLine = doc.lineAt(node.to);
				const info = node.node.getChild("CodeInfo");
				const language = info ? doc.sliceString(info.from, info.to) : "";

				ranges.push(
					Decoration.replace({
						widget: new CodeFenceWidget(language),
						block: true,
					}).range(openLine.from, openLine.to),
				);

				if (
					closeLine.number > openLine.number &&
					closeLine.text.trim().startsWith("```")
				) {
					ranges.push(hidden.range(closeLine.from - 1, closeLine.to));
				}
				return false;
			}

			return node.name === "Document";
		},
	});

	return ranges;
}

const blockField = StateField.define<DecorationSet>({
	create: (state) => Decoration.set(collectBlockRanges(state), true),
	update(value, tr) {
		if (!tr.docChanged && !tr.selection) return value.map(tr.changes);
		return Decoration.set(collectBlockRanges(tr.state), true);
	},
	provide: (field) => EditorView.decorations.from(field),
});

const wysiwygPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.build(view);
			// On first mount the container may not be laid out yet, so
			// view.visibleRanges can still reflect a stale/empty viewport.
			// Force a remeasure so the real viewport rebuilds decorations
			// without waiting for a user interaction (e.g. a click).
			view.requestMeasure({
				read: () => null,
				write: () => {
					this.decorations = this.build(view);
				},
			});
		}

		build(view: EditorView): DecorationSet {
			const ranges: Range<Decoration>[] = [];
			for (const { from, to } of view.visibleRanges) {
				ranges.push(...collectInlineRanges(view.state, from, to));
			}
			return Decoration.set(ranges, true);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = this.build(update.view);
			}
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
		provide: (plugin) =>
			EditorView.atomicRanges.of(
				(view) => view.plugin(plugin)?.decorations ?? Decoration.none,
			),
	},
);

/** How the editor is told to open a link pointing at another file. */
export interface MarkdownLinkOptions {
	onOpenFile?: (path: string, anchor: string | null) => void;
}

/** Scrolls to the heading an `#anchor` names; false when it does not exist. */
function jumpToAnchor(view: EditorView, anchor: string): boolean {
	const line = findHeadingLine(view.state.doc.toString(), anchor);
	if (line === null) return false;
	const pos = view.state.doc.line(line).from;
	view.dispatch({
		selection: { anchor: pos },
		effects: EditorView.scrollIntoView(pos, { y: "start" }),
	});
	return true;
}

/**
 * Shift-click follows a link. A plain click is left as an ordinary text click,
 * so the document stays editable rather than navigating on every caret move.
 */
function buildLinkClickHandler(options: MarkdownLinkOptions) {
	return EditorView.domEventHandlers({
		mousedown: (event, view) => {
			if (!event.shiftKey) return false;
			const target = (event.target as HTMLElement | null)?.closest(
				`[${LINK_HREF_ATTR}]`,
			);
			const href = target?.getAttribute(LINK_HREF_ATTR);
			if (!href) return false;

			const parsed = parseLinkTarget(href);
			if (parsed.kind === "unsupported") return false;
			event.preventDefault();

			if (parsed.kind === "external") {
				void import("@tauri-apps/plugin-opener")
					.then((m) => m.openUrl(parsed.href))
					.catch(() => {});
				return true;
			}

			if (parsed.kind === "anchor") return jumpToAnchor(view, parsed.anchor);

			const docPath = view.state.field(markdownDocPath, false) ?? null;
			const path = resolveDocRelativePath(docPath, parsed.path);
			if (!path || !options.onOpenFile) return false;
			options.onOpenFile(path, parsed.anchor);
			return true;
		},
	});
}

const linkArmedOnShift = ViewPlugin.fromClass(
	class {
		constructor(readonly view: EditorView) {
			this.onKey = this.onKey.bind(this);
			window.addEventListener("keydown", this.onKey);
			window.addEventListener("keyup", this.onKey);
		}

		onKey(event: KeyboardEvent) {
			this.view.dom.classList.toggle("cm-md-link-armed", event.shiftKey);
		}

		destroy() {
			window.removeEventListener("keydown", this.onKey);
			window.removeEventListener("keyup", this.onKey);
			this.view.dom.classList.remove("cm-md-link-armed");
		}
	},
);

const wysiwygTheme = EditorView.theme({
	".cm-md-heading": {
		fontFamily: "var(--font-ui)",
		fontWeight: "600",
		color: "var(--fg-0)",
		lineHeight: "1.35",
	},
	".cm-md-h1": { fontSize: "1.85em" },
	".cm-md-h2": { fontSize: "1.55em" },
	".cm-md-h3": { fontSize: "1.3em" },
	".cm-md-h4": { fontSize: "1.15em" },
	".cm-md-h5": { fontSize: "1.05em" },
	".cm-md-h6": { fontSize: "1em", color: "var(--fg-2)" },
	".cm-md-quote": {
		borderLeft: "3px solid var(--stroke-1)",
		paddingLeft: "10px",
		color: "var(--fg-2)",
		fontStyle: "italic",
	},
	".cm-md-code-block": { background: "var(--bg-2)" },
	".cm-md-link": {
		color: "var(--accent)",
		textDecoration: "underline",
		textDecorationColor: "var(--accent-line, var(--stroke-2))",
		textUnderlineOffset: "2px",
	},
	".cm-md-link:hover": { textDecorationColor: "var(--accent)" },
	"&.cm-md-link-armed .cm-md-link": { cursor: "pointer" },
	".cm-md-fence": {
		display: "flex",
		justifyContent: "flex-end",
		alignItems: "center",
		minHeight: "0",
		background: "var(--bg-2)",
	},
	".cm-md-fence-lang": {
		padding: "0 8px",
		fontSize: "10px",
		letterSpacing: "0.06em",
		textTransform: "uppercase",
		color: "var(--fg-3)",
	},
	".cm-md-bullet": {
		display: "inline-block",
		width: "5px",
		height: "5px",
		marginBottom: "2px",
		borderRadius: "50%",
		verticalAlign: "middle",
		background: "var(--fg-3)",
	},
	".cm-md-task": {
		display: "inline-block",
		width: "11px",
		height: "11px",
		verticalAlign: "middle",
		border: "1px solid var(--stroke-2)",
		borderRadius: "3px",
		cursor: "pointer",
	},
	".cm-md-task-done": {
		background: "var(--fg-2)",
		borderColor: "var(--fg-2)",
	},
	".cm-md-rule": {
		display: "inline-block",
		width: "100%",
		verticalAlign: "middle",
		borderTop: "1px solid var(--stroke-1)",
	},
	".cm-md-image img": {
		display: "inline-block",
		maxWidth: "100%",
		maxHeight: "420px",
		verticalAlign: "middle",
		borderRadius: "var(--r-sm, 4px)",
	},
	".cm-md-image-missing": {
		padding: "1px 5px",
		color: "var(--fg-3)",
		fontStyle: "italic",
		border: "1px dashed var(--stroke-1)",
		borderRadius: "var(--r-sm, 4px)",
	},
	".cm-md-table-wrap": {
		padding: "4px 0",
		overflowX: "auto",
	},
	".cm-md-table": {
		borderCollapse: "collapse",
		fontFamily: "var(--font-ui)",
		fontSize: "0.95em",
	},
	".cm-md-table th, .cm-md-table td": {
		padding: "4px 10px",
		border: "1px solid var(--stroke-1)",
		textAlign: "left",
	},
	".cm-md-table th": {
		background: "var(--bg-2)",
		color: "var(--fg-0)",
		fontWeight: "600",
	},
});

/** The whole markdown layer; inline decorations stay viewport-scoped in the plugin. */
export function buildMarkdownWysiwyg(
	options: MarkdownLinkOptions = {},
): Extension {
	return [
		markdownDocPath,
		blockField,
		wysiwygPlugin,
		buildLinkClickHandler(options),
		linkArmedOnShift,
		wysiwygTheme,
	];
}
