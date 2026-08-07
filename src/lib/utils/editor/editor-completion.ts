import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Two things stand between the completion menu and the mouse wheel.
 *
 * The wheel event reaches the editor scroller rather than the list, so the
 * document scrolls under the menu while the list stays where it is; handling it
 * in the capture phase keeps the gesture on the list it started over.
 *
 * And CodeMirror rebuilds the list whenever the options change - which the
 * language server does on its own schedule, moments after the gesture ends -
 * scrolling the selected option back into view and throwing the reading
 * position away. The offset the user scrolled to is therefore remembered and
 * reapplied after every rebuild, until the document changes and the list means
 * something else.
 */
const completionWheel = ViewPlugin.fromClass(
	class {
		private onWheel: (event: WheelEvent) => void;
		private offset: number | null = null;

		constructor(private view: EditorView) {
			this.onWheel = (event) => {
				const list = listOf(event.target);
				if (!list) return;
				list.scrollTop += event.deltaY;
				this.offset = list.scrollTop;
				event.preventDefault();
				event.stopPropagation();
			};
			view.dom.addEventListener("wheel", this.onWheel, {
				capture: true,
				passive: false,
			});
		}

		update(update: ViewUpdate) {
			if (update.docChanged) this.offset = null;
			if (this.offset === null) return;
			this.view.requestMeasure({
				read: () => null,
				write: () => {
					const list = completionList(this.view);
					if (!list) {
						this.offset = null;
						return;
					}
					if (this.offset !== null) list.scrollTop = this.offset;
				},
			});
		}

		destroy() {
			this.view.dom.removeEventListener("wheel", this.onWheel, true);
		}
	},
);

function completionList(view: EditorView): HTMLElement | null {
	return view.dom.querySelector(".cm-tooltip-autocomplete > ul");
}

function listOf(target: EventTarget | null): HTMLElement | null {
	const list = (target as Element | null)?.closest?.(
		"ul",
	) as HTMLElement | null;
	return list?.parentElement?.classList.contains("cm-tooltip-autocomplete")
		? list
		: null;
}

export function buildCompletion(): Extension {
	return [
		autocompletion({ activateOnTyping: true, closeOnBlur: false }),
		completionWheel,
	];
}
