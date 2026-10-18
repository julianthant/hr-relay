import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
// @vitest-environment jsdom
import { createSettingsStorageDoctorFixtures, MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { ProtectedSettingsNameSchema } from "../../../../src/models/config/protected-settings.js";
import {
SettingsSectionPrimitiveSchema,
StorageHealthSummaryWireSchema,
} from "../../../../src/models/dashboard/bootstrap.js";
import {
StorageDoctorWireSchema,
type StorageDoctorWire,
} from "../../../../src/models/dashboard/storage.js";

const { STORAGE, REPORT_BASE } = createSettingsStorageDoctorFixtures();

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SECTIONS = SettingsSectionPrimitiveSchema.array().parse([
  { id: "storage", label: "Storage checks", revision: 1 },
]);

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  vi.useRealTimers();
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
        children: createElement(SettingsPage, { onClose: () => undefined,
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
  const run = host.querySelector('.settings-heading-actions button');
  if (!(run instanceof HTMLButtonElement)) throw new Error("storage doctor action is missing");
  if (runImmediately) await act(async () => { run.click(); });
  return host;
}


const HEALTHY = StorageDoctorWireSchema.parse({...REPORT_BASE, recovery: {state: "clear"},
  spanAuthority: {state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: []}});

function doctorButton(dom: HTMLElement) {
  const button = dom.querySelector('.settings-heading-actions button');
  assert.ok(button instanceof HTMLButtonElement); return button;
}

async function openDisclosure(scope: Element, summary: string): Promise<void> {
  const button = [...scope.querySelectorAll("button")].find(candidate => candidate.textContent === summary);
  assert.ok(button instanceof HTMLButtonElement);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  await act(async () => { button.click(); });
  assert.equal(button.getAttribute("aria-expanded"), "true");
}

it("keeps idle, loading, failure, successful refresh and failed refresh distinct", async () => {
  let resolve: (report: StorageDoctorWire) => void = () => { throw new Error("request not started"); };
  let reject: (error: Error) => void = () => { throw new Error("request not started"); };
  let calls = 0;
  const dom = await mountDoctor(HEALTHY, () => { calls++; return new Promise((yes, no) => {resolve = yes; reject = no;}); }, false);
  assert.equal(calls, 0);
  assert.match(dom.textContent ?? "", /Recovery.*Not checked/su);
  assert.doesNotMatch(dom.textContent ?? "", /Read-write/u);
  await act(async () => { doctorButton(dom).click(); });
  assert.equal(doctorButton(dom).disabled, true);
  assert.match(dom.textContent ?? "", /Running checks/u);
  await act(async () => { reject(new Error("Synthetic doctor unavailable")); });
  assert.match(dom.textContent ?? "", /Storage checks could not finishTry running the checks again/u);
  assert.match(dom.textContent ?? "", /Recovery.*Not checked/su);
  assert.equal(dom.querySelector('[data-slot="skeleton"]'), null);
  assert.doesNotMatch(dom.textContent ?? "", /Synthetic doctor unavailable/u);
  const failure = [...dom.querySelectorAll('[role="alert"]')].find(candidate => candidate.textContent?.includes('Storage checks could not finish') && candidate.querySelector('button'));
  assert.ok(failure);
  await openDisclosure(failure, "Diagnostic details");
  assert.equal(dom.querySelector('[aria-label="Check error diagnostics"]')?.textContent, ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text);
  assert.doesNotMatch(dom.textContent ?? "", /Synthetic doctor unavailable/u);
  assert.equal(doctorButton(dom).disabled, false);
  await act(async () => { doctorButton(dom).click(); resolve(HEALTHY); });
  assert.match(dom.textContent ?? "", /Recovery.*Clear/su);
  await act(async () => { doctorButton(dom).click(); });
  assert.match(dom.textContent ?? "", /Recovery.*Clear/su);
  await act(async () => { reject(new Error("Synthetic refresh failed")); });
  assert.doesNotMatch(dom.textContent ?? "", /Synthetic refresh failed/u);
  const refreshFailure = [...dom.querySelectorAll('[role="alert"]')].find(candidate => candidate.textContent?.includes('Storage checks could not finish') && candidate.querySelector('button'));
  assert.ok(refreshFailure);
  await openDisclosure(refreshFailure, "Diagnostic details");
  assert.ok(dom.textContent?.includes(ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text));
  assert.doesNotMatch(dom.textContent ?? "", /Synthetic refresh failed/u);
  assert.match(dom.textContent ?? "", /Recovery.*Clear/su);
  assert.equal(calls, 3);
});

for (const phase of ["baseline", "planned", "committed", "settled"] as const) {
  it(`renders safe ${phase} upgrade history and independent present/absent credentials`, async () => {
    const report = StorageDoctorWireSchema.parse({...HEALTHY,
      authorityUpgrades: {state: "available", phases: [{phase, fromSchemaVersion: 46, toSchemaVersion: 51, recordedAt: HEALTHY.checkedAt}]},
      protectedSettings: {state: "available", entries: ProtectedSettingsNameSchema.options.map((name, index) => ({name, present: index === 0}))}});
    const dom = await mountDoctor(report);
    assert.match(dom.querySelector('[aria-label="Connections"]')?.textContent ?? "", /UCPath user ID.*Present/su);
    await openDisclosure(dom, "Update history");
    const labels = {baseline: "Starting version recorded", planned: "Update planned", committed: "Update applied", settled: "Update completed"};
    assert.ok(dom.textContent?.includes(labels[phase]));
    assert.equal(dom.querySelector('.diagnostic-storage-updates time')?.getAttribute('dateTime'), HEALTHY.checkedAt);
    assert.doesNotMatch(dom.textContent ?? "", /v46|v51|schema|committed:|settled:/iu);
    assert.match(dom.textContent ?? "", /UCPath password.*Not set/su);
  });
}

it("preserves unavailable credentials, upgrade history and counts beside corruption and interrupted recovery", async () => {
  const cause = {code: "authority-unavailable", summary: "Synthetic database cannot be inspected"};
  const report = StorageDoctorWireSchema.parse({...HEALTHY,
    authority: {state: "degraded", cause}, counts: {state: "unavailable", cause},
    authorityUpgrades: {state: "unavailable", cause}, protectedSettings: {state: "unavailable", cause},
    recovery: {state: "interrupted", findings: [{marker: "authority-restore", state: "interrupted"}]}});
  const dom = await mountDoctor(report);
  assert.match(dom.textContent ?? "", /Data store unavailable/u);
  assert.doesNotMatch(dom.textContent ?? "", /Data store available/u);
  assert.match(dom.textContent ?? "", /Stored data.*Unavailable/su);
  assert.match(dom.textContent ?? "", /Recovery.*Interrupted/su);
  assert.match(dom.textContent ?? "", /An interrupted operation needs review/u);
  assert.match(dom.textContent ?? "", /Pending actions.*Unavailable/su);
  assert.match(dom.textContent ?? "", /Storage updates.*Unavailable/su);
  assert.match(dom.textContent ?? "", /UCPath user ID.*Unavailable/su);
  assert.doesNotMatch(dom.textContent ?? "", /ucpath-password: absent|Pending actions.*0/u);
  assert.doesNotMatch(dom.textContent ?? "", /Synthetic database cannot be inspected/u);
  for (const name of ["Stored data", "Storage updates"]) {
    const row = [...dom.querySelectorAll('.diagnostic-check-entry')].find(candidate => candidate.querySelector('.ds-field-label')?.textContent === name);
    assert.ok(row);
    await openDisclosure(row, "Diagnostic details");
    assert.match(row.querySelector(`[aria-label="${name} diagnostics"]`)?.textContent ?? "", /Synthetic database cannot be inspected/u);
  }
  for (const name of ["Work in progress", "Connections"]) {
    const group = dom.querySelector(`[role="group"][aria-label="${name}"]`);
    assert.ok(group);
    await openDisclosure(group, "Diagnostic details");
    assert.match(group.querySelector(`[aria-label="${name} diagnostics"]`)?.textContent ?? "", /Synthetic database cannot be inspected/u);
  }
  assert.match(dom.querySelector('[aria-label="Stored data diagnostics"]')?.textContent ?? "", /authority-unavailable/u);

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

it("shows every useful check before running and keeps Preflight separate", async () => {
  let doctorCalls = 0;
  const dom = await mountDoctor(HEALTHY, () => {doctorCalls++; return Promise.resolve(HEALTHY);}, false);
  assert.equal(dom.querySelectorAll('.diagnostic-check-entry').length, 13);
  assert.equal([...dom.querySelectorAll('.diagnostic-check-entry')].filter((row) => row.textContent?.includes("Not checked")).length, 13);
  assert.match(dom.textContent ?? "", /Storage updates/u);
  assert.match(dom.textContent ?? "", /Work in progress/u);
  assert.doesNotMatch(dom.textContent ?? "", /Check readiness for|Rerun preflight/iu);
  assert.ok([...dom.querySelectorAll('a')].some((link) => link.textContent === "Preflight" && link.getAttribute('href') === '?settings=preflight'));
  assert.equal(doctorCalls, 0);
});

it("loads a fresh last completed report on revisit without running the doctor, while current degradation stays prominent", async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse(HEALTHY.checkedAt) + 60_000);
  let runs = 0;
  const degraded = StorageHealthSummaryWireSchema.parse({ ...STORAGE, authority: "unavailable" });
  const dom = await mountDoctor(HEALTHY, () => { runs++; return Promise.resolve(HEALTHY); }, false, HEALTHY, degraded);
  assert.equal(runs, 0);
  assert.match(dom.textContent ?? "", /Last checked/u);
  assert.match(dom.textContent ?? "", /Recovery.*Clear/su);
  assert.match(dom.textContent ?? "", /Data store unavailable/u);
  assert.doesNotMatch(dom.textContent ?? "", /Data store available/u);
});

it("keeps nonzero work counts visible without classifying normal work as a failure", async () => {
  const report = StorageDoctorWireSchema.parse({...HEALTHY, counts: {state: "available", values: {
    pendingCommands: 3, unresolvedWriteIntents: 2, leases: 4, providerReservations: 1, artifactOutbox: 5,
  }}});
  const dom = await mountDoctor(report);
  const group = dom.querySelector('[aria-label="Work in progress"]');
  assert.ok(group);
  for (const [label, count] of [["Pending actions", "3"], ["Changes awaiting confirmation", "2"], ["Assigned work", "4"], ["Provider tasks", "1"], ["Pending outputs", "5"]] as const) {
    const row: Element | undefined = [...group.querySelectorAll('.diagnostic-check-entry')].find(candidate => candidate.textContent?.includes(label));
    assert.ok(row);
    assert.equal(row.querySelector('.ds-result-row-side')?.textContent, count);
    assert.equal(row.querySelector('.ds-badge'), null);
  }
  assert.equal([...dom.querySelectorAll('button')].some(button => button.textContent === "Technical details"), false);
});
