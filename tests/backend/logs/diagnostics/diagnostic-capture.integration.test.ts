import { default as assert } from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { RunDetailSectionResponseSchema } from "../../../../src/models/dashboard/run-detail.js";
import { DeclaredActionIdentitySchema } from "../../../../src/models/workflow/operation-action-identity.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { startOperationAuthorityServer } from "../../../support/fixtures/dashboard/fixture-operation-authority.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
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

{

let server: Awaited<ReturnType<typeof startOperationAuthorityServer>>;
const _beforeAllFixture0 = async () => { server = await startOperationAuthorityServer(); };
const _afterAllFixture1 = async () => { if (server !== undefined) await server.close(); };

describe("executable operation app authority", () => {
beforeAll(_beforeAllFixture0);
afterAll(_afterAllFixture1);

  it("serves confirmed fictional form effects from the real browser executor", async () => {
    const browser = await startOperationAuthorityServer("browser");
    try {
      const response = await fetch(`${browser.baseUrl}/api/v1/runs/${browser.runId}/logs`);
      assert.equal(response.status, 200);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("browser-form-observations-missing");
      const observations = section.payload.operationStructure.observations;
      const confirmed = observations.filter((item) => item.occurrence.state === "confirmed");
      assert.deepEqual(confirmed.map((item) => item.occurrence.logicalActionId), ["fill-employee", "search", "read-result"]);
      assert.deepEqual(confirmed.filter((item) => item.occurrence.value?.state === "observed").map((item) => item.occurrence.value?.value), ["10800000", "resolved"]);
      const target = confirmed[1];
      assert.ok(target !== undefined);
      const { value: _value, ...identity } = target.occurrence;
      browser.database.authority.diagnosticBundles.validateOperation(identity);
      const run = browser.database.authority.runs.get(browser.runId);
      assert.ok(run);
      let artifactWrites = 0;
      const capture = createDiagnosticCaptureService({ authority: browser.database.authority,
        clock: manualClock(new Date(target.at)), ids: sequentialIdFactory("d"),
        artifacts: { stageDiagnostic: async () => { artifactWrites += 1; throw new Error("unexpected artifact write"); }, put: async () => { artifactWrites += 1; throw new Error("unexpected artifact write"); }, open: async () => { throw new Error("unexpected artifact read"); } },
      });
      const request = { trigger: "operator-request" as const, requestedBy: "local-operator", runId: browser.runId, operation: identity,
        configFingerprint: run.envelope.configFingerprint, descriptorFingerprint: run.envelope.contractFingerprint, fields: [], attachments: [] };
      for (const mismatch of [{ runId: "00000000-0000-4000-8000-000000000099" }, { descriptorFingerprint: "b".repeat(64) }]) {
        await assert.rejects(capture.prepare({ ...request, ...mismatch, attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode("[]") }] }), /diagnostic-operation-request-owner-mismatch/u);
      }
      assert.equal(artifactWrites, 0);
      const bundle = await capture.capture(request);
      assert.deepEqual(browser.database.authority.diagnosticBundles.get(bundle.bundleId)?.operation, identity);
      for (const operation of [
        { ...identity, occurrence: identity.occurrence + 100 },
        { ...identity, physicalSessionId: "00000000-0000-4000-8000-000000000099" },
        { ...identity, confirmation: { ...identity.confirmation, verifiedAt: "2026-08-03T09:00:01.000Z" } },
      ]) {
        await assert.rejects(capture.prepare({ ...request, operation: DeclaredActionIdentitySchema.parse(operation) }), /diagnostic-operation-exact-occurrence-not-retained/u);
        assert.throws(() => browser.database.authority.diagnosticBundles.insert({ ...bundle, operation: DeclaredActionIdentitySchema.parse(operation) }), /diagnostic-operation-exact-occurrence-not-retained/u);
      }
      for (const item of confirmed) {
        const proof = item.occurrence.confirmation;
        assert.ok(proof);
        assert.ok(observations.some((verification) => verification.occurrence.logicalActionId === proof.verificationActionId && verification.occurrence.occurrence === proof.verificationOccurrence && verification.occurrence.physicalSessionId === item.occurrence.physicalSessionId && verification.occurrence.state === "completed" && verification.at === proof.verifiedAt));
      }
    } finally { await browser.close(); }
  });
});
}
