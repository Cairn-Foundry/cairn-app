// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Container,
	ContainerStats,
	ContainersReport,
} from "#lib/services/containers-service";

const listContainers = vi.fn();
const containerAction = vi.fn();
const composeDown = vi.fn();
const containerStats = vi.fn();
vi.mock("#lib/services/containers-service", () => ({
	containerStats: (...a: unknown[]) => containerStats(...a),
	listContainers: (...a: unknown[]) => listContainers(...a),
	containerAction: (...a: unknown[]) => containerAction(...a),
	composeDown: (...a: unknown[]) => composeDown(...a),
}));
const openUrl = vi.fn();
vi.mock("#lib/services/opener-service", () => ({
	openUrl: (...a: unknown[]) => openUrl(...a),
	openPath: vi.fn(),
}));

const { default: ContainersSection } = await import(
	"#lib/components/home/ContainersSection.svelte"
);

const REFRESH_MS = 5000;

function container(
	name: string,
	overrides: Partial<Container> = {},
): Container {
	return {
		id: name,
		name,
		image: "nginx:alpine",
		state: "running",
		health: "",
		exitCode: null,
		status: "Up 2 hours",
		startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
		finishedAt: "",
		ports: [],
		composeProject: "",
		composeService: "",
		composeWorkingDir: "",
		...overrides,
	};
}

function ok(containers: Container[]): ContainersReport {
	return { status: "ok", containers, message: "" };
}

const names = () =>
	Array.from(document.querySelectorAll("tbody .name")).map(
		(n) => n.textContent,
	);
const groupTitles = () =>
	Array.from(document.querySelectorAll(".group .project")).map(
		(n) => n.textContent,
	);
const stoppedToggle = () => document.querySelector(".chip") as HTMLElement;
const empty = () => document.querySelector(".empty")?.textContent;
const unavailable = () => document.querySelector(".unavailable");

async function settle() {
	await tick();
	await tick();
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
	vi.useFakeTimers();
	user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	listContainers.mockReset().mockResolvedValue(
		ok([
			container("web-app-1", {
				composeProject: "web",
				composeService: "app",
				composeWorkingDir: "/home/me/web",
				ports: [
					{ hostIp: "*", hostPort: 8080, containerPort: 80, protocol: "tcp" },
				],
			}),
			container("web-worker-1", {
				composeProject: "web",
				composeService: "worker",
				state: "exited",
				exitCode: 137,
				status: "Exited (137) 1 hour ago",
			}),
			container("redis"),
		]),
	);
	openUrl.mockReset().mockResolvedValue(undefined);
	containerAction.mockReset().mockResolvedValue(undefined);
	composeDown.mockReset().mockResolvedValue(undefined);
	containerStats.mockReset().mockResolvedValue([]);
});

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
function sample(
	id: string,
	cpuPercent: number,
	memoryMiB: number,
): ContainerStats {
	return {
		id,
		cpuPercent,
		memoryBytes: memoryMiB * MiB,
		memoryLimitBytes: 4 * GiB,
	};
}
const cell = (name: string, col: "cpu" | "memory") =>
	rowOf(name)?.querySelector(`td.${col}`) as HTMLElement;

const rowOf = (name: string) =>
	Array.from(document.querySelectorAll<HTMLElement>("tbody tr")).find(
		(r) => r.querySelector(".name")?.textContent === name,
	) as HTMLElement;
const button = (root: ParentNode, label: string) =>
	root.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const groupHeader = (title: string) =>
	Array.from(document.querySelectorAll<HTMLElement>(".group-bar")).find(
		(h) => h.querySelector(".project")?.textContent === title,
	) as HTMLElement;

afterEach(() => {
	vi.useRealTimers();
});

describe("ContainersSection", () => {
	it("shows a placeholder while it loads, not a word", () => {
		listContainers.mockReturnValue(new Promise(() => {}));
		render(ContainersSection, {});
		expect(document.querySelector(".skeleton, .sk-line")).not.toBeNull();
		expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
	});

	it("groups the running containers by Compose project", async () => {
		render(ContainersSection, {});
		await settle();
		expect(groupTitles()).toEqual(["web", "Standalone containers"]);
		expect(names()).toEqual(["app", "redis"]);
		expect(document.body.textContent).toContain("/home/me/web");
	});

	it("shows the stopped ones on demand, with their exit code", async () => {
		render(ContainersSection, {});
		await settle();
		await user.click(stoppedToggle());
		expect(names()).toEqual(["app", "worker", "redis"]);
		expect(document.body.textContent).toContain("exit 137");
	});

	it("folds a Compose project down to its title, and unfolds it", async () => {
		render(ContainersSection, {});
		await settle();
		await user.click(button(groupHeader("web"), "Fold or unfold web"));
		expect(names()).toEqual(["redis"]);
		expect(groupTitles()).toEqual(["web", "Standalone containers"]);
		await user.click(groupHeader("web"));
		expect(names()).toEqual(["app", "redis"]);
	});

	it("says what the filter missed, and clears it", async () => {
		render(ContainersSection, {});
		await settle();
		await user.type(
			document.querySelector(".ag-search input, input") as HTMLElement,
			"nothing-like-this",
		);
		expect(document.body.textContent).toContain('"nothing-like-this"');
		await user.click(
			Array.from(document.querySelectorAll<HTMLElement>("button")).find(
				(b) => b.textContent?.trim() === "Clear search",
			) as HTMLElement,
		);
		expect(names()).toEqual(["app", "redis"]);
	});

	it("sorts by uptime from the dropdown, and reverses on picking it again", async () => {
		listContainers.mockResolvedValue(
			ok([
				container("alpha", {
					startedAt: new Date(Date.now() - 3600_000).toISOString(),
				}),
				container("beta", {
					startedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
				}),
			]),
		);
		render(ContainersSection, {});
		await settle();
		expect(names()).toEqual(["alpha", "beta"]);
		const pickSort = async (label: string) => {
			await user.click(
				document.querySelector(".sort .select-trigger") as HTMLElement,
			);
			const option = Array.from(
				document.querySelectorAll<HTMLElement>("[role=option]"),
			).find((o) => o.textContent?.trim() === label);
			await user.click(option as HTMLElement);
		};
		await pickSort("Uptime");
		expect(names()).toEqual(["beta", "alpha"]);
		await pickSort("Uptime");
		expect(names()).toEqual(["alpha", "beta"]);
		expect(document.querySelector(".direction.reversed")).not.toBeNull();
	});

	it("reverses the sort from the direction button", async () => {
		render(ContainersSection, {});
		await settle();
		expect(names()).toEqual(["app", "redis"]);
		await user.click(document.querySelector(".direction") as HTMLElement);
		expect(
			document.querySelector(".direction")?.getAttribute("aria-label"),
		).toContain("Z to A");
	});

	describe("resource usage", () => {
		beforeEach(() => {
			containerStats.mockResolvedValue([
				sample("web-app-1", 12.34, 512),
				sample("redis", 0.5, 3584),
			]);
		});

		it("shows the CPU and memory of each running container, and the totals", async () => {
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			expect(cell("app", "cpu").textContent?.trim()).toBe("12 %");
			expect(cell("app", "memory").textContent).toContain("512.0 MB");
			expect(cell("redis", "cpu").textContent?.trim()).toBe("0.5 %");
			expect(
				cell("redis", "memory").querySelector(".meter.high"),
			).not.toBeNull();
			expect(cell("app", "memory").querySelector(".meter.high")).toBeNull();
			expect(
				groupHeader("web").querySelector(".group-usage")?.textContent,
			).toContain("512.0 MB");
			expect(document.querySelector(".head-total")?.textContent).toContain(
				"4.0 GB of memory",
			);
		});

		it("leaves the cells of a stopped container empty", async () => {
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			await user.click(stoppedToggle());
			expect(cell("worker", "cpu").textContent?.trim()).toBe("");
			expect(
				cell("worker", "memory").querySelector(".spinner, svg"),
			).toBeNull();
		});

		it("spins in the cells until the first sample comes back", async () => {
			containerStats.mockReturnValue(new Promise(() => {}));
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			expect(cell("app", "memory").children.length).toBeGreaterThan(0);
			expect(cell("app", "memory").textContent?.trim()).toBe("");
		});

		it("sorts the heaviest first by memory, groups by what they use together", async () => {
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			await user.click(
				document.querySelector(".sort .select-trigger") as HTMLElement,
			);
			const option = Array.from(
				document.querySelectorAll<HTMLElement>("[role=option]"),
			).find((o) => o.textContent?.trim() === "Memory");
			await user.click(option as HTMLElement);
			expect(groupTitles()).toEqual(["web", "Standalone containers"]);
			await user.click(document.querySelector(".direction") as HTMLElement);
			expect(
				document.querySelector(".direction")?.getAttribute("aria-label"),
			).toContain("Lightest first");
		});

		it("samples again only once the last sample is back", async () => {
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			expect(containerStats).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(REFRESH_MS);
			expect(containerStats).toHaveBeenCalledTimes(2);
		});

		it("keeps the list usable when docker stats fails", async () => {
			containerStats.mockRejectedValue(new Error("boom"));
			render(ContainersSection, {});
			await vi.advanceTimersByTimeAsync(0);
			expect(names()).toEqual(["app", "redis"]);
			expect(cell("app", "cpu").textContent?.trim()).toBe("");
			expect(cell("app", "cpu").children.length).toBe(0);
		});
	});

	it("opens a published port in the browser", async () => {
		render(ContainersSection, {});
		await settle();
		await user.click(document.querySelector(".port-link") as HTMLElement);
		expect(openUrl).toHaveBeenCalledWith("http://localhost:8080");
	});

	it("says nothing runs rather than that the machine has no container", async () => {
		listContainers.mockResolvedValue(
			ok([container("old", { state: "exited" })]),
		);
		render(ContainersSection, {});
		await settle();
		const nothingRunning = empty();
		await user.click(stoppedToggle());
		expect(names()).toEqual(["old"]);
		listContainers.mockResolvedValue(ok([]));
		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		await settle();
		expect(empty()).toBeTruthy();
		expect(empty()).not.toBe(nothingRunning);
	});

	it("explains a daemon that does not answer, with the CLI's own words", async () => {
		listContainers.mockResolvedValue({
			status: "daemonDown",
			containers: [],
			message: "Cannot connect to the Docker daemon",
		});
		render(ContainersSection, {});
		await settle();
		expect(unavailable()?.textContent).toContain("Docker is not running");
		expect(unavailable()?.textContent).toContain(
			"Cannot connect to the Docker daemon",
		);
	});

	it("picks up a daemon started meanwhile on the next refresh", async () => {
		listContainers.mockResolvedValueOnce({
			status: "notInstalled",
			containers: [],
			message: "",
		});
		render(ContainersSection, {});
		await settle();
		expect(unavailable()).not.toBeNull();
		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		await settle();
		expect(unavailable()).toBeNull();
		expect(names()).toEqual(["app", "redis"]);
	});

	describe("acting on containers", () => {
		it("stops a running container and reads the list again", async () => {
			render(ContainersSection, {});
			await settle();
			const calls = listContainers.mock.calls.length;
			await user.click(button(rowOf("app"), "Stop"));
			await settle();
			expect(containerAction).toHaveBeenCalledWith(["web-app-1"], "stop");
			expect(listContainers.mock.calls.length).toBeGreaterThan(calls);
		});

		it("asks before removing a stopped container", async () => {
			render(ContainersSection, {});
			await settle();
			await user.click(stoppedToggle());
			await user.click(button(rowOf("worker"), "Remove"));
			expect(containerAction).not.toHaveBeenCalled();
			await user.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(containerAction).toHaveBeenCalledWith(["web-worker-1"], "remove");
		});

		/** The stopped toggle only hides rows: starting a project covers them too. */
		it("starts the stopped containers of a project, hidden ones included", async () => {
			render(ContainersSection, {});
			await settle();
			await user.click(
				button(groupHeader("web"), "Start the stopped containers"),
			);
			await settle();
			expect(containerAction).toHaveBeenCalledWith(["web-worker-1"], "start");
		});

		it("takes a project down only once confirmed, listing what goes", async () => {
			render(ContainersSection, {});
			await settle();
			await user.click(
				button(
					groupHeader("web"),
					"Down: stop and remove the containers and networks of this project",
				),
			);
			expect(document.querySelector(".modal")?.textContent).toContain(
				"web-worker-1",
			);
			expect(composeDown).not.toHaveBeenCalled();
			await user.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(composeDown).toHaveBeenCalledWith("web");
		});

		it("shows what Docker answered when it refuses", async () => {
			containerAction.mockRejectedValue("Error response from daemon: conflict");
			render(ContainersSection, {});
			await settle();
			await user.click(button(rowOf("redis"), "Restart"));
			await settle();
			expect(document.querySelector("[role=alert]")?.textContent).toContain(
				"conflict",
			);
		});

		it("offers no project action to standalone containers", async () => {
			render(ContainersSection, {});
			await settle();
			expect(
				groupHeader("Standalone containers").querySelector(".group-actions"),
			).toBeNull();
		});
	});
});
