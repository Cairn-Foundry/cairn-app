// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";

describe("clone from Git label", () => {
	it("reads 'Clone from Git' in english on the chooser and the mode label", () => {
		expect(en.home.projects.cloneFromRemote).toBe("Clone from Git");
		expect(en.addProject.modeLabels.clone).toBe("Clone from Git");
		expect(JSON.stringify(en)).not.toContain("Clone from remote");
	});

	it("reads 'Cloner depuis Git' in french on the chooser and the mode label", () => {
		expect(fr.home.projects.cloneFromRemote).toBe("Cloner depuis Git");
		expect(fr.addProject.modeLabels.clone).toBe("Cloner depuis Git");
		expect(JSON.stringify(fr)).not.toContain("depuis un dépôt distant");
	});
});
