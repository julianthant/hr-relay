import { createStorageBackupObservation } from "../../../../../src/backend/runs/queries/storage.js";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { it } from "vitest";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import type { StorageRouteDeps } from "../../../../../src/backend/transports/http/routes/storage-types.js";
import { registerStorageRoutes } from "../../../../../src/backend/transports/http/routes/storage.js";
import { StorageDoctorLatestWireSchema,StorageDoctorWireSchema,type StorageDoctorWire } from "../../../../../src/models/dashboard/storage.js";

const report = StorageDoctorWireSchema.parse({
  mode: "read-only", checkedAt: "2026-09-26T12:00:00.000Z", recovery: { state: "clear" },
  authority: { state: "healthy", schemaVersion: 1, authorityGeneration: 1, pageCount: 1 },
  authorityUpgrades: { state: "absent", reason: "journal-empty" },
  protectedSettings: { state: "unavailable", cause: { code: "unavailable", summary: "unavailable" } },
  counts: { state: "available", values: { pendingCommands: 0, unresolvedWriteIntents: 0, leases: 0, providerReservations: 0, artifactOutbox: 0 } },
  spanAuthority: { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] },
  backup: { state: "missing", cause: { code: "missing", summary: "none" } }, restoreCandidates: [],
  service: { state: "never-run", reason: "none" },
});

function app(run: () => Promise<StorageDoctorWire>, backupObservation?: StorageRouteDeps["backupObservation"]) {
  const instance = new Hono();
  registerStorageRoutes(instance as unknown as DashboardApp, { backupObservation } as StorageRouteDeps, run);
  return instance;
}

it("returns only the last completed storage check without rerunning or leaking between route registrations", async () => {
  let calls = 0;
  let fail = false;
  const first = app(async () => { calls++; if (fail) throw new Error("synthetic doctor failed"); return report; });
  const second = app(async () => { throw new Error("second runtime must not run"); });
  const latest = async (server: Hono) => StorageDoctorLatestWireSchema.parse(await (await server.request("/api/v1/storage/doctor/latest")).json());
  assert.deepEqual(await latest(first), { state: "never-run" });
  assert.equal(calls, 0);
  assert.equal((await first.request("/api/v1/storage/doctor")).status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await latest(first), { state: "completed", report });
  assert.equal(calls, 1);
  fail = true;
  assert.equal((await first.request("/api/v1/storage/doctor")).status, 500);
  assert.deepEqual(await latest(first), { state: "completed", report });
  assert.deepEqual(await latest(second), { state: "never-run" });
});

it.each(["clear", "result"])("guards history %s before body effects and returns explicit unavailable authority", async operation => {
  const server = app(async () => report);
  const path = `/api/v1/storage/run-history/${operation}`;
  assert.deepEqual(await (await server.request("/api/v1/storage/run-history")).json(), { state: "unavailable" });
  assert.equal((await server.request(path, { method: "POST", body: "malformed" })).status, 403);
  assert.equal((await server.request(path, { method: "POST", headers: { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938" }, body: "malformed" })).status, 415);
  const commandId = "50000000-0000-4000-8000-000000000001";
  const response = await server.request(path, { method: "POST", headers: { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" }, body: JSON.stringify({ commandId, target: { profileId: "00000000-0000-4000-8000-000000000001", epoch: 1 } }) });
  assert.deepEqual(await response.json(), { state: "refused", commandId, reason: "unavailable" });
});


it("publishes validated injected doctor results and invalidates failures without replacing last completed history", async () => {
  const observation = createStorageBackupObservation();
  const latestCandidate = {
    state: "verified-compatible", selection: "single-database", schemaVersion: 1,
    manifestFileName: "backup.manifest.json", backupFileName: "backup.sqlite", createdAt: "2026-09-26T11:00:00.000Z",
    authorityGeneration: 1, ageMs: 3_600_000, generationGap: { state: "known", value: 0 }, restoreEligibility: { state: "eligible" },
  };
  const completed = StorageDoctorWireSchema.parse({ ...report, backup: { state: "current", latest: latestCandidate }, restoreCandidates: [latestCandidate] });
  let result: StorageDoctorWire = completed;
  let fail = false;
  let calls = 0;
  const server = app(async () => { calls++; if (fail) throw new Error("synthetic doctor failed"); return result; }, observation);
  assert.equal(observation.read(1).backupCheckedAt, null);
  assert.equal((await server.request("/api/v1/storage/doctor")).status, 200);
  assert.equal(observation.read(1).backup, "current");
  assert.equal(observation.read(1).backupCheckedAt, completed.checkedAt);
  fail = true;
  assert.equal((await server.request("/api/v1/storage/doctor")).status, 500);
  assert.equal(observation.read(1).backup, "unavailable");
  assert.equal(observation.read(1).backupCheckedAt, report.checkedAt);
  assert.deepEqual(await (await server.request("/api/v1/storage/doctor/latest")).json(), { state: "completed", report: completed });
  fail = false;
  result = { ...completed };
  Object.assign(result, { mode: "invalid" });
  assert.equal((await server.request("/api/v1/storage/doctor")).status, 500);
  assert.equal(observation.read(1).backup, "unavailable");
  assert.deepEqual(await (await server.request("/api/v1/storage/doctor/latest")).json(), { state: "completed", report: completed });
  result = StorageDoctorWireSchema.parse({ ...completed, checkedAt: "2026-09-26T12:30:00.000Z" });
  assert.equal((await server.request("/api/v1/storage/doctor")).status, 200);
  assert.equal(observation.read(1).backup, "current");
  assert.equal(observation.read(1).backupCheckedAt, result.checkedAt);
  assert.equal(calls, 4);
});
