/**
 * Zoom and pan for a rendered mermaid diagram. A large graph rendered at the
 * width of the editor is unreadable, so the SVG keeps its natural size and the
 * viewport moves over it instead.
 *
 * Pointer events only: the webview starts its own native drag on an HTML5
 * dragstart and swallows the gesture.
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.15;

export interface MermaidZoom {
	reset(): void;
	destroy(): void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Makes `surface` pan and zoom its only child. The child is translated and
 * scaled around the pointer, so zooming keeps the point under the cursor in
 * place rather than drifting towards a corner.
 */
export function attachMermaidZoom(
	surface: HTMLElement,
	stage: HTMLElement,
): MermaidZoom {
	let scale = 1;
	let x = 0;
	let y = 0;
	let dragging = false;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;

	function apply(): void {
		stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
	}

	function zoomAt(factor: number, clientX: number, clientY: number): void {
		const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
		if (next === scale) return;
		const rect = surface.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const ratio = next / scale;
		x = px - (px - x) * ratio;
		y = py - (py - y) * ratio;
		scale = next;
		apply();
	}

	function onWheel(event: WheelEvent): void {
		// A plain wheel scrolls the document; zooming is the modifier gesture,
		// which is also what a trackpad pinch sends.
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		zoomAt(
			event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
			event.clientX,
			event.clientY,
		);
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		dragging = true;
		pointerId = event.pointerId;
		startX = event.clientX - x;
		startY = event.clientY - y;
		surface.setPointerCapture(event.pointerId);
		surface.classList.add("cm-md-mermaid-panning");
		event.preventDefault();
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragging || event.pointerId !== pointerId) return;
		x = event.clientX - startX;
		y = event.clientY - startY;
		apply();
	}

	function endDrag(event: PointerEvent): void {
		if (!dragging || event.pointerId !== pointerId) return;
		dragging = false;
		pointerId = null;
		surface.releasePointerCapture(event.pointerId);
		surface.classList.remove("cm-md-mermaid-panning");
	}

	function reset(): void {
		scale = 1;
		x = 0;
		y = 0;
		apply();
	}

	function onDoubleClick(event: MouseEvent): void {
		event.preventDefault();
		reset();
	}

	surface.addEventListener("wheel", onWheel, { passive: false });
	surface.addEventListener("pointerdown", onPointerDown);
	surface.addEventListener("pointermove", onPointerMove);
	surface.addEventListener("pointerup", endDrag);
	surface.addEventListener("pointercancel", endDrag);
	surface.addEventListener("dblclick", onDoubleClick);
	apply();

	return {
		reset,
		destroy(): void {
			surface.removeEventListener("wheel", onWheel);
			surface.removeEventListener("pointerdown", onPointerDown);
			surface.removeEventListener("pointermove", onPointerMove);
			surface.removeEventListener("pointerup", endDrag);
			surface.removeEventListener("pointercancel", endDrag);
			surface.removeEventListener("dblclick", onDoubleClick);
		},
	};
}

export const MERMAID_ZOOM_LIMITS = { MIN_SCALE, MAX_SCALE, ZOOM_STEP };
