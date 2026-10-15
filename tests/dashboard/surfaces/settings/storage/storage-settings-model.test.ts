// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useStorageDoctor } from "../../../../../src/dashboard/surfaces/settings/storage/storage-settings-model.js";
import { StorageDoctorWireSchema, type StorageDoctorLatestWire } from "../../../../../src/models/dashboard/storage.js";
import { createSettingsStorageDoctorFixtures } from "../../../../support/helpers/settings-storage-doctor-fixtures.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const report = StorageDoctorWireSchema.parse({ ...createSettingsStorageDoctorFixtures().REPORT_BASE,
  spanAuthority: { state: "unavailable", cause: { code: "span-unavailable", summary: "Synthetic unavailable history" } } });

it("distinguishes never-run, completed, degraded and failed doctor reads and retains report geometry during refresh", async () => {
  const result = Promise.withResolvers<typeof report>();
  let latest = { state: "never-run" } as StorageDoctorLatestWire;
  let state: ReturnType<typeof useStorageDoctor> | undefined;
  let reads = 0;
  const client = { latestStorageDoctor: () => Promise.resolve(latest), storageDoctor: () => { reads++; return result.promise; } } as unknown as DashboardClient;
  const doctor = () => state?.doctor;
  function Probe() { state = useStorageDoctor(); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (selected: DashboardClient) => { await act(async () => root.render(createElement(DashboardClientProvider, { client: selected, children: createElement(Probe) }))); };
  try {
    await render(client); assert.equal(doctor()?.state, "idle");
    await act(async () => { state?.runDoctor(); state?.runDoctor(); }); assert.equal(reads, 1);
    assert.equal(doctor()?.state, "running");
    await act(async () => result.resolve(report)); assert.equal(doctor()?.state, "loaded");
    const loaded = doctor();
    if (loaded?.state !== "loaded") assert.fail("doctor did not load");
    assert.equal(loaded.report, report);
    const failed = { ...client, storageDoctor: () => Promise.reject(new Error("Synthetic doctor failure")) };
    latest = { state: "completed", report };
    await render(failed); assert.equal(doctor()?.state, "loaded");
    await act(async () => state?.runDoctor()); assert.equal(doctor()?.state, "failed");
    const failedRead = doctor();
    if (failedRead?.state !== "failed") assert.fail("failed doctor reported success");
    assert.equal(failedRead.report, report); assert.equal(failedRead.message, "Synthetic doctor failure");
    const degraded = StorageDoctorWireSchema.parse({ ...report, authority: { state: "degraded", cause: { code: "authority-unavailable", summary: "Synthetic degraded authority" } } });
    await render({ ...client, latestStorageDoctor: () => Promise.resolve({ state: "completed", report: degraded }) });
    assert.equal(doctor()?.state, "loaded");
    const degradedRead = doctor();
    if (degradedRead?.state !== "loaded") assert.fail("degraded report dropped");
    assert.equal(degradedRead.report.authority.state, "degraded");
    await render({ ...client, latestStorageDoctor: () => Promise.reject(new Error("Synthetic latest failure")) });
    assert.equal(doctor()?.state, "failed");
  } finally { act(() => root.unmount()); }
});

it("fences a pending doctor and its stale action across client A to B to A", async () => {
  const first = Promise.withResolvers<typeof report>();
  let commands = 0, state: ReturnType<typeof useStorageDoctor> | undefined;
  const client = { latestStorageDoctor: () => Promise.resolve({ state: "never-run" }), storageDoctor: () => { commands++; return first.promise; } } as unknown as DashboardClient;
  const other = { ...client, latestStorageDoctor: () => Promise.resolve({ state: "never-run" as const }) };
  function Probe() { state = useStorageDoctor(); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (selected: DashboardClient) => { await act(async () => root.render(createElement(DashboardClientProvider, { client: selected, children: createElement(Probe) }))); };
  try {
    await render(client); const stale = state?.runDoctor;
    await act(async () => state?.runDoctor());
    await render(other); await render(client);
    await act(async () => stale?.()); assert.equal(commands, 1);
    await act(async () => first.resolve(report));
    assert.equal(state?.doctor.state, "idle");
  } finally { act(() => root.unmount()); }
});
