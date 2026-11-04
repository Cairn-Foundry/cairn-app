// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "#lib/services/custom-command-service";
import { runProjectTeardowns } from "#lib/stores/project-teardown";
import { instance, project } from "../../test/fixtures";

const allocatePort = vi.hoisted(() => vi.fn());
const getCommandState = vi.hoisted(() => vi.fn());
const saveCommandState = vi.hoisted(() => vi.fn());
const getSystemUser = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/custom-command-service", () => ({
	allocatePort,
	getCommandState,
	saveCommandState,
	getSystemUser,
}));

vi.mock("#lib/services/git-service", () => ({
	getIdentity: vi.fn().mockResolvedValue({ name: "Ada", email: "a@b.c" }),
}));

const prepareInstanceEnv = vi.hoisted(() => vi.fn());
vi.mock("./env", () => ({ prepareInstanceEnv }));

const addCommandTerminal = vi.hoisted(() => vi.fn());
const removeTerminal = vi.hoisted(() => vi.fn());
vi.mock("./terminal", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	addCommandTerminal,
	removeTerminal,
}));

const showTool = vi.hoisted(() => vi.fn());
vi.mock("./ui", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	showTool,
}));

const onTerminalExit = vi.hoisted(() => vi.fn());
vi.mock("#lib/utils/terminal/terminal-manager", () => ({ onTerminalExit }));

import {
	cancelPendingLaunch,
	commandRunKey,
	commandRuns,
	confirmPendingLaunch,
	forgetProject,
	launchCommand,
	pendingLaunch,
	requestCommandLaunch,
	stopCommand,
} from "./command-run";
import { terminalSessions } from "./terminal";

const exitHandler = onTerminalExit.mock.calls[0][0] as (exit: {
	id: string;
	exitCode: number | null;
}) => void;

const PROJECT = project("p1");
const INSTANCE = instance("i1", "p1");

/** A command that runs one plain step unless the test says otherwise. */
function command(overrides: Partial<CustomCommand> = {}): CustomCommand {
	return {
		id: "c1",
		name: "Build",
		icon: "play",
		steps: ["echo hello"],
		stopOnError: true,
		cwd: "worktree",
		pinned: true,
		autoClose: false,
		confirm: false,
		source: "manual",
		...overrides,
	};
}

const KEY = commandRunKey("p1", "i1", "c1");
const runs = () => get(commandRuns);

beforeEach(() => {
	vi.clearAllMocks();
	allocatePort.mockResolvedValue(3000);
	getCommandState.mockResolvedValue(null);
	saveCommandState.mockResolvedValue(undefined);
	getSystemUser.mockResolvedValue("tester");
	prepareInstanceEnv.mockResolvedValue({});
	addCommandTerminal.mockResolvedValue("term-1");
	removeTerminal.mockResolvedValue(undefined);
	commandRuns.set({});
	pendingLaunch.set(null);
	terminalSessions.set({});
});

describe("commandRunKey", () => {
	it("lets the same command run once per instance", () => {
		expect(commandRunKey("p", "a", "c")).not.toBe(commandRunKey("p", "b", "c"));
	});

	it("keeps two commands of one instance apart", () => {
		expect(commandRunKey("p", "i", "a")).not.toBe(commandRunKey("p", "i", "b"));
	});
});

describe("launchCommand", () => {
	it("opens a terminal for the command", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(addCommandTerminal).toHaveBeenCalledTimes(1);
		expect(addCommandTerminal.mock.calls[0][3]).toMatchObject({
			title: "Build",
			commandId: "c1",
			icon: "play",
		});
	});

	it("records the run so the badge can show it", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(runs()[KEY]).toMatchObject({
			projectId: "p1",
			instanceId: "i1",
			commandId: "c1",
			terminalId: "term-1",
		});
	});

	it("runs in the worktree by default", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(addCommandTerminal).toHaveBeenCalledWith(
			"p1",
			"i1",
			INSTANCE.worktreePath,
			expect.anything(),
			expect.any(String),
			expect.anything(),
		);
	});

	it("runs at the project root when the command asks for it", async () => {
		await launchCommand(command({ cwd: "projectRoot" }), PROJECT, INSTANCE);
		expect(addCommandTerminal).toHaveBeenCalledWith(
			"p1",
			"i1",
			PROJECT.path,
			expect.anything(),
			expect.any(String),
			expect.anything(),
		);
	});

	it("titles the terminal after the command", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		const meta = addCommandTerminal.mock.calls[0][3];
		expect(meta).toMatchObject({ title: "Build", commandId: "c1" });
	});

	it("titles and tags the terminal with the port allocated to the command", async () => {
		getCommandState.mockResolvedValue({ ports: {} });
		allocatePort.mockResolvedValue(3002);
		await launchCommand(
			command({ steps: ["vite --port {{port:3000}}"] }),
			PROJECT,
			INSTANCE,
		);
		expect(addCommandTerminal.mock.calls[0][3]).toMatchObject({
			title: "Build :3002",
			port: 3002,
		});
		expect(runs()[KEY].ports).toEqual([{ base: 3000, port: 3002 }]);
	});

	it("shows the terminal, since that is where the output goes", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(showTool).toHaveBeenCalledWith("terminal");
	});

	it("carries the instance environment into the command", async () => {
		prepareInstanceEnv.mockResolvedValue({ MY_VAR: "value" });
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(prepareInstanceEnv).toHaveBeenCalledWith(PROJECT, INSTANCE);
		expect(addCommandTerminal.mock.calls[0][5]).toMatchObject({
			MY_VAR: "value",
		});
	});

	it("stops the previous run of the same command first", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		await launchCommand(command(), PROJECT, INSTANCE);
		expect(removeTerminal).toHaveBeenCalledWith("p1", "i1", "term-1");
	});

	it("leaves another command's run alone", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		addCommandTerminal.mockResolvedValue("term-2");
		await launchCommand(command({ id: "c2" }), PROJECT, INSTANCE);
		expect(Object.keys(runs())).toHaveLength(2);
		expect(removeTerminal).not.toHaveBeenCalled();
	});

	it("opens no terminal for a command with nothing to run", async () => {
		await launchCommand(command({ steps: [] }), PROJECT, INSTANCE);
		expect(addCommandTerminal).not.toHaveBeenCalled();
		expect(runs()).toEqual({});
	});

	it("opens no terminal when every step is blank", async () => {
		await launchCommand(command({ steps: ["", "   "] }), PROJECT, INSTANCE);
		expect(addCommandTerminal).not.toHaveBeenCalled();
	});

	it("records whether the terminal closes itself when the command ends", async () => {
		await launchCommand(command({ autoClose: true }), PROJECT, INSTANCE);
		expect(runs()[KEY].autoClose).toBe(true);
	});
});

describe("requestCommandLaunch", () => {
	it("runs a plain command straight away", async () => {
		await requestCommandLaunch(command(), PROJECT, INSTANCE);
		expect(addCommandTerminal).toHaveBeenCalledWith(
			"p1",
			"i1",
			INSTANCE.worktreePath,
			expect.anything(),
			expect.any(String),
			expect.anything(),
		);
		expect(get(pendingLaunch)).toBeNull();
	});

	it("parks a command that asks for confirmation", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		expect(addCommandTerminal).not.toHaveBeenCalled();
		expect(get(pendingLaunch)).toMatchObject({ prompts: [] });
	});

	it("parks a command that declares prompts, and lists them", async () => {
		await requestCommandLaunch(
			command({ steps: ["deploy {{prompt:target}}"] }),
			PROJECT,
			INSTANCE,
		);
		expect(addCommandTerminal).not.toHaveBeenCalled();
		expect(get(pendingLaunch)?.prompts).toEqual(["target"]);
	});

	it("keeps the command, project and instance with the parked launch", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		expect(get(pendingLaunch)).toMatchObject({
			command: expect.objectContaining({ id: "c1" }),
			project: PROJECT,
			instance: INSTANCE,
		});
	});
});

describe("cancelPendingLaunch", () => {
	it("drops the parked launch without running it", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		cancelPendingLaunch();
		expect(get(pendingLaunch)).toBeNull();
		expect(addCommandTerminal).not.toHaveBeenCalled();
	});
});

describe("confirmPendingLaunch", () => {
	it("runs the launch the user confirmed", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		await confirmPendingLaunch();
		expect(addCommandTerminal).toHaveBeenCalledWith(
			"p1",
			"i1",
			INSTANCE.worktreePath,
			expect.anything(),
			expect.any(String),
			expect.anything(),
		);
		expect(runs()[KEY]).toBeDefined();
	});

	it("clears the parked launch, so it cannot run twice", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		await confirmPendingLaunch();
		expect(get(pendingLaunch)).toBeNull();
		await confirmPendingLaunch();
		expect(addCommandTerminal).toHaveBeenCalledTimes(1);
	});

	it("substitutes the answers the dialog collected", async () => {
		await requestCommandLaunch(
			command({ steps: ["deploy {{prompt:target}}"] }),
			PROJECT,
			INSTANCE,
		);
		await confirmPendingLaunch({ target: "staging" });
		expect(addCommandTerminal.mock.calls[0][4]).toContain("staging");
	});

	it("does nothing when nothing is parked", async () => {
		await confirmPendingLaunch();
		expect(addCommandTerminal).not.toHaveBeenCalled();
	});
});

describe("stopCommand", () => {
	it("closes the terminal of the run", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		await stopCommand(KEY);
		expect(removeTerminal).toHaveBeenCalledWith("p1", "i1", "term-1");
	});

	it("does nothing for a run that is not going", async () => {
		await stopCommand(KEY);
		expect(removeTerminal).not.toHaveBeenCalled();
	});
});

describe("forgetProject", () => {
	it("drops the runs of the removed project and keeps the others", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		addCommandTerminal.mockResolvedValue("term-2");
		await launchCommand(command(), project("p2"), instance("i2", "p2"));
		forgetProject("p1");
		expect(Object.keys(runs())).toEqual([commandRunKey("p2", "i2", "c1")]);
	});

	it("drops a parked launch of the removed project", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		forgetProject("p1");
		expect(get(pendingLaunch)).toBeNull();
	});

	it("keeps a parked launch of another project", async () => {
		await requestCommandLaunch(command({ confirm: true }), PROJECT, INSTANCE);
		forgetProject("p2");
		expect(get(pendingLaunch)?.project.id).toBe("p1");
	});
});

describe("when a terminal exits", () => {
	it("registers its handler with the terminal manager", () => {
		expect(exitHandler).toBeTypeOf("function");
	});

	it("drops the run of the terminal and leaves it open", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		exitHandler({ id: "term-1", exitCode: 1 });

		expect(runs()).toEqual({});
		expect(removeTerminal).not.toHaveBeenCalled();
	});

	it("keeps the terminal of a failed command that asked to close itself", async () => {
		await launchCommand(command({ autoClose: true }), PROJECT, INSTANCE);

		exitHandler({ id: "term-1", exitCode: 2 });

		expect(removeTerminal).not.toHaveBeenCalled();
		expect(runs()).toEqual({});
	});

	it("closes the terminal of a command that asked to close itself on a clean exit", async () => {
		await launchCommand(command({ autoClose: true }), PROJECT, INSTANCE);

		exitHandler({ id: "term-1", exitCode: 0 });

		expect(removeTerminal).toHaveBeenCalledWith("p1", "i1", "term-1");
	});

	it("leaves the runs alone when the terminal belongs to no command", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		exitHandler({ id: "other", exitCode: 0 });

		expect(Object.keys(runs())).toEqual([KEY]);
	});
});

describe("when the terminal sessions change", () => {
	const session = (id: string) => ({ id, title: id });

	it("drops the run whose terminal was closed by hand", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		terminalSessions.set({ "p1:i1": [session("someone-else")] });

		expect(runs()).toEqual({});
	});

	it("keeps the run whose terminal is still open", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		terminalSessions.set({ "p1:i1": [session("term-1")] });

		expect(Object.keys(runs())).toEqual([KEY]);
	});

	it("drops only the runs whose terminal is gone", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);
		addCommandTerminal.mockResolvedValue("term-2");
		await launchCommand(command({ id: "c2" }), PROJECT, INSTANCE);

		terminalSessions.set({ "p1:i1": [session("term-2")] });

		expect(Object.keys(runs())).toEqual([commandRunKey("p1", "i1", "c2")]);
	});
});

describe("allocating ports", () => {
	const portCommand = () => command({ steps: ["vite --port {{port:3000}}"] });

	it("touches neither the saved state nor the allocator for a command without ports", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		expect(getCommandState).not.toHaveBeenCalled();
		expect(allocatePort).not.toHaveBeenCalled();
		expect(saveCommandState).not.toHaveBeenCalled();
	});

	it("asks for a fresh port when the instance never had one", async () => {
		getCommandState.mockResolvedValue({ ports: {} });

		await launchCommand(portCommand(), PROJECT, INSTANCE);

		expect(allocatePort).toHaveBeenCalledWith(3000, null, []);
	});

	it("asks to keep the port the instance had last time", async () => {
		getCommandState.mockResolvedValue({ ports: { "c1:3000": 3005 } });

		await launchCommand(portCommand(), PROJECT, INSTANCE);

		expect(allocatePort).toHaveBeenCalledWith(3000, 3005, []);
	});

	it("saves the allocated port for the next run", async () => {
		getCommandState.mockResolvedValue({ ports: {} });
		allocatePort.mockResolvedValue(3002);

		await launchCommand(portCommand(), PROJECT, INSTANCE);

		expect(saveCommandState).toHaveBeenCalledWith("p1", "i1", {
			ports: { "c1:3000": 3002 },
		});
	});
});

describe("ticket variables of an instance without key or url", () => {
	it("expands them to the ticket id and to nothing", async () => {
		await launchCommand(
			command({ steps: ["echo key=[{{ticket.key}}] url=[{{ticket.url}}]"] }),
			PROJECT,
			INSTANCE,
		);

		const script = addCommandTerminal.mock.calls[0][4] as string;
		expect(script).toContain(`key=[${INSTANCE.ticket.id}]`);
		expect(script).toContain("url=['']");
	});
});

describe("project removal", () => {
	it("forgets the runs of a removed project", async () => {
		await launchCommand(command(), PROJECT, INSTANCE);

		await runProjectTeardowns("p1");

		expect(runs()).toEqual({});
	});
});
