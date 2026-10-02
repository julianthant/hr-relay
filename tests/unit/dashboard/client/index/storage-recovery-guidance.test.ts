// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/state/preflight-actions.js";
import { SettingsPage } from "../../../../../src/dashboard/surfaces/settings.js";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../../../src/models/dashboard/bootstrap.js";
import {
  StorageDoctorWireSchema,
  type StorageDoctorWire,
} from "../../../../../src/models/dashboard/storage.js";
import { ProtectedSettingsNameSchema } from "../../../../../src/models/config/protected-settings.js";

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
  { id: "storage", label: "Storage checks", revision: 1 },
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

async function mountDoctor(report: StorageDoctorWire, fetchReport: () => Promise<StorageDoctorWire> = () => Promise.resolve(report), runImmediately = true, lastReport?: StorageDoctorWire, storage = STORAGE): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    editableSettings: () => Promise.reject(new Error("editable settings are outside this fixture")),
    latestStorageDoctor: () => Promise.resolve(lastReport === undefined ? { state: "never-run" } : { state: "completed", report: lastReport }),
    storageDoctor: fetchReport,
  } as unknown as DashboardClient;
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(PreflightActionsProvider, {
        actions: { actorId: "local-operator", descriptorFingerprint: "a".repeat(64), showSettings: () => undefined, showSessions: () => undefined },
        children: createElement(SettingsPage, {
        storage,
        sections: SECTIONS,
        workflowLabels: new Map<string, string>(),
        section: "storage",
        actorId: "local-operator",
        descriptorFingerprint: "a".repeat(64),
        preflight: [],
        onSection: () => undefined,
      })}),
    }));
  });
  const run = host.querySelector('[aria-label="Run the read-only storage doctor"]');
  if (!(run instanceof HTMLButtonElement)) throw new Error("storage doctor action is missing");
  if (runImmediately) await act(async () => { run.click(); });
  return host;
}


const HEALTHY = StorageDoctorWireSchema.parse({...REPORT_BASE, recovery: {state: "clear"},
  spanAuthority: {state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: []}});

function doctorButton(dom: HTMLElement) {
  const button = dom.querySelector('[aria-label="Run the read-only storage doctor"]');
  assert.ok(button instanceof HTMLButtonElement); return button;
}

it("keeps idle, loading, failure, successful refresh and failed refresh distinct", async () => {
  let resolve: (report: StorageDoctorWire) => void = () => { throw new Error("request not started"); };
  let reject: (error: Error) => void = () => { throw new Error("request not started"); };
  let calls = 0;
  const dom = await mountDoctor(HEALTHY, () => { calls++; return new Promise((yes, no) => {resolve = yes; reject = no;}); }, false);
  assert.equal(calls, 0);
  assert.match(dom.textContent ?? "", /Interrupted operation.*Not checked/su);
  assert.doesNotMatch(dom.textContent ?? "", /Read-write/u);
  await act(async () => { doctorButton(dom).click(); });
  assert.equal(doctorButton(dom).disabled, true);
  assert.match(dom.textContent ?? "", /Running checks/u);
  await act(async () => { reject(new Error("Synthetic doctor unavailable")); });
  assert.match(dom.textContent ?? "", /Storage checks could not finishSynthetic doctor unavailable/u);
  assert.equal(doctorButton(dom).disabled, false);
  await act(async () => { doctorButton(dom).click(); resolve(HEALTHY); });
  assert.match(dom.textContent ?? "", /No interruption markers/u);
  await act(async () => { doctorButton(dom).click(); });
  assert.match(dom.textContent ?? "", /No interruption markers/u);
  await act(async () => { reject(new Error("Synthetic refresh failed")); });
  assert.match(dom.textContent ?? "", /Synthetic refresh failed/u);
  assert.match(dom.textContent ?? "", /No interruption markers/u);
  assert.equal(calls, 3);
});

for (const phase of ["baseline", "planned", "committed", "settled"] as const) {
  it(`renders safe ${phase} upgrade history and independent present/absent credentials`, async () => {
    const report = StorageDoctorWireSchema.parse({...HEALTHY,
      authorityUpgrades: {state: "available", phases: [{phase, fromSchemaVersion: 46, toSchemaVersion: 51, recordedAt: HEALTHY.checkedAt}]},
      protectedSettings: {state: "available", entries: ProtectedSettingsNameSchema.options.map((name, index) => ({name, present: index === 0}))}});
    const dom = await mountDoctor(report);
    assert.match(dom.querySelector('[aria-label="Data store and recovery"]')?.textContent ?? "", new RegExp(`${phase}: v46 → v51`, "u"));
    assert.match(dom.querySelector('[aria-label="Independent credentials"]')?.textContent ?? "", /UCPath user ID.*Present/su);
    assert.match(dom.textContent ?? "", /UCPath password.*Not set/su);
  });
}

it("preserves unavailable credentials, upgrade history and counts beside corruption and interrupted recovery", async () => {
  const cause = {code: "authority-unavailable", summary: "Synthetic database cannot be inspected"};
  const report = StorageDoctorWireSchema.parse({...HEALTHY,
    authority: {state: "degraded", cause}, counts: {state: "unavailable", cause},
    authorityUpgrades: {state: "unavailable", cause}, protectedSettings: {state: "unavailable", cause},
    recovery: {state: "interrupted", findings: [{marker: "lifecycle-restore", state: "interrupted"}]}});
  const dom = await mountDoctor(report);
  assert.match(dom.textContent ?? "", /Interrupted operation.*Interrupted/su);
  assert.match(dom.textContent ?? "", /An interrupted operation needs review/u);
  assert.match(dom.textContent ?? "", /Pending commands.*Unavailable/su);
  assert.match(dom.textContent ?? "", /Upgrade record.*Unavailable/su);
  assert.match(dom.textContent ?? "", /UCPath user ID.*Unavailable/su);
  assert.doesNotMatch(dom.textContent ?? "", /ucpath-password: absent|0 pending commands/u);
});

for (const state of ["current", "stale", "missing", "invalid"] as const) it(`omits ${state} backup data from storage checks`, async () => {
  const candidate = {state: "verified-compatible", selection: "single-database", schemaVersion: 51,
    restoreEligibility: {state: "unavailable", reason: "Live custody inspection unavailable"},
    manifestFileName: "exact.sqlite.manifest.json", backupFileName: "exact.sqlite", createdAt: HEALTHY.checkedAt,
    authorityGeneration: 17, ageMs: 3600000, generationGap: {state: "unavailable", reason: "Live generation unavailable"}};
  const backup = state === "current" || state === "stale" ? {state, latest: candidate, ...(state === "stale" ? {cause: {code: "backup-stale", summary: "Synthetic stale backup"}} : {})}
    : {state, cause: {code: `backup-${state}`, summary: `Synthetic ${state} backup`}};
  const dom = await mountDoctor(StorageDoctorWireSchema.parse({...HEALTHY, backup, restoreCandidates: [candidate]}));
  assert.doesNotMatch(dom.textContent ?? "", /backup|restore|generation gap|manifest/iu);
});

it("shows every check before running and keeps Preflight on a separate destination", async () => {
  let doctorCalls = 0;
  const dom = await mountDoctor(HEALTHY, () => {doctorCalls++; return Promise.resolve(HEALTHY);}, false);
  assert.equal(dom.querySelectorAll('.diagnostic-check-entry').length, 14);
  assert.equal([...dom.querySelectorAll('.diagnostic-check-entry')].filter((row) => row.textContent?.includes("Not checked")).length, 14);
  assert.match(dom.textContent ?? "", /Data store and recovery/u);
  assert.match(dom.textContent ?? "", /Work in progress/u);
  assert.doesNotMatch(dom.textContent ?? "", /Check readiness for|Rerun preflight/iu);
  assert.ok([...dom.querySelectorAll('a')].some((link) => link.textContent === "Preflight" && link.getAttribute('href') === '?settings=preflight'));
  assert.equal(doctorCalls, 0);
});

it("loads the last completed report on revisit without running the doctor, while current degradation stays prominent", async () => {
  let runs = 0;
  const degraded = StorageHealthSummaryWireSchema.parse({ ...STORAGE, authority: "unavailable" });
  const dom = await mountDoctor(HEALTHY, () => { runs++; return Promise.resolve(HEALTHY); }, false, HEALTHY, degraded);
  assert.equal(runs, 0);
  assert.match(dom.textContent ?? "", /Last checked/u);
  assert.match(dom.textContent ?? "", /No interruption markers/u);
  assert.match(dom.textContent ?? "", /Data store unavailable/u);
  assert.doesNotMatch(dom.textContent ?? "", /Data store available/u);
});
