/**
 * Mermaid rendering for the markdown editor. The library is heavy and most
 * documents carry no diagram, so it is imported on first use only.
 */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let renderedTheme: string | null = null;
let counter = 0;

function currentTheme(): "dark" | "default" {
	return document.documentElement.dataset.theme === "light"
		? "default"
		: "dark";
}

async function loadMermaid() {
	const theme = currentTheme();
	if (!mermaidPromise) {
		mermaidPromise = import("mermaid").then((m) => m.default);
	}
	const mermaid = await mermaidPromise;
	if (renderedTheme !== theme) {
		mermaid.initialize({
			startOnLoad: false,
			theme,
			securityLevel: "strict",
			fontFamily: "inherit",
		});
		renderedTheme = theme;
	}
	return mermaid;
}

/**
 * Renders `source` into `host`. Returns once the SVG is in place, or once the
 * error message is - a diagram that does not parse shows its reason rather
 * than an empty box.
 */
export async function renderMermaid(
	host: HTMLElement,
	source: string,
): Promise<void> {
	try {
		const mermaid = await loadMermaid();
		counter += 1;
		const { svg } = await mermaid.render(`cm-mermaid-${counter}`, source);
		host.innerHTML = svg;
		host.classList.remove("cm-md-mermaid-error");
	} catch (e) {
		host.textContent = e instanceof Error ? e.message : String(e);
		host.classList.add("cm-md-mermaid-error");
	}
}
