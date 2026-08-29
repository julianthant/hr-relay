// @vitest-environment jsdom
/**
 * DCR1 at the rendered Activity seam: the served people and warning-evidence
 * axes must remain visible as different facts. The fixture goes through the
 * real strict wire before JSX sees it, so this test cannot render a state the
 * endpoint refuses.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../src/domain/dashboard/activity.js";
import { ActivityBody } from "../../../src/dashboard/surfaces/activity.js";

function report(): ActivityReportWire {
  return ActivityReportWireSchema.parse({
    wireVersion: 1,
    from: "2026-08-01",
    to: "2026-08-07",
    generatedAt: "2026-08-07T12:00:00.000Z",
    totalRuns: 2,
    terminalRuns: 2,
    inFlightRuns: 0,
    people: { state: "present", distinct: 3, evidenceRows: 3 },
    completion: { readBack: 1, warnings: 0, warningsUnknown: 1 },
    days: [{ day: "2026-08-03", runs: 2 }],
    workflows: [{
      workflowId: "person-lookup",
      registration: {
        state: "registered",
        code: "pl",
        label: "Person lookup",
        categoryId: "lookup",
      },
      runs: 2,
      completion: { readBack: 1, warnings: 0, warningsUnknown: 1 },
      failed: 0,
      cancelled: 0,
      partial: 0,
      open: 0,
    }],
    categories: [{ category: { state: "registered", categoryId: "lookup" }, runs: 2 }],
    statuses: [{ status: "done", runs: 2, sample: [] }],
    outcomes: [{ outcome: "done", runs: 2 }],
    failures: [],
    durations: {
      measuredRuns: 2,
      unmeasuredRuns: 0,
      medianMs: { state: "present", value: 12_000 },
      longestMs: {
        state: "present",
        value: 30_000,
        runId: "22222222-2222-4222-8222-222222222222",
      },
      totalMs: 42_000,
    },
    ledger: { systems: [] },
  });
}

function rendered(value: ActivityReportWire): HTMLElement {
  const host = document.createElement("main");
  host.innerHTML = renderToStaticMarkup(createElement(ActivityBody, { report: value, rows: [] }));
  return host;
}

describe("the rendered Activity axes (DCR1)", () => {
  it("shows distinct people while retaining Unread as its own workflow column", () => {
    const host = rendered(report());
    const text = host.textContent ?? "";
    assert.match(text, /3 distinct people touched/u);

    const table = host.querySelector('table[aria-label="Activity by workflow, grouped by category"]');
    assert.ok(table instanceof HTMLTableElement);
    assert.deepEqual(
      [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim()),
      ["Workflow", "Runs", "Share", "Read back", "Warnings", "Unread", "Failed", "Open"],
    );
    const workflowRow = [...table.querySelectorAll("tbody tr")]
      .find((row) => row.textContent?.includes("Person lookup"));
    assert.ok(workflowRow instanceof HTMLTableRowElement);
    assert.deepEqual(
      [...workflowRow.querySelectorAll("td")].map((cell) => cell.textContent?.trim()),
      ["plPerson lookup", "2", "100%", "1", "0", "1", "0", "0"],
    );
  });

  it("names unavailable people evidence instead of painting it as zero", () => {
    const value = ActivityReportWireSchema.parse({
      ...report(),
      people: {
        state: "absent",
        evidenceRows: 1,
        unavailableRows: 1,
        reason: "one person-bearing row has no declared stable redacted identity digest",
      },
    });
    const text = rendered(value).textContent ?? "";
    assert.match(text, /Distinct people unavailable/u);
    assert.doesNotMatch(text, /0 distinct people touched/u);
  });

  it("keeps a measured zero distinct from the unavailable arm", () => {
    const value = ActivityReportWireSchema.parse({
      ...report(),
      people: { state: "present", distinct: 0, evidenceRows: 0 },
    });
    const text = rendered(value).textContent ?? "";
    assert.match(text, /0 distinct people touched/u);
    assert.doesNotMatch(text, /Distinct people unavailable/u);
  });
});
