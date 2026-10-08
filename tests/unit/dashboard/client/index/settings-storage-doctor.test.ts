// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { SettingsPage } from "../../../../../src/dashboard/surfaces/settings/settings.js";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../../../src/models/dashboard/bootstrap.js";
import {
  StorageDoctorWireSchema,
  type StorageDoctorWire,
} from "../../../../../src/models/dashboard/storage.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-31T16:00:00.000Z",
});
const SECTIONS = SettingsSectionPrimitiveSchema.array().parse([
  { id: "storage", label: "Storage", revision: 1 },
]);

const REPORT_BASE = {
  recovery: { state: "clear" },
  protectedSettings: { state: "unavailable", cause: { code: "authority-unavailable", summary: "protected settings fixture is unavailable" } },
  mode: "read-only",
  authorityUpgrades: { state: "absent", reason: "journal-empty" },
  checkedAt: "2026-08-31T16:01:00.000Z",
  authority: {
    state: "healthy",
    schemaVersion: 27,
    authorityGeneration: 41,
    pageCount: 12,
  },
  counts: {
    state: "available",
    values: {
      pendingCommands: 0,
      unresolvedWriteIntents: 0,
      leases: 0,
      providerReservations: 0,
      artifactOutbox: 0,
    },
  },
  backup: {
    state: "missing",
    cause: { code: "backup-missing", summary: "no verified backup is present" },
  },
  restoreCandidates: [],
  service: { state: "never-run", reason: "backup service has not run" },
} as const;

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mountDoctor(report: StorageDoctorWire): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    editableSettings: () => Promise.reject(new Error("editable settings are outside this fixture")),
    latestStorageDoctor: () => Promise.resolve({ state: "never-run" }),
    storageDoctor: () => Promise.resolve(report),
  } as unknown as DashboardClient;
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(PreflightActionsProvider, { actions: {actorId: "local-operator", descriptorFingerprint: "a".repeat(64), showSettings() {}, showSessions() {}}, children: createElement(SettingsPage, { onClose: () => undefined,
        storage: STORAGE,
        sections: SECTIONS,
        workflowLabels: new Map<string, string>(),
        section: "storage",
        actorId: "local-operator",
        descriptorFingerprint: "a".repeat(64),
        preflight: [],
        onSection: () => undefined,
      }) }),
    }));
  });
  const run = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Run storage checks");
  if (!(run instanceof HTMLButtonElement)) throw new Error("storage doctor action is missing");
  await act(async () => { run.click(); });
  return host;
}

async function expandChecks(dom: HTMLElement): Promise<void> {
  for (const row of dom.querySelectorAll(".diagnostic-check-entry")) {
    const button = row.querySelector("button");
    if (button === null) continue;
    assert.ok(button instanceof HTMLButtonElement);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    await act(async () => { button.click(); });
    assert.equal(button.getAttribute("aria-expanded"), "true");
  }
}

function assertRunHistoryAbsent(dom: HTMLElement): void {
  assert.equal(dom.querySelectorAll(".diagnostic-check-entry").length, 13);
  assert.equal(dom.querySelector('[aria-label="Storage health checks"] [role="list"]')?.children.length, 3);
  assert.doesNotMatch(dom.textContent ?? "", /Run history|run record issues|stream runs|Current runs|Archived|Deleted|span_stream|record-digest|00000000|possible external write/iu);
}

describe("loaded Settings storage doctor", () => {
  it("keeps health card rows and readable summaries without internal schema metadata", async () => {
    const report = StorageDoctorWireSchema.parse({ ...REPORT_BASE,
      spanAuthority: { state: "reconciled", streamRunCount: 2, liveRunCount: 2, archived: [], deleted: [] } });
    const dom = await mountDoctor(report);
    const row = [...dom.querySelectorAll(".diagnostic-check-entry")].find(candidate => candidate.textContent?.includes("Stored data"));
    assert.ok(row);
    assert.equal(row.querySelector('.ds-result-row-side')?.textContent, "Passed");
    assert.equal(row.querySelector('.ds-badge'), null);
    assert.match(row.querySelector('.ds-result-row-copy')?.textContent ?? "", /Stored data is readable/u);
    assert.equal(row.querySelector("button"), null);
    await expandChecks(dom);
    assert.match(row.textContent ?? "", /Stored data is readable/u);
    assert.doesNotMatch(dom.textContent ?? "", /Schema v27|generation 41|12 pages/u);
    assert.match(dom.textContent ?? "", /Work in progress.*Pending actions.*Connections.*UCPath password/u);
    assertRunHistoryAbsent(dom);
  });

  it.each(["missing", "restore-loss"] as const)("omits run history with %s recovery evidence", async (state) => {
    const report = StorageDoctorWireSchema.parse({ ...REPORT_BASE,
      spanAuthority: { state: "degraded", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [],
        problems: [{ state, runId: "00000000-0000-4000-8000-000000000301", possibleExternalWrite: true }] } });
    const dom = await mountDoctor(report);
    assertRunHistoryAbsent(dom);
    await expandChecks(dom);
    assertRunHistoryAbsent(dom);
    assert.match(dom.textContent ?? "", /Stored data.*Passed.*Recovery.*Clear/su);
  });

  it("omits run history and its raw identifiers across every degraded diagnosis", async () => {
    const report = StorageDoctorWireSchema.parse({ ...REPORT_BASE,
      spanAuthority: { state: "degraded", streamRunCount: 11, liveRunCount: 7,
        archived: [{ runId: "00000000-0000-4000-8000-000000000101", archivedAt: "2026-08-31T15:00:00.000Z" }], deleted: [],
        problems: [
          { state: "missing", runId: "00000000-0000-4000-8000-000000000102" },
          { state: "missing-span", runId: "00000000-0000-4000-8000-000000000103" },
          { state: "malformed-authority", source: "archived", recordKey: "record-digest-8dc3", summary: "archived authority record failed strict parsing" },
          { state: "malformed", runId: "00000000-0000-4000-8000-000000000104", table: "span_stream", summary: "queued root ordering is contradictory" },
        ] },
    });
    const dom = await mountDoctor(report);
    await expandChecks(dom);
    assertRunHistoryAbsent(dom);
    assert.doesNotMatch(dom.textContent ?? "", /strict parsing|queued root ordering/u);
  });

  it("omits reconciled run accounting and archives from storage checks", async () => {
    const report = StorageDoctorWireSchema.parse({ ...REPORT_BASE,
      spanAuthority: { state: "reconciled", streamRunCount: 4, liveRunCount: 2,
        archived: [
          { runId: "00000000-0000-4000-8000-000000000201", archivedAt: "2026-08-31T14:00:00.000Z" },
          { runId: "00000000-0000-4000-8000-000000000202", archivedAt: "2026-08-30T14:00:00.000Z" },
        ], deleted: [] },
    });
    const dom = await mountDoctor(report);
    await expandChecks(dom);
    assertRunHistoryAbsent(dom);
    assert.match(dom.textContent ?? "", /No unfinished storage operations/u);
  });

  it("omits unavailable run-history evidence without hiding independent storage results", async () => {
    const report = StorageDoctorWireSchema.parse({ ...REPORT_BASE,
      spanAuthority: { state: "unavailable", cause: { code: "span-stream-invalid", summary: "span corpus directory spans is not a regular no-follow directory" } },
    });
    const dom = await mountDoctor(report);
    await expandChecks(dom);
    assertRunHistoryAbsent(dom);
    assert.doesNotMatch(dom.textContent ?? "", /span-stream-invalid|no-follow directory/u);
    assert.match(dom.textContent ?? "", /Stored data.*Passed.*Recovery.*Clear.*Storage updates.*No history/su);
  });
});
