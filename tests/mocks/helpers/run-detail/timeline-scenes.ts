import { expect } from "@playwright/test";
import { FIXTURE_DAY } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import type { ReferenceScene } from "../reference-scenes.js";

export const TIMELINE_SCENES: Readonly<Record<"run-done" | "run-group" | "run-member", ReferenceScene>> = Object.freeze({
  "run-done": { id: "run-done", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.doneRun } },
  "run-group": { id: "run-group", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.groupOf13 } },
  "run-member": { id: "run-member", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.memberRun } },
});

export const TIMELINE_ANCHORS = {
  "run-group": async (page: import("@playwright/test").Page) => {
    await expect(
      page.getByRole("button", { name: "UCPath termination — done, took 2m 48s, a step in it ran 2 times" }),
    ).toBeVisible();
  },
};
