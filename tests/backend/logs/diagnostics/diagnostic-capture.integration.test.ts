import { default as assert } from "node:assert/strict";
import { describe, it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";

{

describe("ordinary diagnostic authority", () => {
  it("keeps active and pinned captures and marks expired settled captures explicitly unavailable", async () => {
    const w = await trustWorld();
    try {
      const active = w.create(810), settled = w.create(811); w.cancel(settled, 812);
      let id = 0;
      const service = createDiagnosticCaptureService({ authority: w.database.authority, clock: w.world.clock,
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12,"0")}` }, retentionDays: 1,
        artifacts: { stageDiagnostic: () => { throw new Error("no bytes in this test"); }, put: () => { throw new Error("no bytes in this test"); }, open: () => { throw new Error("no bytes in this test"); } } });
      const capture = (runId: string, pin = false) => operatorRequestedCapture({ service, runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        ...(pin ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const activeBundle = await capture(active.envelope.runId), ordinary = await capture(settled.envelope.runId), pinned = await capture(settled.envelope.runId, true);
      const later = new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString();
      assert.deepEqual(w.database.sweepOrdinaryDiagnostics(later).purged, [ordinary.bundleId]);
      assert.equal(w.database.authority.diagnosticBundles.get(ordinary.bundleId)?.availability?.state, "purged");
      assert.equal(w.database.authority.diagnosticBundles.get(activeBundle.bundleId)?.availability, undefined);
      assert.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
      assert.deepEqual(w.database.readManagedArtifactReferences(), []);
    } finally { await w.dispose(); }
  });
});
}
