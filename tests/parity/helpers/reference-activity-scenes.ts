import { expect } from "@playwright/test";
import {
FIXTURE_ACTIVITY_RANGE,
FIXTURE_ACTIVITY_UNAVAILABLE_RANGE
} from "./fixture-archive.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  /*
    The Activity report (2i-G, D180) over a fixed range, including the
    unregistered-workflow row and the unmeasured-duration warning — the two
    places the report has to be honest rather than tidy.
  */
  {
    id: "activity-report",
    route: { day: FIXTURE_DAY, activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}` },
  },

  {
    id: "activity-report-unavailable",
    route: {
      day: FIXTURE_DAY,
      activity: `${FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from}..${FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to}`,
    },
  }];
export const ANCHORS: SceneAnchors = {
  "activity-report": async (page) => {
    await expect(page.getByText("8 distinct people touched", { exact: true })).toBeVisible();
    const workflowTable = page.getByRole("table", { name: "Activity by workflow, grouped by category" });
    await expect(workflowTable.getByRole("columnheader", { name: "Unread", exact: true })).toBeVisible();
  },

  "activity-report-unavailable": async (page) => {
    await expect(page.getByText("Distinct people unavailable", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "How runs is counted" }).click();
    await expect(page.getByText(/lack validated canonical identity/u)).toBeVisible();
    const workflowTable = page.getByRole("table", { name: "Activity by workflow, grouped by category" });
    await expect(workflowTable.getByRole("columnheader", { name: "Unread", exact: true })).toBeVisible();
  }};
