import { manualClock } from "../../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createDiagnosticCaptureService } from "../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { startOperationAuthorityServer } from "../../../../support/fixtures/dashboard/fixture-operation-authority.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { DeclaredActionIdentitySchema } from "../../../../../src/models/workflow/operation-action-identity.js";
import { OperationSourceResponseSchema } from "../../../../../src/models/dashboard/operation-structure.js";

let server: Awaited<ReturnType<typeof startOperationAuthorityServer>>;
beforeAll(async () => { server = await startOperationAuthorityServer(); });
afterAll(async () => { if (server !== undefined) await server.close(); });

async function logs() {
  const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
  assert.equal(response.status, 200);
  const section = RunDetailSectionResponseSchema.parse(await response.json());
  assert.equal(section.section, "logs");
  if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("operation-app-fixture-missing-frozen-logs");
  return section.payload.operationStructure;
}

describe("executable operation app authority", () => {
  it("serves real frozen executor lifecycle and values through the Logs route", async () => {
    const structure = await logs();
    assert.equal(structure.runId, server.runId);
    const confirmed = structure.observations.filter((observation) => observation.occurrence.state === "confirmed");
    assert.equal(confirmed.length, 4);
    for (const observation of confirmed) {
      const proof = observation.occurrence.confirmation;
      assert.ok(proof !== undefined);
      assert.ok(structure.observations.some((verification) => verification.occurrence.logicalActionId === proof.verificationActionId && verification.occurrence.occurrence === proof.verificationOccurrence && verification.occurrence.state === "completed" && verification.at === proof.verifiedAt));
    }
    assert.ok(structure.observations.some((observation) => observation.occurrence.state === "started"));
    assert.ok(structure.observations.some((observation) => observation.occurrence.state === "not-run"));
    assert.ok(structure.observations.some((observation) => observation.occurrence.value?.state === "observed" && typeof observation.occurrence.value.value === "string" && observation.occurrence.value.value.includes("Fixture operator")));
  });
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
        artifacts: { put: async () => { artifactWrites += 1; throw new Error("unexpected artifact write"); }, open: async () => { throw new Error("unexpected artifact read"); } },
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
  it("authorizes the exact nested-child source under the current parent and refuses a foreign edge", async () => {
    const structure = await logs();
    const value = structure.observations.find((observation) => observation.occurrence.value?.producer.kind === "transformation")?.occurrence.value;
    assert.ok(value?.producer.kind === "transformation");
    const identity = value.producer.inputs?.[0]?.identities[0];
    assert.ok(identity);
    assert.notEqual(identity.runId, server.runId);
    const url = (input: unknown) => `${server.baseUrl}/api/v1/runs/${server.runId}/operation-source?request=${encodeURIComponent(JSON.stringify({ identity: input }))}`;
    const client = createDashboardClient({ baseUrl: server.baseUrl });
    assert.equal((await client.operationSource(server.runId, { identity })).state, "found");
    const response = await fetch(url(identity));
    assert.equal(response.status, 200);
    const source = OperationSourceResponseSchema.parse(await response.json());
    assert.equal(source.state, "found");
    if (source.state === "found") {
      assert.equal(source.structure.runId, identity.runId);
      const forged = createDashboardClient({ baseUrl: server.baseUrl, fetchImpl: async () => new Response(JSON.stringify({ ...source,
        structure: { ...source.structure, observations: source.structure.observations.map((observation) => ({ ...observation, occurrence: { ...observation.occurrence, occurrence: observation.occurrence.occurrence + 100 } })) } }), { headers: { "content-type": "application/json" } }) });
      await assert.rejects(forged.operationSource(server.runId, { identity }), /OPERATION_SOURCE_IDENTITY_MISMATCH/u);
    }
    const denied = await fetch(url({ ...identity, childInvocation: { ...identity.childInvocation, edgeId: "foreign-edge" } }));
    assert.notEqual(denied.status, 200);
    assert.match(await denied.text(), /child-identity-mismatch/u);
  });
});
