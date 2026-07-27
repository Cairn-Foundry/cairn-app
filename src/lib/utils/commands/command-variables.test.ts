import { describe, expect, it } from "vitest";
import {
	buildEnv,
	buildScript,
	buildValues,
	type CommandContext,
	collectPortBases,
	collectPrompts,
	findInvalidPortTokens,
	type Resolution,
	shellQuote,
	slugify,
	substitute,
} from "./command-variables";

const ctx: CommandContext = {
	instance: {
		id: "inst-1",
		branch: "feat/ma super branche",
		worktreePath: "/tmp/wt",
		ticketId: "CAI-12",
		ticketTitle: "Custom commands",
		baseBranch: "main",
	},
	project: { id: "proj-1", name: "Cairn", path: "/repo/cairn" },
	user: { name: "Ada", email: "ada@example.com", login: "ada" },
	now: new Date(2026, 6, 26, 9, 5, 3),
};

const resolution = (over: Partial<Resolution> = {}): Resolution => ({
	values: buildValues(ctx),
	prompts: {},
	ports: [],
	...over,
});

describe("shellQuote", () => {
	it("leaves safe values untouched", () => {
		expect(shellQuote("npm")).toBe("npm");
		expect(shellQuote("feat/branch-1")).toBe("feat/branch-1");
	});

	it("quotes values holding a space", () => {
		expect(shellQuote("ma branche")).toBe("'ma branche'");
	});

	it("escapes embedded single quotes", () => {
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});

	it("quotes the empty value", () => {
		expect(shellQuote("")).toBe("''");
	});
});

describe("slugify", () => {
	it("keeps a branch usable as a container or database name", () => {
		expect(slugify("feat/Ma Super Branche")).toBe("feat-ma-super-branche");
	});

	it("falls back when nothing survives", () => {
		expect(slugify("///")).toBe("instance");
	});
});

describe("buildValues", () => {
	it("exposes the instance, project, user and date catalog", () => {
		const values = buildValues(ctx);
		expect(values["instance.id"]).toBe("inst-1");
		expect(values["instance.slug"]).toBe("feat-ma-super-branche");
		expect(values["project.name"]).toBe("Cairn");
		expect(values["user.email"]).toBe("ada@example.com");
		expect(values.date).toBe("2026-07-26");
		expect(values.time).toBe("09-05-03");
	});
});

describe("collectPrompts", () => {
	it("returns labels in order, without duplicates", () => {
		expect(
			collectPrompts([
				"echo {{prompt:Port}}",
				"echo {{prompt:Tag}} {{prompt:Port}}",
			]),
		).toEqual(["Port", "Tag"]);
	});

	it("ignores an empty label", () => {
		expect(collectPrompts(["echo {{prompt:}}"])).toEqual([]);
	});
});

describe("collectPortBases", () => {
	it("ignores a port token with no base", () => {
		expect(collectPortBases(["vite --port {{port}}"])).toEqual([]);
	});

	it("keeps distinct bases in order", () => {
		expect(
			collectPortBases([
				"front {{port:3000}}",
				"api {{port:8080}} {{port:3000}}",
			]),
		).toEqual([3000, 8080]);
	});

	it("ignores an out of range port", () => {
		expect(collectPortBases(["x {{port:70000}}"])).toEqual([]);
	});

	it("takes any base the user writes", () => {
		expect(collectPortBases(["api {{port:8000}}", "db {{port:5432}}"])).toEqual(
			[8000, 5432],
		);
	});
});

describe("findInvalidPortTokens", () => {
	it("reports a port token with no base", () => {
		expect(findInvalidPortTokens(["vite --port {{port}}"])).toEqual(["port"]);
	});

	it("reports a port token whose base is not a usable port", () => {
		expect(
			findInvalidPortTokens([
				"a {{port:}}",
				"b {{port:abc}}",
				"c {{port:70000}}",
			]),
		).toEqual(["port:", "port:abc", "port:70000"]);
	});

	it("says nothing about a valid token", () => {
		expect(findInvalidPortTokens(["api {{port:8000}}"])).toEqual([]);
	});
});

describe("substitute", () => {
	it("quotes catalog values headed for the shell", () => {
		expect(substitute("git switch {{instance.branch}}", resolution())).toBe(
			"git switch 'feat/ma super branche'",
		);
	});

	it("substitutes a resolved port without quoting it", () => {
		expect(
			substitute(
				"vite --port {{port:3000}}",
				resolution({ ports: [{ base: 3000, port: 3002 }] }),
			),
		).toBe("vite --port 3002");
	});

	it("substitutes a prompt answer", () => {
		expect(
			substitute(
				"deploy {{prompt:Tag}}",
				resolution({ prompts: { Tag: "v1 rc" } }),
			),
		).toBe("deploy 'v1 rc'");
	});

	it("leaves an unknown token as written", () => {
		expect(substitute("echo {{nope.here}}", resolution())).toBe(
			"echo {{nope.here}}",
		);
	});

	it("leaves an unresolved port token as written", () => {
		expect(substitute("echo {{port:3000}}", resolution())).toBe(
			"echo {{port:3000}}",
		);
	});
});

describe("buildScript", () => {
	it("chains steps with && when stopping on error", () => {
		expect(buildScript(["npm i", "npm run dev"], true, resolution())).toBe(
			"npm i && npm run dev",
		);
	});

	it("chains steps with ; when errors are tolerated", () => {
		expect(buildScript(["npm i", "npm run dev"], false, resolution())).toBe(
			"npm i; npm run dev",
		);
	});

	it("drops blank steps", () => {
		expect(buildScript(["npm i", "   ", ""], true, resolution())).toBe("npm i");
	});

	it("substitutes inside every step", () => {
		expect(
			buildScript(
				["cd {{instance.worktree}}", "echo {{project.name}}"],
				true,
				resolution(),
			),
		).toBe("cd /tmp/wt && echo Cairn");
	});
});

describe("buildEnv", () => {
	it("exports the whole catalog under CAIRN_ names", () => {
		const env = buildEnv(resolution());
		expect(env.CAIRN_INSTANCE_ID).toBe("inst-1");
		expect(env.CAIRN_BRANCH).toBe("feat/ma super branche");
		expect(env.CAIRN_PROJECT_PATH).toBe("/repo/cairn");
	});

	it("exports the first allocated port as CAIRN_PORT", () => {
		const env = buildEnv(
			resolution({
				ports: [
					{ base: 8080, port: 8081 },
					{ base: 3000, port: 3000 },
				],
			}),
		);
		expect(env.CAIRN_PORT).toBe("8081");
	});

	it("omits CAIRN_PORT when the command asks for no port", () => {
		expect(buildEnv(resolution()).CAIRN_PORT).toBeUndefined();
	});
});
