// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...a: unknown[]) => invoke(...a),
}));

const isPermissionGranted = vi.fn<() => Promise<boolean>>();
const requestPermission = vi.fn<() => Promise<string>>();
vi.mock("@tauri-apps/plugin-notification", () => ({
	isPermissionGranted: () => isPermissionGranted(),
	requestPermission: () => requestPermission(),
}));

async function freshService() {
	vi.resetModules();
	return import("./notification-service");
}

beforeEach(() => {
	invoke.mockReset().mockResolvedValue(undefined);
	isPermissionGranted.mockReset();
	requestPermission.mockReset();
});

describe("notifyConversation", () => {
	it("sends through notify_agent once the permission is granted", async () => {
		isPermissionGranted.mockResolvedValue(true);
		const { notifyConversation } = await freshService();
		await notifyConversation("c1", "Title", "Body");
		expect(invoke).toHaveBeenCalledWith("notify_agent", {
			conversationId: "c1",
			title: "Title",
			body: "Body",
		});
		expect(requestPermission).not.toHaveBeenCalled();
	});

	it("sends nothing, and asks only once, after a refusal", async () => {
		isPermissionGranted.mockResolvedValue(false);
		requestPermission.mockResolvedValue("denied");
		const { notifyConversation } = await freshService();
		await notifyConversation("c1", "Title", "Body");
		await notifyConversation("c2", "Title", "Body");
		expect(requestPermission).toHaveBeenCalledTimes(1);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("asks for the permission when it is not granted yet", async () => {
		isPermissionGranted.mockResolvedValue(false);
		requestPermission.mockResolvedValue("granted");
		const { notifyConversation } = await freshService();
		await notifyConversation("c1", "Title", "Body");
		expect(requestPermission).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledTimes(1);
	});
});
