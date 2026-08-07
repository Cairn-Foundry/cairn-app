import { describe, expect, it } from "vitest";
import {
	LANGUAGE_SERVERS,
	languageIdForPath,
	matchesServerQuery,
	serverForPath,
	shortVersion,
	summarizeExtensions,
} from "./servers";

describe("serverForPath", () => {
	it("finds the server covering an extension", () => {
		expect(serverForPath("src/main.rs")?.id).toBe("rust");
		expect(serverForPath("/abs/path/app.tsx")?.id).toBe("typescript");
		expect(serverForPath("Component.svelte")?.id).toBe("svelte");
	});

	it("ignores case in the extension", () => {
		expect(serverForPath("README.YML")?.id).toBe("yaml");
	});

	it("returns null when nothing covers the file", () => {
		expect(serverForPath("notes.md")).toBeNull();
		expect(serverForPath("Makefile")).toBeNull();
		expect(serverForPath(".gitignore")).toBeNull();
	});

	it("does not treat a dotfile prefix as an extension", () => {
		expect(serverForPath("/home/me/.zshrc")).toBeNull();
	});
});

describe("languageIdForPath", () => {
	it("separates the react flavours from the plain ones", () => {
		expect(languageIdForPath("a.ts")).toBe("typescript");
		expect(languageIdForPath("a.tsx")).toBe("typescriptreact");
		expect(languageIdForPath("a.js")).toBe("javascript");
		expect(languageIdForPath("a.jsx")).toBe("javascriptreact");
	});

	it("returns null for an uncovered file", () => {
		expect(languageIdForPath("a.md")).toBeNull();
		expect(languageIdForPath("Makefile")).toBeNull();
	});
});

describe("shortVersion", () => {
	it("pulls the number out of what a server prints", () => {
		expect(shortVersion("rust-analyzer 1.78.0 (a1b2c3 2026-01-01)")).toBe(
			"1.78.0",
		);
		expect(shortVersion("4.3.3")).toBe("4.3.3");
		expect(shortVersion("pyright 1.1.403")).toBe("1.1.403");
		expect(shortVersion("v2.11")).toBe("2.11");
		expect(shortVersion("1.0.0-beta.2")).toBe("1.0.0-beta.2");
	});

	it("gives up rather than showing noise", () => {
		expect(shortVersion("unknown")).toBeNull();
		expect(shortVersion("")).toBeNull();
		expect(shortVersion(null)).toBeNull();
	});
});

describe("summarizeExtensions", () => {
	it("keeps the list short and counts the rest", () => {
		expect(summarizeExtensions([".ts", ".tsx", ".js", ".jsx", ".mjs"])).toEqual(
			{
				shown: [".ts", ".tsx", ".js", ".jsx"],
				rest: 1,
			},
		);
	});

	it("counts nothing when everything fits", () => {
		expect(summarizeExtensions([".rs"])).toEqual({ shown: [".rs"], rest: 0 });
	});
});

describe("matchesServerQuery", () => {
	const byId = (id: string) => {
		const found = LANGUAGE_SERVERS.find((s) => s.id === id);
		if (!found) throw new Error(`no ${id} in the catalogue`);
		return found;
	};
	const typescript = byId("typescript");
	const python = byId("python");
	const css = byId("css");

	it("shows everything when nothing is typed", () => {
		for (const server of LANGUAGE_SERVERS) {
			expect(matchesServerQuery(server, "")).toBe(true);
			expect(matchesServerQuery(server, "   ")).toBe(true);
		}
	});

	it("searches the name, whatever the case", () => {
		expect(matchesServerQuery(typescript, "TypeScript")).toBe(true);
		expect(matchesServerQuery(typescript, "javascript")).toBe(true);
		expect(matchesServerQuery(python, "pyright")).toBe(true);
	});

	it("searches the extensions, with or without the dot", () => {
		expect(matchesServerQuery(python, ".py")).toBe(true);
		expect(matchesServerQuery(python, "py")).toBe(true);
		expect(matchesServerQuery(typescript, "tsx")).toBe(true);
		expect(matchesServerQuery(css, ".scss")).toBe(true);
	});

	it("answers the name a user reaches for instead of the server's", () => {
		expect(matchesServerQuery(typescript, "react")).toBe(true);
		expect(matchesServerQuery(css, "sass")).toBe(true);
		expect(matchesServerQuery(python, "django")).toBe(true);
	});

	it("does not match a server it has nothing to do with", () => {
		expect(matchesServerQuery(python, "react")).toBe(false);
		expect(matchesServerQuery(css, ".rs")).toBe(false);
		expect(matchesServerQuery(typescript, "cobol")).toBe(false);
	});

	it("finds exactly one server for a plain extension", () => {
		const found = LANGUAGE_SERVERS.filter((s) => matchesServerQuery(s, ".rs"));
		expect(found.map((s) => s.id)).toEqual(["rust"]);
	});
});

describe("catalogue", () => {
	it("has unique ids", () => {
		const ids = LANGUAGE_SERVERS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("never claims the same extension twice", () => {
		const extensions = LANGUAGE_SERVERS.flatMap((s) => s.extensions);
		expect(new Set(extensions).size).toBe(extensions.length);
	});

	it("gives every covered extension a language id", () => {
		for (const server of LANGUAGE_SERVERS) {
			for (const extension of server.extensions) {
				expect(languageIdForPath(`file${extension}`)).not.toBeNull();
			}
		}
	});
});
