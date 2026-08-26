import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "$lib/services/custom-command-service";
import { instance, project } from "../../test/fixtures";

const allocatePort = vi.hoisted(() => vi.fn());
const getCommandState = vi.hoisted(() => vi.fn());
const saveCommandState = vi.hoisted(() => vi.fn());
const getSystemUser = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/custom-command-service", () => ({
	allocatePort,
	getCommandState,
	saveCommandState,
	getSystemUser,
}));

vi.mock("$lib/services/git-service", () => ({
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
vi.mock("$lib/utils/terminal/terminal-manager", () => ({ onTerminalExit }));

import {
	cancelPendingLaunch,
	commandRunKey,
	commandRuns,
	confirmPendingLaunch,
	launchCommand,
	pendingLaunch,
	requestCommandLaunch,
	stopCommand,
} from "./command-run";

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
		expect(addCommandTerminal).toHaveBeenCalled();
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
		expect(addCommandTerminal).toHaveBeenCalled();
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
		expect(addCommandTerminal).toHaveBeenCalled();
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
