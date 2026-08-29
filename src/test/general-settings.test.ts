import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliStatus } from "$lib/services/cli-service";
import type { UpdateState } from "$lib/stores/update";

const getCliStatus = vi.fn();
const installCli = vi.fn();
const uninstallCli = vi.fn();
vi.mock("$lib/services/cli-service", () => ({
	getCliStatus: (...a: unknown[]) => getCliStatus(...a),
	installCli: (...a: unknown[]) => installCli(...a),
	uninstallCli: (...a: unknown[]) => uninstallCli(...a),
}));

const IDLE: UpdateState = {
	phase: "idle",
	version: null,
	notes: null,
	downloaded: 0,
	total: null,
	error: null,
	lastCheckedAt: null,
};
const updateState = writable<UpdateState>(IDLE);
const checkForUpdates = vi.fn();
const openUpdateModal = vi.fn();
vi.mock("$lib/stores/update", () => ({
	updateState: { subscribe: updateState.subscribe },
	checkForUpdates: (...a: unknown[]) => checkForUpdates(...a),
	openUpdateModal: (...a: unknown[]) => openUpdateModal(...a),
}));

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { default: GeneralTab } = await import(
	"$lib/components/home/settings/GeneralTab.svelte"
);

function cliStatus(overrides: Partial<CliStatus> = {}): CliStatus {
	return {
		installed: false,
		path: null,
		target: null,
		upToDate: true,
		launcherAvailable: true,
		...overrides,
	};
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-row"));
const cliRow = () => rows()[0];
const updateRow = () => rows()[rows().length - 1];
const buttonIn = (row: HTMLElement) =>
	row.querySelector("button") as HTMLButtonElement | null;
const descIn = (row: HTMLElement) =>
	row.querySelector(".settings-row-desc")?.textContent?.trim();

async function settle() {
	await tick();
	await tick();
}

beforeEach(async () => {
	getCliStatus.mockReset().mockResolvedValue(cliStatus());
	installCli
		.mockReset()
		.mockResolvedValue(
			cliStatus({ installed: true, path: "/usr/local/bin/cairn" }),
		);
	uninstallCli.mockReset().mockResolvedValue(cliStatus({ installed: false }));
	checkForUpdates.mockReset();
	openUpdateModal.mockReset();
	updateState.set(IDLE);
	await settings.save({ autoCheckUpdates: true });
});

describe("GeneralTab command line tool", () => {
	it("reads the state of the tool on arrival", async () => {
		render(GeneralTab, {});
		await settle();
		expect(getCliStatus).toHaveBeenCalled();
	});

	it("offers to install it when it is not there", async () => {
		render(GeneralTab, {});
		await settle();
		expect(buttonIn(cliRow())?.disabled).toBe(false);
		await userEvent.click(buttonIn(cliRow()) as HTMLElement);
		expect(installCli).toHaveBeenCalled();
		expect(uninstallCli).not.toHaveBeenCalled();
	});

	it("offers to remove it once it is installed", async () => {
		getCliStatus.mockResolvedValue(
			cliStatus({ installed: true, path: "/usr/local/bin/cairn" }),
		);
		render(GeneralTab, {});
		await settle();
		await userEvent.click(buttonIn(cliRow()) as HTMLElement);
		expect(uninstallCli).toHaveBeenCalled();
		expect(installCli).not.toHaveBeenCalled();
	});

	it("says where an installed tool lives", async () => {
		getCliStatus.mockResolvedValue(
			cliStatus({ installed: true, path: "/usr/local/bin/cairn" }),
		);
		render(GeneralTab, {});
		await settle();
		expect(descIn(cliRow())).toContain("/usr/local/bin/cairn");
	});

	/**
	 * A platform with nowhere to put the launcher cannot install it, so the
	 * action is refused rather than failing when pressed.
	 */
	it("refuses to install where there is nowhere to put it", async () => {
		getCliStatus.mockResolvedValue(
			cliStatus({ installed: false, launcherAvailable: false }),
		);
		render(GeneralTab, {});
		await settle();
		expect(buttonIn(cliRow())?.disabled).toBe(true);
	});

	/** An already installed tool can always be removed, wherever it came from. */
	it("still allows removing one that is installed", async () => {
		getCliStatus.mockResolvedValue(
			cliStatus({ installed: true, launcherAvailable: false, path: "/x" }),
		);
		render(GeneralTab, {});
		await settle();
		expect(buttonIn(cliRow())?.disabled).toBe(false);
	});

	it("shows an animation rather than a word while it works", async () => {
		let hold: (v: CliStatus) => void = () => {};
		installCli.mockReturnValue(
			new Promise<CliStatus>((resolve) => {
				hold = resolve;
			}),
		);
		render(GeneralTab, {});
		await settle();
		await userEvent.click(buttonIn(cliRow()) as HTMLElement);
		await tick();
		expect(cliRow().querySelector(".spinner")).not.toBeNull();
		expect(buttonIn(cliRow())).toBeNull();
		hold(cliStatus({ installed: true }));
	});

	it("reports a failed install rather than leaving it silent", async () => {
		installCli.mockRejectedValue(new Error("permission denied"));
		render(GeneralTab, {});
		await settle();
		await userEvent.click(buttonIn(cliRow()) as HTMLElement);
		await settle();
		expect(descIn(cliRow())).toContain("permission denied");
	});

	it("becomes usable again after a failure", async () => {
		installCli.mockRejectedValue(new Error("nope"));
		render(GeneralTab, {});
		await settle();
		await userEvent.click(buttonIn(cliRow()) as HTMLElement);
		await settle();
		expect(buttonIn(cliRow())?.disabled).toBe(false);
	});

	/** A status that cannot be read leaves the action refused, not broken. */
	it("refuses the action when the status cannot be read", async () => {
		getCliStatus.mockRejectedValue(new Error("gone"));
		render(GeneralTab, {});
		await settle();
		expect(buttonIn(cliRow())?.disabled).toBe(true);
	});
});

describe("GeneralTab updates", () => {
	it("shows the version that is running", async () => {
		render(GeneralTab, {});
		await settle();
		expect(document.querySelector(".settings-row-value")?.textContent).toMatch(
			/^v/,
		);
	});

	it("stores the automatic check setting when toggled", async () => {
		render(GeneralTab, {});
		await settle();
		const toggle = document.querySelector(
			'input[type="checkbox"]',
		) as HTMLInputElement;
		expect(toggle.checked).toBe(true);
		await userEvent.click(toggle);
		await tick();
		let stored = true;
		settings.subscribe((s) => {
			stored = s.autoCheckUpdates;
		})();
		expect(stored).toBe(false);
	});

	it("checks for an update on request", async () => {
		render(GeneralTab, {});
		await settle();
		await userEvent.click(buttonIn(updateRow()) as HTMLElement);
		expect(checkForUpdates).toHaveBeenCalled();
	});

	it("shows an animation rather than a word while it checks", async () => {
		updateState.set({ ...IDLE, phase: "checking" });
		render(GeneralTab, {});
		await settle();
		expect(updateRow().querySelector(".spinner")).not.toBeNull();
		expect(buttonIn(updateRow())).toBeNull();
	});

	/** Once one is found, checking again is beside the point: install it. */
	it("offers to install the version it found", async () => {
		updateState.set({ ...IDLE, phase: "available", version: "2.0.0" });
		render(GeneralTab, {});
		await settle();
		const button = buttonIn(updateRow()) as HTMLElement;
		expect(button.textContent).toContain("2.0.0");
		await userEvent.click(button);
		expect(openUpdateModal).toHaveBeenCalled();
		expect(checkForUpdates).not.toHaveBeenCalled();
	});

	it("reports a failed check", async () => {
		updateState.set({ ...IDLE, phase: "error", error: "network is down" });
		render(GeneralTab, {});
		await settle();
		expect(descIn(updateRow())).toContain("network is down");
	});

	/** Having checked and found nothing is worth saying, unlike never checking. */
	it("says it is up to date once a check found nothing", async () => {
		updateState.set({ ...IDLE, phase: "idle", lastCheckedAt: 1 });
		render(GeneralTab, {});
		await settle();
		const said = descIn(updateRow());

		updateState.set({ ...IDLE, phase: "idle", lastCheckedAt: null });
		await tick();
		expect(descIn(updateRow())).not.toBe(said);
	});
});
