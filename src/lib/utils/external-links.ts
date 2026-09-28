// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { openUrl } from "$lib/services/opener-service";

const EXTERNAL_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * Hands a link meant to leave the app to the system browser: a `target="_blank"`
 * anchor, or any anchor clicked with Ctrl or Shift. Takes over what the opener
 * plugin used to inject, so the browser starts through `open_external`.
 */
export function interceptExternalLinks(target: Window = window): () => void {
	const onClick = (e: MouseEvent) => {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey) return;
		const anchor = e
			.composedPath()
			.find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
		if (!anchor?.href) return;
		if (anchor.target !== "_blank" && !e.ctrlKey && !e.shiftKey) return;
		let url: URL;
		try {
			url = new URL(anchor.href);
		} catch {
			return;
		}
		if (!EXTERNAL_SCHEMES.includes(url.protocol)) return;
		e.preventDefault();
		void openUrl(url.href).catch(() => {});
	};
	target.addEventListener("click", onClick);
	return () => target.removeEventListener("click", onClick);
}
