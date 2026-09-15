// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import {
  StorageDoctorWireSchema,
  type StorageDoctorWire,
} from "../../../src/domain/dashboard/storage.js";
import { ProtectedSettingsNameSchema } from "../../../src/domain/config/protected-settings.js";
import { DEFAULT_CATALOG_VIEW } from "../../../src/dashboard/surfaces/row-catalog-model.js";

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

async function mountDoctor(report: StorageDoctorWire, fetchReport: () => Promise<StorageDoctorWire> = () => Promise.resolve(report), runImmediately = true): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    editableSettings: () => Promise.reject(new Error("editable settings are outside this fixture")),
    storageDoctor: fetchReport,
  } as unknown as DashboardClient;
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(SettingsPage, {
        // D295: the catalog is a Settings section now. No render here opens it,
        // so these carry the section's defaults rather than a fixture nothing reads.
        catalogQuery: "",
        catalogView: DEFAULT_CATALOG_VIEW,
        onCatalogQuery: () => undefined,
        onCatalogView: () => undefined,
        storage: STORAGE,
        sections: SECTIONS,
        workflowLabels: new Map<string, string>(),
        section: "storage",
        actorId: "local-operator",
        descriptorFingerprint: "a".repeat(64),
        preflight: [],
        onSection: () => undefined,
        onClose: () => undefined,
      }),
    }));
  });
  const run = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Run storage doctor");
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
  assert.equal(dom.querySelector('[aria-label="Recovery status"]'), null);
  assert.doesNotMatch(dom.textContent ?? "", /Read-write/u);
  await act(async () => { doctorButton(dom).click(); });
  assert.equal(doctorButton(dom).disabled, true);
  assert.match(dom.textContent ?? "", /Running doctor/u);
  await act(async () => { reject(new Error("Synthetic doctor unavailable")); });
  assert.match(dom.querySelector('[role="alert"]')?.textContent ?? "", /Synthetic doctor unavailable/u);
  assert.equal(doctorButton(dom).disabled, false);
  await act(async () => { doctorButton(dom).click(); resolve(HEALTHY); });
  assert.match(dom.textContent ?? "", /No interruption markers/u);
  await act(async () => { doctorButton(dom).click(); });
  assert.equal(dom.querySelector('[aria-label="Recovery status"]'), null);
  await act(async () => { reject(new Error("Synthetic refresh failed")); });
  assert.match(dom.textContent ?? "", /Synthetic refresh failed/u);
  assert.doesNotMatch(dom.textContent ?? "", /No interruption markers/u);
  assert.equal(calls, 3);
});

for (const phase of ["baseline", "planned", "committed", "settled"] as const) {
  it(`renders safe ${phase} upgrade history and independent present/absent credentials`, async () => {
    const report = StorageDoctorWireSchema.parse({...HEALTHY,
      authorityUpgrades: {state: "available", phases: [{phase, fromSchemaVersion: 46, toSchemaVersion: 51, recordedAt: HEALTHY.checkedAt}]},
      protectedSettings: {state: "available", entries: ProtectedSettingsNameSchema.options.map((name, index) => ({name, present: index === 0}))}});
    const dom = await mountDoctor(report);
    assert.match(dom.querySelector('[aria-label="Authority upgrade history"]')?.textContent ?? "", new RegExp(`${phase}: v46 → v51`, "u"));
    assert.match(dom.querySelector('[aria-label="Independent credentials"]')?.textContent ?? "", new RegExp(`${ProtectedSettingsNameSchema.options[0]}: present`, "u"));
    assert.match(dom.textContent ?? "", new RegExp(`${ProtectedSettingsNameSchema.options[1]}: absent`, "u"));
  });
}

it("preserves unavailable credentials, upgrade history and counts beside corruption and interrupted recovery", async () => {
  const cause = {code: "authority-unavailable", summary: "Synthetic database cannot be inspected"};
  const report = StorageDoctorWireSchema.parse({...HEALTHY,
    authority: {state: "degraded", cause}, counts: {state: "unavailable", cause},
    authorityUpgrades: {state: "unavailable", cause}, protectedSettings: {state: "unavailable", cause},
    recovery: {state: "interrupted", findings: [{marker: "lifecycle-restore", state: "interrupted"}]}});
  const dom = await mountDoctor(report);
  assert.match(dom.textContent ?? "", /Interrupted recovery/u);
  assert.match(dom.textContent ?? "", /Runtime startup remains blocked/u);
  assert.match(dom.textContent ?? "", /Pending counts unavailable/u);
  assert.match(dom.textContent ?? "", /Upgrade history unavailable/u);
  assert.match(dom.textContent ?? "", /Credential inspection unavailable/u);
  assert.doesNotMatch(dom.textContent ?? "", /ucpath-password: absent|0 pending commands/u);
});

for (const state of ["current", "stale", "missing", "invalid"] as const) it(`renders ${state} backup facts without inventing generation or restore eligibility`, async () => {
  const candidate = {state: "verified-compatible", selection: "single-database", schemaVersion: 51,
    restoreEligibility: {state: "unavailable", reason: "Live custody inspection unavailable"},
    manifestFileName: "exact.sqlite.manifest.json", backupFileName: "exact.sqlite", createdAt: HEALTHY.checkedAt,
    authorityGeneration: 17, ageMs: 3600000, generationGap: {state: "unavailable", reason: "Live generation unavailable"}};
  const backup = state === "current" || state === "stale" ? {state, latest: candidate, ...(state === "stale" ? {cause: {code: "backup-stale", summary: "Synthetic stale backup"}} : {})}
    : {state, cause: {code: `backup-${state}`, summary: `Synthetic ${state} backup`}};
  const dom = await mountDoctor(StorageDoctorWireSchema.parse({...HEALTHY, backup, restoreCandidates: [candidate]}));
  assert.match(dom.textContent ?? "", /restore unavailable/u);
  assert.doesNotMatch(dom.textContent ?? "", /generation gap 0|Read-write|cadence allows/u);
  if (state === "current" || state === "stale") assert.match(dom.textContent ?? "", /generation gap unknown/u);
});

it("opens reachable instructions for every existing CLI recovery action without requesting a mutation", async () => {
  let doctorCalls = 0;
  const dom = await mountDoctor(HEALTHY, () => {doctorCalls++; return Promise.resolve(HEALTHY);}, false);
  const button = dom.querySelector('[aria-label="Storage recovery instructions"]');
  assert.ok(button instanceof HTMLButtonElement);
  await act(async () => { button.click(); });
  const panel = document.querySelector('[role="dialog"][aria-label="Storage recovery instructions"]');
  assert.ok(panel);
  const commands = [...panel.querySelectorAll("code")].map(node => node.textContent);
  assert.deepEqual(commands, ["npm run cli -- storage doctor --json", "npm run cli -- storage backup --json",
    "npm run cli -- storage upgrade --plan --json", "npm run cli -- storage upgrade --json",
    "npm run cli -- storage restore --from <exact-manifest-path> --json"]);
  const text = panel.textContent ?? "";
  for (const phrase of ["all workers", ".lifecycle.json", "independent credentials stay unchanged", "original compatible release",
    "preserve the markers", "generic retry is not safe", "UNKNOWN submit", "re-admit a run lost", "deferred"]) assert.ok(text.includes(phrase), phrase);
  assert.equal(doctorCalls, 0);
  assert.equal(panel.querySelectorAll("button").length, 1, "only the close control is interactive");
});
