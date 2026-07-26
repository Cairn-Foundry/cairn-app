import {
	type EditorState,
	type Extension,
	type Range,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
} from "@codemirror/view";
import { t } from "$lib/i18n";

const START = "<<<<<<<";
const BASE = "|||||||";
const SEP = "=======";
const END = ">>>>>>>";

type Conflict = {
	startFrom: number; // char offset of the `<<<<<<<` line start
	endTo: number; // char offset of the `>>>>>>>` line end
	barAnchor: number; // char offset where the action bar is rendered
	hiddenLines: number[]; // marker/base lines to hide from view
	oursLines: [number, number]; // inclusive line numbers of the "current" body
	theirsLines: [number, number]; // inclusive line numbers of the "incoming" body
	oursText: string;
	theirsText: string;
};

function joinLines(state: EditorState, from: number, to: number): string {
	if (to < from) return "";
	const parts: string[] = [];
	for (let i = from; i <= to; i++) parts.push(state.doc.line(i).text);
	return parts.join("\n");
}

function parseConflicts(state: EditorState): Conflict[] {
	const doc = state.doc;
	const conflicts: Conflict[] = [];
	let n = 1;
	while (n <= doc.lines) {
		if (!doc.line(n).text.startsWith(START)) {
			n++;
			continue;
		}
		const startLine = n;
		let sepLine = -1;
		let baseLine = -1;
		let endLine = -1;
		for (let m = startLine + 1; m <= doc.lines; m++) {
			const text = doc.line(m).text;
			if (baseLine === -1 && sepLine === -1 && text.startsWith(BASE)) {
				baseLine = m;
			} else if (sepLine === -1 && text.startsWith(SEP)) {
				sepLine = m;
			} else if (text.startsWith(END)) {
				endLine = m;
				break;
			} else if (text.startsWith(START)) {
				break; // malformed / nested: bail on this region
			}
		}
		if (sepLine === -1 || endLine === -1) {
			n = startLine + 1;
			continue;
		}
		const oursEnd = (baseLine === -1 ? sepLine : baseLine) - 1;
		const oursLines: [number, number] = [startLine + 1, oursEnd];
		const theirsLines: [number, number] = [sepLine + 1, endLine - 1];

		const hiddenLines = [startLine];
		if (baseLine !== -1) {
			for (let i = baseLine; i <= sepLine; i++) hiddenLines.push(i);
		} else {
			hiddenLines.push(sepLine);
		}
		hiddenLines.push(endLine);

		const anchorLine =
			oursLines[0] <= oursLines[1]
				? oursLines[0]
				: theirsLines[0] <= theirsLines[1]
					? theirsLines[0]
					: startLine;

		conflicts.push({
			startFrom: doc.line(startLine).from,
			endTo: doc.line(endLine).to,
			barAnchor: doc.line(anchorLine).from,
			hiddenLines,
			oursLines,
			theirsLines,
			oursText: joinLines(state, oursLines[0], oursLines[1]),
			theirsText: joinLines(state, theirsLines[0], theirsLines[1]),
		});
		n = endLine + 1;
	}
	return conflicts;
}

function scrollEffect(pos: number) {
	return EditorView.scrollIntoView(pos, { y: "start", yMargin: 56 });
}

function resolve(view: EditorView, c: Conflict, insert: string) {
	if (view.state.readOnly) return;
	const at = c.startFrom;
	view.dispatch({
		changes: { from: c.startFrom, to: c.endTo, insert },
		userEvent: "conflict.resolve",
	});
	const remaining = parseConflicts(view.state);
	const next = remaining.find((k) => k.startFrom >= at) ?? remaining[0];
	if (next) view.dispatch({ effects: scrollEffect(next.barAnchor) });
}

function jumpTo(view: EditorView, pos: number) {
	view.dispatch({
		selection: { anchor: pos },
		effects: scrollEffect(pos),
	});
	view.focus();
}

class ConflictBarWidget extends WidgetType {
	constructor(
		private conflict: Conflict,
		private index: number,
		private anchors: number[],
	) {
		super();
	}

	eq(other: ConflictBarWidget) {
		return (
			other.conflict.startFrom === this.conflict.startFrom &&
			other.index === this.index &&
			other.anchors.length === this.anchors.length &&
			other.conflict.oursText === this.conflict.oursText &&
			other.conflict.theirsText === this.conflict.theirsText
		);
	}

	toDOM(view: EditorView) {
		const bar = document.createElement("div");
		bar.className = "cm-conflict-bar";
		const c = this.conflict;

		const addAction = (label: string, insert: string, variant: string) => {
			const btn = document.createElement("button");
			btn.className = `cm-conflict-btn ${variant}`;
			const swatch = document.createElement("span");
			swatch.className = "cm-conflict-swatch";
			btn.appendChild(swatch);
			btn.appendChild(document.createTextNode(label));
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				resolve(view, c, insert);
			});
			bar.appendChild(btn);
		};

		addAction(t("git.acceptCurrent") as string, c.oursText, "current");
		addAction(t("git.acceptIncoming") as string, c.theirsText, "incoming");
		addAction(
			t("git.acceptBoth") as string,
			c.theirsText ? `${c.oursText}\n${c.theirsText}` : c.oursText,
			"both",
		);

		if (this.anchors.length > 1) {
			const nav = document.createElement("div");
			nav.className = "cm-conflict-nav";

			const count = document.createElement("span");
			count.className = "cm-conflict-count";
			count.textContent = `${this.index + 1}/${this.anchors.length}`;

			const prev = document.createElement("button");
			prev.className = "cm-conflict-navbtn";
			prev.textContent = "↑";
			prev.title = t("git.prevConflict") as string;
			prev.addEventListener("mousedown", (e) => {
				e.preventDefault();
				const i = (this.index - 1 + this.anchors.length) % this.anchors.length;
				jumpTo(view, this.anchors[i]);
			});

			const next = document.createElement("button");
			next.className = "cm-conflict-navbtn";
			next.textContent = "↓";
			next.title = t("git.nextConflict") as string;
			next.addEventListener("mousedown", (e) => {
				e.preventDefault();
				const i = (this.index + 1) % this.anchors.length;
				jumpTo(view, this.anchors[i]);
			});

			nav.appendChild(count);
			nav.appendChild(prev);
			nav.appendChild(next);
			bar.appendChild(nav);
		}

		return bar;
	}

	ignoreEvent() {
		return false;
	}
}

function computeDecorations(state: EditorState): DecorationSet {
	const conflicts = parseConflicts(state);
	const anchors = conflicts.map((c) => c.barAnchor);
	const ranges: Range<Decoration>[] = [];

	conflicts.forEach((c, index) => {
		for (const line of c.hiddenLines) {
			ranges.push(
				Decoration.line({ class: "cm-conflict-hidden" }).range(
					state.doc.line(line).from,
				),
			);
		}
		ranges.push(
			Decoration.widget({
				widget: new ConflictBarWidget(c, index, anchors),
				block: true,
				side: -1,
			}).range(c.barAnchor),
		);
		for (let i = c.oursLines[0]; i <= c.oursLines[1]; i++) {
			ranges.push(
				Decoration.line({ class: "cm-conflict-current" }).range(
					state.doc.line(i).from,
				),
			);
		}
		for (let i = c.theirsLines[0]; i <= c.theirsLines[1]; i++) {
			ranges.push(
				Decoration.line({ class: "cm-conflict-incoming" }).range(
					state.doc.line(i).from,
				),
			);
		}
	});

	return Decoration.set(ranges, true);
}

const conflictField = StateField.define<DecorationSet>({
	create(state) {
		return computeDecorations(state);
	},
	update(value, tr) {
		return tr.docChanged ? computeDecorations(tr.state) : value;
	},
	provide: (field) => EditorView.decorations.from(field),
});

const conflictTheme = EditorView.baseTheme({
	".cm-conflict-hidden": { display: "none" },
	".cm-conflict-current": {
		backgroundColor: "color-mix(in oklch, var(--success) 12%, transparent)",
	},
	".cm-conflict-incoming": {
		backgroundColor:
			"color-mix(in oklch, var(--info, var(--accent)) 12%, transparent)",
	},
	".cm-conflict-bar": {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		padding: "4px 6px",
		fontSize: "11px",
	},
	".cm-conflict-btn": {
		display: "inline-flex",
		alignItems: "center",
		gap: "5px",
		border: "1px solid var(--stroke-0)",
		borderRadius: "5px",
		padding: "2px 8px",
		background: "var(--bg-2)",
		color: "var(--fg-1)",
		cursor: "pointer",
		font: "inherit",
	},
	".cm-conflict-btn:hover": {
		background: "var(--bg-3)",
		borderColor: "var(--fg-3)",
	},
	".cm-conflict-swatch": {
		width: "8px",
		height: "8px",
		borderRadius: "2px",
	},
	".cm-conflict-btn.current .cm-conflict-swatch": {
		background: "var(--success)",
	},
	".cm-conflict-btn.incoming .cm-conflict-swatch": {
		background: "var(--info, var(--accent))",
	},
	".cm-conflict-btn.both .cm-conflict-swatch": {
		background:
			"linear-gradient(90deg, var(--success) 50%, var(--info, var(--accent)) 50%)",
	},
	".cm-conflict-nav": {
		display: "inline-flex",
		alignItems: "center",
		gap: "4px",
		marginLeft: "auto",
		color: "var(--fg-3)",
	},
	".cm-conflict-count": { fontSize: "11px" },
	".cm-conflict-navbtn": {
		border: "1px solid var(--stroke-0)",
		borderRadius: "4px",
		padding: "0 6px",
		lineHeight: "16px",
		background: "var(--bg-2)",
		color: "var(--fg-2)",
		cursor: "pointer",
		font: "inherit",
	},
	".cm-conflict-navbtn:hover": { background: "var(--bg-3)" },
});

const scrollToFirstConflict = ViewPlugin.fromClass(
	class {
		constructor(view: EditorView) {
			const conflicts = parseConflicts(view.state);
			if (conflicts.length === 0) return;
			const pos = conflicts[0].barAnchor;
			Promise.resolve().then(() => {
				if (view.dom.isConnected) {
					view.dispatch({ effects: scrollEffect(pos) });
				}
			});
		}
	},
);

export function buildConflictResolver(): Extension {
	return [conflictField, conflictTheme, scrollToFirstConflict];
}
