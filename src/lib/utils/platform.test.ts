import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The flags are computed once at import, so each case re-imports the module
// with navigator already staged.
async function loadWith(agent: string, platform?: string) {
	vi.resetModules();
	vi.stubGlobal("navigator", {
		userAgent: agent,
		...(platform === undefined ? {} : { userAgentData: { platform } }),
	});
	return import("./platform");
}

const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("IS_MAC", () => {
	it("reads a mac off the user agent string, which WebKit always has", async () => {
		const { IS_MAC } = await loadWith(MAC_UA);
		expect(IS_MAC).toBe(true);
	});

	it("reads a mac off userAgentData when the engine offers it", async () => {
		const { IS_MAC } = await loadWith(LINUX_UA, "macOS");
		expect(IS_MAC).toBe(true);
	});

	it("stays false on windows and linux", async () => {
		expect((await loadWith(WINDOWS_UA)).IS_MAC).toBe(false);
		expect((await loadWith(LINUX_UA)).IS_MAC).toBe(false);
	});
});

describe("IS_WINDOWS", () => {
	it("reads windows off the user agent string", async () => {
		const { IS_WINDOWS } = await loadWith(WINDOWS_UA);
		expect(IS_WINDOWS).toBe(true);
	});

	it("reads windows off userAgentData when the engine offers it", async () => {
		const { IS_WINDOWS } = await loadWith(LINUX_UA, "Windows");
		expect(IS_WINDOWS).toBe(true);
	});

	it("stays false on mac and linux", async () => {
		expect((await loadWith(MAC_UA)).IS_WINDOWS).toBe(false);
		expect((await loadWith(LINUX_UA)).IS_WINDOWS).toBe(false);
	});

	it("never reads both platforms as true at once", async () => {
		for (const agent of [MAC_UA, WINDOWS_UA, LINUX_UA]) {
			const { IS_MAC, IS_WINDOWS } = await loadWith(agent);
			expect(IS_MAC && IS_WINDOWS, agent).toBe(false);
		}
	});
});

describe("MOD_LABEL", () => {
	it("prints the command glyph on a mac", async () => {
		const { MOD_LABEL } = await loadWith(MAC_UA);
		expect(MOD_LABEL).toBe("⌘");
	});

	it("prints Ctrl everywhere else", async () => {
		expect((await loadWith(WINDOWS_UA)).MOD_LABEL).toBe("Ctrl");
		expect((await loadWith(LINUX_UA)).MOD_LABEL).toBe("Ctrl");
	});
});
