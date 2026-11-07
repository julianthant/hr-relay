import { expect } from "@playwright/test";
import { FIXTURE_DAY } from "./fixture-identity.js";
import { FIXTURE_INTAKE_IDS } from "../../support/fixtures/dashboard/fixture-intake.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [

  { id: "intake-mapping", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.mapping } },

  { id: "intake-review", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.validated } },

  { id: "intake-manifest", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.manifest } },

  { id: "intake-rerun", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.rerun } }];
export const ANCHORS: SceneAnchors = {
  "intake-rerun": async (page) => {
    const rerunTab = page.getByRole("tab", { name: "Rerun diff" });
    await rerunTab.click();
    await expect(rerunTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(
      "This plan differs from the selected earlier import. The changed file, mapping, schema and membership facts are below.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("table", { name: "Changed input hashes" })).toBeVisible();
  }};
