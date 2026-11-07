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
  counts: { state: "available", values: { pendingCommands: 0, unresolvedWriteIntents: 0, providerReservations: 0, artifactOutbox: 0 } },
  spanAuthority: { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] },
  backup: { state: "missing", cause: { code: "missing", summary: "none" } }, restoreCandidates: [],
  service: { state: "never-run", reason: "none" },
});

function app(run: () => Promise<StorageDoctorWire>) {
  const instance = new Hono();
  registerStorageRoutes(instance as unknown as DashboardApp, {} as StorageRouteDeps, run);
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
