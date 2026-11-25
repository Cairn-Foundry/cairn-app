// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "#lib/services/containers-service";

const createTerminal = vi.fn();
const closeTerminal = vi.fn();
vi.mock("#lib/services/terminal-service", () => ({
	createTerminal: (...a: unknown[]) => createTerminal(...a),
	closeTerminal: (...a: unknown[]) => closeTerminal(...a),
}));

let exitHandler:
	| ((exit: { id: string; exitCode: number | null }) => void)
	| null = null;
const manager = {
	create: vi.fn(),
	size: vi.fn(() => ({ cols: 80, rows: 24 })),
	attach: vi.fn(),
	detach: vi.fn(),
	dispose: vi.fn(),
	refit: vi.fn(),
	onTerminalExit: vi.fn((fn) => {
		exitHandler = fn;
		return () => {};
	}),
};
vi.mock("#lib/utils/terminal/terminal-manager", () => manager);

const { default: ContainerTerminals } = await import(
	"#lib/components/home/ContainerTerminals.svelte"
);

function container(id: string, overrides: Partial<Container> = {}): Container {
	return {
		id,
		name: `web-${id}-1`,
		image: "nginx",
		state: "running",
		health: "",
		exitCode: null,
		status: "Up",
		startedAt: "",
		finishedAt: "",
		ports: [],
		composeProject: "web",
		composeService: id,
		composeWorkingDir: "",
		...overrides,
	};
}

const tabs = () =>
	Array.from(document.querySelectorAll(".tab .tab-label")).map(
		(t) => t.textContent,
	);
const argvOf = (call: number) => createTerminal.mock.calls[call][6] as string[];

async function mount() {
	const view = render(ContainerTerminals, {});
	const api = view.component as unknown as {
		open: (c: Container, kind: "logs" | "shell") => Promise<void>;
	};
	return {
		...view,
		open: async (c: Container, kind: "logs" | "shell") => {
			await api.open(c, kind);
			await tick();
		},
	};
}

beforeEach(() => {
	createTerminal.mockReset().mockResolvedValue(undefined);
	closeTerminal.mockReset().mockResolvedValue(undefined);
	for (const fn of Object.values(manager))
		(fn as ReturnType<typeof vi.fn>).mockClear();
});

describe("ContainerTerminals", () => {
	it("stays out of the way until something is opened", async () => {
		await mount();
		expect(document.querySelector(".drawer")).toBeNull();
	});

	it("follows a container's logs through the docker CLI, in a PTY", async () => {
		const { open } = await mount();
		await open(container("api"), "logs");
		expect(argvOf(0)).toEqual([
			"docker",
			"logs",
			"--follow",
			"--tail",
			"500",
			"api",
		]);
		expect(tabs()).toEqual(["api"]);
		expect(manager.attach).toHaveBeenCalled();
	});

	it("opens a shell that prefers bash", async () => {
		const { open } = await mount();
		await open(container("db"), "shell");
		const argv = argvOf(0);
		expect(argv.slice(0, 4)).toEqual(["docker", "exec", "-it", "db"]);
		expect(argv.at(-1)).toContain("bash");
	});

	it("brings back the tab already showing a container rather than opening twice", async () => {
		const { open } = await mount();
		await open(container("api"), "logs");
		await open(container("db"), "logs");
		await open(container("api"), "logs");
		expect(createTerminal).toHaveBeenCalledTimes(2);
		expect(tabs()).toEqual(["api", "db"]);
		expect(document.querySelector(".tab.active .tab-label")?.textContent).toBe(
			"api",
		);
	});

	it("kills the PTY of a closed tab", async () => {
		const { open } = await mount();
		await open(container("api"), "logs");
		const id = createTerminal.mock.calls[0][0];
		await userEvent.click(document.querySelector(".tab-close") as HTMLElement);
		expect(closeTerminal).toHaveBeenCalledWith(id);
		expect(manager.dispose).toHaveBeenCalledWith(id);
		expect(document.querySelector(".drawer")).toBeNull();
	});

	it("keeps an ended tab readable, and opens a fresh one next time", async () => {
		const { open } = await mount();
		await open(container("api"), "logs");
		exitHandler?.({ id: createTerminal.mock.calls[0][0], exitCode: 0 });
		await tick();
		expect(document.querySelector(".tab.exited")).not.toBeNull();
		await open(container("api"), "logs");
		expect(createTerminal).toHaveBeenCalledTimes(2);
	});

	it("closes every terminal when the section goes away", async () => {
		const { open, unmount } = await mount();
		await open(container("api"), "logs");
		await open(container("db"), "shell");
		unmount();
		expect(closeTerminal).toHaveBeenCalledTimes(2);
	});

	it("says why a terminal could not start", async () => {
		createTerminal.mockRejectedValue("docker not found");
		const { open } = await mount();
		await open(container("api"), "logs");
		expect(document.querySelector("[role=alert]")?.textContent).toContain(
			"docker not found",
		);
		expect(manager.dispose).toHaveBeenCalled();
	});

	it("grows and shrinks from its top edge with the keyboard, within bounds", async () => {
		const { open } = await mount();
		await open(container("api"), "logs");
		const drawer = () => document.querySelector(".drawer") as HTMLElement;
		const handle = document.querySelector("[role=separator]") as HTMLElement;
		const before = Number.parseInt(drawer().style.height, 10);
		handle.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(Number.parseInt(drawer().style.height, 10)).toBe(before - 20);
		for (let i = 0; i < 30; i++) await userEvent.keyboard("{ArrowDown}");
		expect(Number.parseInt(drawer().style.height, 10)).toBe(140);
	});
});
