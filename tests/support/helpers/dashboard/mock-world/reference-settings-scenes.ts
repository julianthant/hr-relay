import { expect } from "@playwright/test";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [

  { id: "settings", route: { day: FIXTURE_DAY, settings: "" } }];
export const ANCHORS: SceneAnchors = {
  "settings": async (page) => {
    // Wait for the General form control so a loading or absent-renderer state cannot become a reference.
    await expect(page.getByRole("heading", { name: "General", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Animations", exact: true })).toBeVisible();
  }};
