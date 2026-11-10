import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it, vi } from "vitest";
import { buildBootstrap } from "../../../../src/backend/runs/queries/bootstrap.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";

vi.mock("node:fs", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs")>(),
  readdirSync: vi.fn(() => { throw new Error("bootstrap must not scan backup directories"); }),
}));

describe("bootstrap storage authority contract", () => {
  it("requires authority and rejects removed status and restore fields", () => {
    assert.equal(StorageHealthSummaryWireSchema.safeParse({}).success, false);
    assert.equal(StorageHealthSummaryWireSchema.safeParse({ authority: "unknown" }).success, false);
    for (const authority of ["healthy", "unavailable"]) {
      assert.deepEqual(StorageHealthSummaryWireSchema.parse({ authority }), { authority });
      for (const [field, value] of Object.entries({
        backup: "current", checkedAt: "2026-11-06T12:00:00.000Z",
        lastBackupAt: null, backupCheckedAt: null, restoreTarget: { state: "available" },
      })) assert.equal(StorageHealthSummaryWireSchema.safeParse({ authority, [field]: value }).success, false, field);
    }
  });

  it("probes authority exactly once per cheap bootstrap read without scanning backups", () => {
    const clock = manualClock(new Date("2026-11-06T13:00:00.000Z"));
    const authorityMeta = vi.fn(() => ({ schemaVersion: 27, authorityGeneration: 41 }));
    const deps = {
      appVersion: "0.1.0", actorLabel: () => "Fixture Operator", clock, timeZone: "UTC", modules: [],
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), settingsSchemaHash: FingerprintSchema.parse("b".repeat(64)),
      projection: { generation: () => 1 }, authorityMeta,
      workbookReferences: () => [], preflightReport: () => healthyDashboardPreflightReport(clock),
    };
    vi.mocked(readdirSync).mockClear();
    assert.deepEqual(buildBootstrap(deps).storage, { authority: "healthy" });
    assert.equal(authorityMeta.mock.calls.length, 1);
    authorityMeta.mockImplementation(() => { throw new Error("authority unavailable"); });
    assert.deepEqual(buildBootstrap(deps).storage, { authority: "unavailable" });
    assert.equal(authorityMeta.mock.calls.length, 2);
    assert.equal(vi.mocked(readdirSync).mock.calls.length, 0);
  });
});
