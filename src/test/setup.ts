import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
	openPath: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: vi.fn(),
	readText: vi.fn(),
}));
