import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import type { DashboardApp } from "../../../../src/backend/transports/dashboard/routes/api-types.js";
import { registerStorageRoutes } from "../../../../src/backend/transports/dashboard/routes/storage.js";
import type { StorageRouteDeps } from "../../../../src/backend/transports/dashboard/routes/storage-types.js";
import { StorageDoctorLatestWireSchema, StorageDoctorWireSchema, type StorageDoctorWire } from "../../../../src/domain/dashboard/storage.js";

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
