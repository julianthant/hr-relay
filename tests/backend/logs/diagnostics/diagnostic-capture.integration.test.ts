import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { afterAll as afterAll_m1,beforeAll as beforeAll_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { createDiagnosticCaptureService as createDiagnosticCaptureService_m0,createDiagnosticCaptureService as createDiagnosticCaptureService_m1 } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture as operatorRequestedCapture_m0 } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { RunDetailSectionResponseSchema as RunDetailSectionResponseSchema_m1 } from "../../../../src/models/dashboard/run-detail.js";
import { DeclaredActionIdentitySchema as DeclaredActionIdentitySchema_m1 } from "../../../../src/models/workflow/operation-action-identity.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { startOperationAuthorityServer as startOperationAuthorityServer_m1 } from "../../../support/fixtures/dashboard/fixture-operation-authority.js";
import { sequentialIdFactory as sequentialIdFactory_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { trustWorld as trustWorld_m0 } from "../../../support/helpers/backend/trust-authority-fixture.js";


{


describe_m0("ordinary diagnostic authority", () => {
  it_m0("keeps active and pinned captures and marks expired settled captures explicitly unavailable", async () => {
    const w = trustWorld_m0();
    try {
      const active = w.create(810), settled = w.create(811); w.cancel(settled, 812);
      let id = 0;
      const service = createDiagnosticCaptureService_m0({ authority: w.database.authority, clock: w.world.clock,
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12,"0")}` }, retentionDays: 1,
        artifacts: { stageDiagnostic: () => { throw new Error("no bytes in this test"); }, put: () => { throw new Error("no bytes in this test"); }, open: () => { throw new Error("no bytes in this test"); } } });
      const capture = (runId: string, pin = false) => operatorRequestedCapture_m0({ service, runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        ...(pin ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const activeBundle = await capture(active.envelope.runId), ordinary = await capture(settled.envelope.runId), pinned = await capture(settled.envelope.runId, true);
      const later = new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString();
      assert_m0.deepEqual(w.database.sweepOrdinaryDiagnostics(later).purged, [ordinary.bundleId]);
      assert_m0.equal(w.database.authority.diagnosticBundles.get(ordinary.bundleId)?.availability?.state, "purged");
      assert_m0.equal(w.database.authority.diagnosticBundles.get(activeBundle.bundleId)?.availability, undefined);
      assert_m0.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
      assert_m0.deepEqual(w.database.readManagedArtifactReferences(), []);
    } finally { w.dispose(); }
  });
});
}

{


let server: Awaited<ReturnType<typeof startOperationAuthorityServer_m1>>;
const _beforeAllFixture0 = async () => { server = await startOperationAuthorityServer_m1(); };
const _afterAllFixture1 = async () => { if (server !== undefined) await server.close(); };

describe_m1("executable operation app authority", () => {
beforeAll_m1(_beforeAllFixture0);
afterAll_m1(_afterAllFixture1);

  it_m1("serves confirmed fictional form effects from the real browser executor", async () => {
    const browser = await startOperationAuthorityServer_m1("browser");
    try {
      const response = await fetch(`${browser.baseUrl}/api/v1/runs/${browser.runId}/logs`);
      assert_m1.equal(response.status, 200);
      const section = RunDetailSectionResponseSchema_m1.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("browser-form-observations-missing");
      const observations = section.payload.operationStructure.observations;
      const confirmed = observations.filter((item) => item.occurrence.state === "confirmed");
      assert_m1.deepEqual(confirmed.map((item) => item.occurrence.logicalActionId), ["fill-employee", "search", "read-result"]);
      assert_m1.deepEqual(confirmed.filter((item) => item.occurrence.value?.state === "observed").map((item) => item.occurrence.value?.value), ["10800000", "resolved"]);
      const target = confirmed[1];
      assert_m1.ok(target !== undefined);
      const { value: _value, ...identity } = target.occurrence;
      browser.database.authority.diagnosticBundles.validateOperation(identity);
      const run = browser.database.authority.runs.get(browser.runId);
      assert_m1.ok(run);
      let artifactWrites = 0;
      const capture = createDiagnosticCaptureService_m1({ authority: browser.database.authority,
        clock: manualClock_m1(new Date(target.at)), ids: sequentialIdFactory_m1("d"),
        artifacts: { stageDiagnostic: async () => { artifactWrites += 1; throw new Error("unexpected artifact write"); }, put: async () => { artifactWrites += 1; throw new Error("unexpected artifact write"); }, open: async () => { throw new Error("unexpected artifact read"); } },
      });
      const request = { trigger: "operator-request" as const, requestedBy: "local-operator", runId: browser.runId, operation: identity,
        configFingerprint: run.envelope.configFingerprint, descriptorFingerprint: run.envelope.contractFingerprint, fields: [], attachments: [] };
      for (const mismatch of [{ runId: "00000000-0000-4000-8000-000000000099" }, { descriptorFingerprint: "b".repeat(64) }]) {
        await assert_m1.rejects(capture.prepare({ ...request, ...mismatch, attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode("[]") }] }), /diagnostic-operation-request-owner-mismatch/u);
      }
      assert_m1.equal(artifactWrites, 0);
      const bundle = await capture.capture(request);
      assert_m1.deepEqual(browser.database.authority.diagnosticBundles.get(bundle.bundleId)?.operation, identity);
      for (const operation of [
        { ...identity, occurrence: identity.occurrence + 100 },
        { ...identity, physicalSessionId: "00000000-0000-4000-8000-000000000099" },
        { ...identity, confirmation: { ...identity.confirmation, verifiedAt: "2026-08-03T09:00:01.000Z" } },
      ]) {
        await assert_m1.rejects(capture.prepare({ ...request, operation: DeclaredActionIdentitySchema_m1.parse(operation) }), /diagnostic-operation-exact-occurrence-not-retained/u);
        assert_m1.throws(() => browser.database.authority.diagnosticBundles.insert({ ...bundle, operation: DeclaredActionIdentitySchema_m1.parse(operation) }), /diagnostic-operation-exact-occurrence-not-retained/u);
      }
      for (const item of confirmed) {
        const proof = item.occurrence.confirmation;
        assert_m1.ok(proof);
        assert_m1.ok(observations.some((verification) => verification.occurrence.logicalActionId === proof.verificationActionId && verification.occurrence.occurrence === proof.verificationOccurrence && verification.occurrence.physicalSessionId === item.occurrence.physicalSessionId && verification.occurrence.state === "completed" && verification.at === proof.verifiedAt));
      }
    } finally { await browser.close(); }
  });
});
}
