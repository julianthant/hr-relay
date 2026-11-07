import { expect } from "@playwright/test";
import {
FIXTURE_ACTIVITY_RANGE,
FIXTURE_ACTIVITY_UNAVAILABLE_RANGE
} from "../../support/fixtures/dashboard/fixture-activity.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [

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
    const workflowFocus = page.getByRole("combobox", { name: "Show workflow in breakdown" });
    await workflowFocus.selectOption({ label: "Person Lookup" });
    await expect(workflowTable.getByText("retired-workflow")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Range-wide report totals" })).toContainText("12 runs in this period");
    await workflowFocus.selectOption("all");
    await expect(workflowTable.getByText("retired-workflow")).toBeVisible();
  },

  "activity-report-unavailable": async (page) => {
    await expect(page.getByText("Distinct people unavailable", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "People and counting evidence" }).click();
    await expect(page.getByText(/lack validated canonical identity/u)).toBeVisible();
    const workflowTable = page.getByRole("table", { name: "Activity by workflow, grouped by category" });
    await expect(workflowTable.getByRole("columnheader", { name: "Unread", exact: true })).toBeVisible();
  }};
