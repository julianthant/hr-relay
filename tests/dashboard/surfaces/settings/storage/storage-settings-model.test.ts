import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useStorageDoctor } from "../../../../../src/dashboard/surfaces/settings/storage/storage-settings-model.js";
import { StorageDoctorWireSchema, type StorageDoctorLatestWire } from "../../../../../src/models/dashboard/storage.js";
import { createSettingsStorageDoctorFixtures } from "../../../../support/helpers/settings-storage-doctor-fixtures.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const report = StorageDoctorWireSchema.parse({ ...createSettingsStorageDoctorFixtures().REPORT_BASE,
  spanAuthority: { state: "unavailable", cause: { code: "span-unavailable", summary: "Synthetic unavailable history" } } });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse(report.checkedAt) + 60_000); });
afterEach(() => { vi.useRealTimers(); });

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
    assert.equal(failedRead.neverRun, false); assert.equal(failedRead.report, report); assert.equal(failedRead.message, ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text);
    const degraded = StorageDoctorWireSchema.parse({ ...report, authority: { state: "degraded", cause: { code: "authority-unavailable", summary: "Synthetic degraded authority" } } });
    await render({ ...client, latestStorageDoctor: () => Promise.resolve({ state: "completed", report: degraded }) });
    assert.equal(doctor()?.state, "loaded");
    const degradedRead = doctor();
    if (degradedRead?.state !== "loaded") assert.fail("degraded report dropped");
    assert.equal(degradedRead.report.authority.state, "degraded");
    await render({ ...client, latestStorageDoctor: () => Promise.reject(new Error("Synthetic latest failure")) });
    const latestFailure = doctor(); assert.ok(latestFailure?.state === "failed");
    assert.equal(latestFailure.message, ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text); assert.equal(latestFailure.neverRun, false);
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

it("retains the exact report on revisit and bounds a hung latest read without running a full check", async () => {
  let latestCalls = 0, fullCalls = 0, state: ReturnType<typeof useStorageDoctor> | undefined;
  const doctor = () => state?.doctor;
  const held = Promise.withResolvers<StorageDoctorLatestWire>();
  const client = { latestStorageDoctor: () => ++latestCalls === 1 ? Promise.resolve({ state: "completed", report }) : held.promise,
    storageDoctor: () => { fullCalls++; return Promise.resolve(report); } } as unknown as DashboardClient;
  function Probe() { state = useStorageDoctor(); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (open: boolean) => { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: open ? createElement(Probe) : null }))); };
  try {
    await render(true); assert.equal(doctor()?.report, report); assert.equal(fullCalls, 0);
    await render(false); await render(true); assert.equal(latestCalls, 2); assert.equal(doctor()?.report, report);
    assert.equal(doctor()?.state, "loaded");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    assert.equal(doctor()?.state, "failed"); assert.equal(doctor()?.report, report); assert.equal(fullCalls, 0);
    held.resolve({ state: "never-run" }); await act(async () => {}); assert.equal(doctor()?.report, report);
  } finally { act(() => root.unmount()); }
});
it("runs one stale report check after five minutes, retains the report through failure, and never retries automatically", async () => {
  vi.setSystemTime(Date.parse(report.checkedAt) + 300_001);
  let checks = 0, state: ReturnType<typeof useStorageDoctor> | undefined;
  const doctor = () => state?.doctor;
  const failed = Promise.withResolvers<typeof report>();
  const client = { latestStorageDoctor: () => Promise.resolve({ state: "completed", report }), storageDoctor: () => { checks++; return failed.promise; } } as unknown as DashboardClient;
  function Probe() { state = useStorageDoctor(); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (open: boolean) => { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: open ? createElement(Probe) : null }))); };
  try {
    await render(true); assert.equal(checks, 1); assert.equal(doctor()?.state, "running"); assert.equal(doctor()?.report, report);
    await render(false); await render(true); assert.equal(checks, 1); assert.equal(doctor()?.report, report);
    await act(async () => { failed.reject(new Error("synthetic check failure")); });
    assert.equal(doctor()?.state, "failed"); assert.equal(doctor()?.report, report);
    await render(false); await render(true); await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    assert.equal(checks, 1); assert.equal(doctor()?.state, "failed"); assert.equal(doctor()?.report, report);
  } finally { act(() => root.unmount()); }
});

it("bounds a hung full doctor at sixty seconds, retains the exact report, and does not retry", async () => {
  let calls = 0, state: ReturnType<typeof useStorageDoctor> | undefined;
  const doctor = () => state?.doctor;
  const client = { latestStorageDoctor: () => Promise.resolve({ state: "completed", report }), storageDoctor: () => { calls++; return new Promise(() => {}); } } as unknown as DashboardClient;
  function Probe() { state = useStorageDoctor(); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => state?.runDoctor()); assert.equal(doctor()?.report, report);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); }); assert.equal(doctor()?.state, "running");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); assert.equal(doctor()?.state, "failed"); assert.equal(doctor()?.report, report);
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); }); assert.equal(calls, 1);
  } finally { act(() => root.unmount()); }
});
