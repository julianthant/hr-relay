import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import type { ObservedDataPoint } from "../../../../../src/backend/logs/span-emitter.js";
import { createTaskProvenanceCollector,jsonLeafPaths } from "../../../../../src/backend/runs/provenance/task-provenance.js";
import { createDeterministicUcpathSmartHrDriver } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { readPendingTerminationSetTask } from "../../../../../src/backend/systems/ucpath/tasks/read-pending-termination-set.js";
import { UcpathReadPendingTerminationSet } from "../../../../../src/models/systems/ucpath/read-pending-termination-set.js";
import type { UcpathTransactionRow } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionRowSchema,UcpathTransactionScanSchema } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/models/workflow/checkpoint.js";
import { SeparationsVerifyIdentityApproval } from "../../../../../src/models/workflows/separations/verify-identity-approval.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { JsonValueSchema } from "../../../../../src/rules/validation/canonical-json.js";
import { separationsDescriptor } from "../../../../support/helpers/registered-workflows.js";

const NOW = "2026-09-08T17:00:00.000Z";
const EID = EidSchema.parse("10987654");
const NAME = "Synthetic, Pending Observer";
const RUN_ID = "aaaaaaaa-0001-4000-8000-000100000000";

function observationHarness() {
  const approval = JsonValueSchema.parse(SeparationsVerifyIdentityApproval.output.parse({
    ...SeparationsVerifyIdentityApproval.example,
    documentNumber: "999999",
    approved: {
      ...SeparationsVerifyIdentityApproval.example.approved,
      emplId: EID,
      ucpathName: NAME,
    },
  }));
  const observed: ObservedDataPoint[] = [];
  const collector = createTaskProvenanceCollector({
    descriptor: separationsDescriptor,
    execution: {
      runId: RUN_ID,
      traceId: "sp-170000-aaaa",
      attempt: 1,
      workflowId: separationsDescriptor.id,
      nodeId: "pending-set",
      taskId: UcpathReadPendingTerminationSet.id,
    },
    upstreamEvidence: {
      checkpoints: [RunCheckpointRecordSchema.parse({
        workflowId: separationsDescriptor.id,
        itemId: "33333333-3333-4333-8333-333333333333",
        nodeId: "approval",
        attempt: 1,
        claimGeneration: 1,
        runId: RUN_ID,
        output: {
          schemaHash: deriveSchemaHash(SeparationsVerifyIdentityApproval.output, "output"),
          value: approval,
        },
        descriptorVersion: separationsDescriptor.version,
        contractFingerprint: "a".repeat(64),
        implFingerprint: "b".repeat(64),
        provenance: jsonLeafPaths(approval).map((path) => ({
          path, source: "live", observedAt: NOW, originalObservedAt: NOW,
        })),
        writtenAt: NOW,
      })],
    },
    clock: manualClock(new Date(NOW)),
    onRecord: ({ points }) => {
      observed.push(...redactObservedDataPoints(UcpathReadPendingTerminationSet.id, points));
    },
  });
  return {
    collector,
    observed,
    run: (rows: readonly UcpathTransactionRow[]) => readPendingTerminationSetTask.impl.run({
      input: { emplId: EID, expectedName: NAME },
      ctx: {
        captureScreenshot: async () => {},
        signal: new AbortController().signal,
        log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
        fail: (_code: string, message: string): never => { throw new Error(message); },
        recordData: collector.recordData,
        driver: createDeterministicUcpathSmartHrDriver({
          scan: UcpathTransactionScanSchema.parse({
            state: "read", emplId: EID, rows, scannedRowCount: rows.length, observedAt: NOW,
          }),
        }),
      },
    }),
  };
}

function assertObservedRows(observed: readonly ObservedDataPoint[], field: string, value: readonly UcpathTransactionRow[]) {
  assert.deepEqual(observed.find((point) => point.field === field), {
    direction: "read",
    field,
    values: [{ key: field, classification: "sensitive-hr", transform: "allow", state: "allowed", value }],
  });
}

function assertSubjectVisible(observed: readonly ObservedDataPoint[], transactionIds: readonly string[]) {
  assert.deepEqual(observed.find((point) => point.field === "emplId"), {
    direction: "read",
    field: "emplId",
    values: [{
      key: "emplId", classification: "direct-identifier", transform: "allow", state: "allowed", value: EID,
    }],
  });
  for (const identifier of [EID, ...transactionIds]) {
    assert.equal(JSON.stringify(observed).includes(identifier), true);
  }
}

describe("UCPath pending-set task observation", () => {
  it("records empty complete populations and finalizes an empty typed pending set", async () => {
    const harness = observationHarness();

    const output = await harness.run([]);

    assert.deepEqual(output, {
      kind: "ucpath-pending-termination-set",
      emplId: EID,
      eligible: [],
      protected: [],
      observedAt: NOW,
      source: "ss-smart-hr-detail-read",
    });
    assertObservedRows(harness.observed, "eligible", []);
    assertObservedRows(harness.observed, "protected", []);
    assertSubjectVisible(harness.observed, []);
    const finalized = harness.collector.finalizeRead(output);
    assert.deepEqual(finalized.provenance.map(({ path }) => path).sort(), [
      "eligible", "emplId", "kind", "observedAt", "protected", "source",
    ]);
    assert.deepEqual(harness.observed.find((point) => point.field === "source"), {
      direction: "read",
      field: "source",
      values: [{
        key: "source", classification: "safe-diagnostic", transform: "allow", state: "allowed", value: "ss-smart-hr-detail-read",
      }],
    });
  });

  it("retains exact eligible and protected rows in observations", async () => {
    const pending = UcpathTransactionRowSchema.parse({
      transactionId: "T900001", emplId: EID, displayedName: NAME,
      action: "Terminatn", approvalStatus: "Pending", startDate: "09/08/2026",
    });
    const approved = UcpathTransactionRowSchema.parse({
      transactionId: "T900002", emplId: EID, displayedName: NAME,
      action: "Terminatn", approvalStatus: "Approved", startDate: "09/07/2026",
    });
    const pushedBack = UcpathTransactionRowSchema.parse({
      transactionId: "T900003", emplId: EID, displayedName: NAME,
      action: "Terminatn", approvalStatus: "Pushed Back", startDate: "09/09/2026",
    });
    const harness = observationHarness();

    const output = await harness.run([pushedBack, approved, pending]);

    assert.deepEqual(output, {
      kind: "ucpath-pending-termination-set",
      emplId: EID,
      eligible: [pending, pushedBack],
      protected: [approved],
      observedAt: NOW,
      source: "ss-smart-hr-detail-read",
    });
    assertObservedRows(harness.observed, "eligible", [pending, pushedBack]);
    assertObservedRows(harness.observed, "protected", [approved]);
    assertSubjectVisible(harness.observed, ["T900001", "T900002", "T900003"]);
    const finalized = harness.collector.finalizeRead(output);
    assert.deepEqual(finalized.points.find(({ field }) => field === "eligible")?.value, [pending, pushedBack]);
    assert.deepEqual(finalized.points.find(({ field }) => field === "protected")?.value, [approved]);
    assert.deepEqual(finalized.provenance.map(({ path }) => path).sort(), [
      "eligible", "emplId", "kind", "observedAt", "protected", "source",
    ]);
  });

  it("still refuses an undeclared neighboring observation field at record time", async () => {
    const harness = observationHarness();
    await harness.run([]);
    const observedBefore = [...harness.observed];

    assert.throws(() => harness.collector.recordData({
      direction: "read", field: "eligibleTotal", value: 0,
    }), (error: unknown) => {
      assert.ok(error instanceof z.ZodError);
      assert.equal(error.issues.length, 1);
      const [issue] = error.issues;
      assert.ok(issue);
      assert.equal(issue.code, "custom");
      assert.deepEqual(issue.path, ["eligibleTotal"]);
      assert.match(issue.message, /no declared evidence classification for task-output:ucpath\/read-pending-termination-set field "eligibleTotal"/u);
      return true;
    });

    assert.deepEqual(harness.observed, observedBefore);
  });

  it("retains protected subject identifiers and population rows", async () => {
    const row = UcpathTransactionRowSchema.parse({
      transactionId: "T900004", emplId: EID, displayedName: NAME,
      action: "Terminatn", approvalStatus: "Pending", startDate: "09/08/2026",
    });
    const harness = observationHarness();

    const output = await harness.run([row]);

    assertObservedRows(harness.observed, "eligible", [row]);
    assertObservedRows(harness.observed, "protected", []);
    assert.deepEqual(harness.observed.find((point) => point.field === "emplId"), {
      direction: "read",
      field: "emplId",
      values: [{ key: "emplId", classification: "direct-identifier", transform: "allow", state: "allowed", value: EID }],
    });
    const observedText = JSON.stringify(harness.observed);
    for (const identifier of [EID, NAME, "T900004"]) {
      assert.equal(observedText.includes(identifier), true);
    }
    assert.deepEqual(output.eligible, [row]);
    assert.deepEqual(output.protected, []);
    const finalized = harness.collector.finalizeRead(output);
    assert.deepEqual(finalized.provenance.map(({ path }) => path).sort(), [
      "eligible", "emplId", "kind", "observedAt", "protected", "source",
    ]);
  });
});
