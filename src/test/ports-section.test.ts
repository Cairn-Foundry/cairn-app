// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningPort } from "$lib/services/ports-service";

const listListeningPorts = vi.fn();
const killProcess = vi.fn();
vi.mock("$lib/services/ports-service", () => ({
	listListeningPorts: (...a: unknown[]) => listListeningPorts(...a),
	killProcess: (...a: unknown[]) => killProcess(...a),
}));

const { default: PortsSection } = await import(
	"$lib/components/home/PortsSection.svelte"
);

const REFRESH_MS = 5000;

function port(
	pid: number,
	overrides: Partial<ListeningPort> = {},
): ListeningPort {
	return {
		id: String(pid),
		pid,
		port: 3000 + pid,
		address: "127.0.0.1",
		family: "IPv4",
		process: "node",
		command: "/usr/local/bin/node server.js",
		user: "benjamin",
		isOwned: true,
		...overrides,
	} as ListeningPort;
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>("tbody tr"));
const ports = () => rows().map((r) => r.querySelector(".port")?.textContent);
const commandIn = (row: HTMLElement) => row.querySelector(".cmd")?.textContent;
const killIn = (row: HTMLElement) =>
	row.querySelector(".icon-btn.danger") as HTMLElement | null;
const lockIn = (row: HTMLElement) => row.querySelector(".foreign");
const search = () => document.querySelector("input") as HTMLInputElement;
const modal = () => document.querySelector(".modal");
const errorText = () => document.querySelector(".error")?.textContent;
const empty = () => document.querySelector(".empty")?.textContent;

async function settle() {
	await tick();
	await tick();
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
	vi.useFakeTimers();
	user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	listListeningPorts.mockReset().mockResolvedValue([port(1), port(2)]);
	killProcess.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("PortsSection", () => {
	describe("the list", () => {
		it("shows a placeholder while it loads, not a word", () => {
			listListeningPorts.mockReturnValue(new Promise(() => {}));
			render(PortsSection, {});
			expect(document.querySelector(".skeleton, .sk-line")).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("lists the ports being listened on", async () => {
			render(PortsSection, {});
			await settle();
			expect(ports()).toEqual(["3001", "3002"]);
		});

		it("says so when nothing is listening", async () => {
			listListeningPorts.mockResolvedValue([]);
			render(PortsSection, {});
			await settle();
			expect(rows()).toHaveLength(0);
			expect(empty()).toBeTruthy();
		});

		it("reports a failed read", async () => {
			listListeningPorts.mockRejectedValue(new Error("lsof missing"));
			render(PortsSection, {});
			await settle();
			expect(errorText()).toContain("lsof missing");
		});

		/**
		 * The absolute path of the binary repeats the process name and pushes the
		 * arguments - what tells one `node` from another - out of view.
		 */
		it("shortens the paths in a command to their basenames", async () => {
			listListeningPorts.mockResolvedValue([
				port(1, {
					process: "node",
					command: "/usr/local/bin/node /srv/app/server.js --port 3001",
				}),
			]);
			render(PortsSection, {});
			await settle();
			expect(commandIn(rows()[0])).toBe("node server.js --port 3001");
		});

		/** A command that says no more than the process name is not worth showing. */
		it("shows no command when it only repeats the process name", async () => {
			listListeningPorts.mockResolvedValue([
				port(1, { process: "node", command: "/usr/local/bin/node" }),
			]);
			render(PortsSection, {});
			await settle();
			expect(commandIn(rows()[0])).toBeUndefined();
		});

		it("shows a dash for a process with no name", async () => {
			listListeningPorts.mockResolvedValue([
				port(1, { process: "", command: "" }),
			]);
			render(PortsSection, {});
			await settle();
			expect(rows()[0].querySelector(".name")?.textContent).toBe("-");
		});
	});

	describe("searching", () => {
		beforeEach(() => {
			listListeningPorts.mockResolvedValue([
				port(1, { port: 3000, process: "node", command: "node api.js" }),
				port(2, { port: 8080, process: "python", command: "python app.py" }),
			]);
		});

		it("matches on the port number", async () => {
			render(PortsSection, {});
			await settle();
			await user.type(search(), "8080");
			expect(ports()).toEqual(["8080"]);
		});

		it("matches on the process name", async () => {
			render(PortsSection, {});
			await settle();
			await user.type(search(), "python");
			expect(ports()).toEqual(["8080"]);
		});

		it("matches on the command", async () => {
			render(PortsSection, {});
			await settle();
			await user.type(search(), "api.js");
			expect(ports()).toEqual(["3000"]);
		});

		it("matches on the pid", async () => {
			render(PortsSection, {});
			await settle();
			await user.type(search(), "2");
			expect(ports()).toEqual(["8080"]);
		});

		/** No match is not an empty machine, and says so differently. */
		it("distinguishes no match from nothing listening", async () => {
			render(PortsSection, {});
			await settle();
			const nothingListening = empty();
			await user.type(search(), "zzz");
			expect(rows()).toHaveLength(0);
			expect(empty()).not.toBe(nothingListening);
		});
	});

	describe("stopping a process", () => {
		/** The list keeps moving under the pointer, so a kill is always confirmed. */
		it("asks before stopping anything", async () => {
			render(PortsSection, {});
			await settle();
			await user.click(killIn(rows()[0]) as HTMLElement);
			expect(killProcess).not.toHaveBeenCalled();
			expect(modal()).not.toBeNull();
		});

		it("stops the process that was confirmed", async () => {
			render(PortsSection, {});
			await settle();
			await user.click(killIn(rows()[0]) as HTMLElement);
			const buttons = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			);
			await user.click(buttons[buttons.length - 1]);
			expect(killProcess).toHaveBeenCalledWith(1, false);
		});

		it("forces the stop when the forced option is chosen", async () => {
			render(PortsSection, {});
			await settle();
			await user.click(killIn(rows()[0]) as HTMLElement);
			const buttons = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			);
			await user.click(buttons[0]);
			expect(killProcess).toHaveBeenCalledWith(1, true);
		});

		it("stops nothing when the confirmation is refused", async () => {
			render(PortsSection, {});
			await settle();
			await user.click(killIn(rows()[0]) as HTMLElement);
			const cancel = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			).find((b) => /cancel|annuler/i.test(b.textContent ?? ""));
			await user.click(cancel as HTMLElement);
			expect(killProcess).not.toHaveBeenCalled();
			expect(modal()).toBeNull();
		});

		/**
		 * A process the app does not own cannot be stopped by it, so no action is
		 * offered - a locked mark stands in its place.
		 */
		it("offers no way to stop a process it does not own", async () => {
			listListeningPorts.mockResolvedValue([
				port(1, { isOwned: false }),
				port(2, { isOwned: true }),
			]);
			render(PortsSection, {});
			await settle();
			expect(killIn(rows()[0])).toBeNull();
			expect(lockIn(rows()[0])).not.toBeNull();
			expect(killIn(rows()[1])).not.toBeNull();
		});

		it("reports a failed stop", async () => {
			killProcess.mockRejectedValue(new Error("no such process"));
			render(PortsSection, {});
			await settle();
			await user.click(killIn(rows()[0]) as HTMLElement);
			const buttons = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			);
			await user.click(buttons[buttons.length - 1]);
			await settle();
			expect(errorText()).toContain("no such process");
		});

		it("names the stop action for a screen reader", async () => {
			render(PortsSection, {});
			await settle();
			expect(killIn(rows()[0])?.getAttribute("aria-label")).toBeTruthy();
		});
	});

	/**
	 * `confirmKill` guards against a missing target, but the modal that calls it
	 * only exists while one is set, so that branch has no reachable path and this
	 * suite cannot pin it down.
	 */
	describe("keeping the list current", () => {
		/** The list goes stale on its own, so it is re-read on a timer. */
		it("re-reads the ports on its own", async () => {
			render(PortsSection, {});
			await settle();
			expect(listListeningPorts).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(REFRESH_MS);
			expect(listListeningPorts).toHaveBeenCalledTimes(2);
		});

		it("re-reads on request too", async () => {
			render(PortsSection, {});
			await settle();
			const refresh = document.querySelector(
				".toolbar .icon-btn",
			) as HTMLElement;
			await user.click(refresh);
			expect(listListeningPorts).toHaveBeenCalledTimes(2);
		});

		/** The timer must not outlive the section. */
		it("stops re-reading once it is gone", async () => {
			const { unmount } = render(PortsSection, {});
			await settle();
			unmount();
			const before = listListeningPorts.mock.calls.length;
			await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
			expect(listListeningPorts).toHaveBeenCalledTimes(before);
		});
	});
});
