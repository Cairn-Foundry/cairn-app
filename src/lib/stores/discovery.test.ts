// mcp, skills and native-agents are the same store three times: scan every
// registered project, report failures in an error store rather than throwing.
// They are tested together so the shared contract stays visible.

import { get, type Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { project } from "../../test/fixtures";

const listMcpServers = vi.hoisted(() => vi.fn());
const listSkills = vi.hoisted(() => vi.fn());
const listNativeAgents = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/mcp-service", () => ({ listMcpServers }));
vi.mock("$lib/services/skill-service", () => ({ listSkills }));
vi.mock("$lib/services/native-agent-service", () => ({ listNativeAgents }));

import { loadMcpServers, mcpError, mcpLoading, mcpServers } from "./mcp";
import {
	loadNativeAgents,
	nativeAgents,
	nativeAgentsError,
	nativeAgentsLoading,
} from "./native-agents";
import { projects } from "./project";
import { loadSkills, skills, skillsError, skillsLoading } from "./skills";

interface Scanner {
	name: string;
	load: () => Promise<void>;
	items: Writable<unknown[]>;
	loading: Writable<boolean>;
	error: Writable<string>;
	service: ReturnType<typeof vi.fn>;
}

const SCANNERS: Scanner[] = [
	{
		name: "mcp",
		load: loadMcpServers,
		items: mcpServers as Writable<unknown[]>,
		loading: mcpLoading,
		error: mcpError,
		service: listMcpServers,
	},
	{
		name: "skills",
		load: loadSkills,
		items: skills as Writable<unknown[]>,
		loading: skillsLoading,
		error: skillsError,
		service: listSkills,
	},
	{
		name: "native agents",
		load: loadNativeAgents,
		items: nativeAgents as Writable<unknown[]>,
		loading: nativeAgentsLoading,
		error: nativeAgentsError,
		service: listNativeAgents,
	},
];

beforeEach(() => {
	for (const scanner of SCANNERS) {
		scanner.service.mockReset();
		scanner.service.mockResolvedValue([]);
		scanner.items.set([]);
		scanner.loading.set(false);
		scanner.error.set("");
	}
	projects.set([]);
});

describe.each(SCANNERS)("$name discovery", (scanner) => {
	it("stores what the scan found", async () => {
		scanner.service.mockResolvedValue([{ id: "found" }]);
		await scanner.load();
		expect(get(scanner.items)).toEqual([{ id: "found" }]);
	});

	it("scans every registered project, by id, name and path", async () => {
		projects.set([project("a"), project("b")]);
		await scanner.load();
		expect(scanner.service).toHaveBeenCalledWith([
			{ id: "a", name: "a", path: "/repos/a" },
			{ id: "b", name: "b", path: "/repos/b" },
		]);
	});

	it("scans nothing when no project is registered", async () => {
		await scanner.load();
		expect(scanner.service).toHaveBeenCalledWith([]);
	});

	it("lowers the loading flag once the scan is done", async () => {
		await scanner.load();
		expect(get(scanner.loading)).toBe(false);
	});

	it("raises the loading flag while the scan runs", async () => {
		let duringScan = false;
		scanner.service.mockImplementation(async () => {
			duringScan = get(scanner.loading);
			return [];
		});
		await scanner.load();
		expect(duringScan).toBe(true);
	});

	it("reports a failed scan rather than throwing", async () => {
		scanner.service.mockRejectedValue(new Error("no such directory"));
		await expect(scanner.load()).resolves.toBeUndefined();
		expect(get(scanner.error)).toContain("no such directory");
	});

	it("lowers the loading flag even when the scan fails", async () => {
		scanner.service.mockRejectedValue(new Error("boom"));
		await scanner.load();
		expect(get(scanner.loading)).toBe(false);
	});

	it("keeps the previous results when a rescan fails", async () => {
		scanner.service.mockResolvedValue([{ id: "found" }]);
		await scanner.load();
		scanner.service.mockRejectedValue(new Error("boom"));
		await scanner.load();
		expect(get(scanner.items)).toEqual([{ id: "found" }]);
	});

	it("clears a previous error once a scan succeeds", async () => {
		scanner.service.mockRejectedValue(new Error("boom"));
		await scanner.load();
		scanner.service.mockResolvedValue([]);
		await scanner.load();
		expect(get(scanner.error)).toBe("");
	});

	it("replaces the results rather than appending on a rescan", async () => {
		scanner.service.mockResolvedValue([{ id: "one" }]);
		await scanner.load();
		scanner.service.mockResolvedValue([{ id: "two" }]);
		await scanner.load();
		expect(get(scanner.items)).toEqual([{ id: "two" }]);
	});
});
