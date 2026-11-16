import assert from "node:assert/strict";
import { it } from "vitest";
import { previewRerunWarnings, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { sourceBoundReadContract, sourceBoundReadDescriptor } from "../../../support/fixtures/source-bound-read-fixtures.js";

const descriptor = defineWorkflowDescriptor({ id: sourceBoundReadDescriptor.id, version: 2,
  contractFingerprint: sourceBoundReadDescriptor.contractFingerprint, code: sourceBoundReadDescriptor.code,
  label: sourceBoundReadDescriptor.label, icon: sourceBoundReadDescriptor.icon, category: sourceBoundReadDescriptor.category,
  canonicalInput: sourceBoundReadDescriptor.canonicalInput, inputSubject: "eid", surface: sourceBoundReadDescriptor.surface,
  enqueue: sourceBoundReadDescriptor.enqueue, actions: sourceBoundReadDescriptor.actions, surfaces: {}, details: [],
  identity: { matchKey: input => input.eid }, presentation: { title: input => input.eid },
  scenarios: ["source-read/happy"], flow: flow(sourceBoundReadContract.input)
    .step("read", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: sourceBoundReadContract.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }) });

function fixture(outcome: "done" | "failed" | "interrupted" | "cancelled", older = false,
  uncertain?: "parked" | "attempting") {
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, version: 2, claimGeneration: 1,
    ...(["done", "failed"].includes(outcome) ? { completion: { schemaVersion: 1, kind: outcome,
      expectedVersion: 1, claim: { workerId: "fixture-worker", claimGeneration: 1 }, authorizedAt: QUEUED_RUN.updatedAt,
      ...(outcome === "failed" ? { failureId: "10000000-0000-4000-8000-000000000007" } : { resultDigest: "a".repeat(64) }) } } : {}),
    envelope: { ...QUEUED_RUN.envelope, workflow: descriptor.id, descriptorVersion: older ? 1 : descriptor.version,
      contractFingerprint: older ? "b".repeat(64) : descriptor.contractFingerprint },
    input: { raw: { eid: "10812345" }, parsed: { value: { eid: "10812345" }, protectedBindings: [],
      schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output") }, ingressSchemaHash: QUEUED_RUN.input.ingressSchemaHash },
    lifecycle: { state: "terminal", outcome, endedAt: QUEUED_RUN.updatedAt,
      ...(outcome === "failed" ? { failureId: "10000000-0000-4000-8000-000000000007" } : {}) } });
  const repositories = new Proxy({} as AuthorityRepositories, { get(_target, key) {
    switch (key) {
      case "deletedRuns": return { get: () => undefined };
      case "runs": return { get: () => run };
      case "writeIntents": return { listAttemptingByItem: () => uncertain === "attempting" ? [{}] : [],
        listByRun: () => uncertain === "parked" ? [{ status: "parked" }] : [] };
      case "runCheckpoints": return { listByItem: () => [] };
      case "gateResults": return { listByRun: () => [] };
      default: throw new Error(`unexpected authority access: ${String(key)}`);
    }
  } });
  const source = { runId: run.envelope.runId, expectedVersion: run.version, intent: "rerun" as const,
    selectedStepKeys: descriptor.timeline.map(step => step.key) };
  return { repositories, source };
}
it.each(["done", "failed", "interrupted"] as const)("ordinary Rerun accepts %s without inheriting saved work", outcome => {
  for (const older of [false, true]) {
    const f = fixture(outcome, older);
    const plan = previewRerunWarnings(f.repositories, descriptor, f.source);
    assert.deepEqual(plan.source, f.source);
    assert.deepEqual(plan.warnings, []);
    assert.equal(Object.hasOwn(plan, "continuation"), false);
  }
});
it.each(["parked", "attempting"] as const)("ordinary Rerun still refuses %s write authority", uncertain => {
  for (const older of [false, true]) {
    const f = fixture("done", older, uncertain);
    assert.throws(() => previewRerunWarnings(f.repositories, descriptor, f.source),
      error => error instanceof RerunRefusedError && error.code === "invalid-state");
  }
});
it("ordinary Rerun refuses a cancelled source", () => {
  const f = fixture("cancelled");
  assert.throws(() => previewRerunWarnings(f.repositories, descriptor, f.source),
    error => error instanceof RerunRefusedError && error.code === "invalid-state");
});
