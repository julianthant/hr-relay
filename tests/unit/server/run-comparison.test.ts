import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../src/domain/trust/evidence.js";
import { defineReceiptComparisonRegistry } from "../../../src/domain/trust/receipt-comparison.js";
import { buildRunReceiptComparison } from "../../../src/server/dashboard/queries/run-comparison.js";
import { separationsDescriptor } from "../../../src/workflows/separations/descriptor.js";
import {
  cleanReceiptOf,
  runRecordOf,
  uuidOf,
} from "./helpers/dashboard-harness.js";

const REGISTRY = defineReceiptComparisonRegistry(separationsDescriptor, {
  workflowId: "separations",
  facts: [{
    id: "separations.action.document-number",
    label: "Document number",
    disclosure: { posture: "allow", classification: "safe-diagnostic", transform: "allow" },
    binding: {
      collection: "observations",
      sourceKinds: ["system", "checkpoint"],
      nodeId: "resolve-action",
      taskId: "kuali/search-separation-action",
      fieldPath: "documentNumber",
    },
  }],
});

function runPair(): readonly [RunRecord, RunRecord] {
  const prior = runRecordOf({ seed: 401, workflow: "separations" });
  const currentBase = runRecordOf({ seed: 402, workflow: "separations" });
  const current = RunRecordSchema.parse({
    ...currentBase,
    envelope: {
      ...currentBase.envelope,
      itemId: prior.envelope.itemId,
      retryOf: prior.envelope.runId,
      attempt: 2,
    },
  });
  return [prior, current];
}

function receiptFor(run: RunRecord, value: string): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed: Number(String(run.envelope.runId).slice(0, 4)), workflow: "separations" }),
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
    retryOf: run.envelope.retryOf === undefined
      ? { state: "absent" }
      : { state: "present", value: run.envelope.retryOf },
    observations: [{
      id: uuidOf(Number(run.envelope.attempt) + 8000),
      field: "documentNumber",
      mandatory: true,
      source: {
        kind: "system",
        taskId: "kuali/search-separation-action",
        observedAt: "2026-08-28T12:00:00.000Z",
      },
      state: "satisfied",
      value: {
        key: "documentNumber",
        state: "allowed",
        classification: "safe-diagnostic",
        transform: "allow",
        value,
      },
    }],
  });
}

describe("run receipt comparison query", () => {
  it("serves the exact retry pair and its changed registered fact", () => {
    const [prior, current] = runPair();
    const priorReceipt = receiptFor(prior, "4502");
    const currentReceipt = receiptFor(current, "4537");
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);
    const receipts = new Map<string, readonly RunEvidenceReceipt[]>([
      [prior.envelope.runId, [priorReceipt]],
      [current.envelope.runId, [currentReceipt]],
    ]);

    const result = buildRunReceiptComparison({
      registry: REGISTRY,
      authority: {
        getRun: (runId) => runs.get(runId),
        listReceiptsByRun: (runId) => receipts.get(runId) ?? [],
      },
    }, current.envelope.runId);

    assert.deepEqual(result, {
      wireVersion: 1,
      runId: current.envelope.runId,
      retryOf: prior.envelope.runId,
      workflowId: "separations",
      currentReceiptId: currentReceipt.receiptId,
      priorReceiptId: priorReceipt.receiptId,
      facts: [{
        state: "changed",
        factId: "separations.action.document-number",
        label: "Document number",
        before: "4502",
        after: "4537",
      }],
    });
  });

  it("refuses a retry whose prior run belongs to another logical item", () => {
    const [priorBase, current] = runPair();
    const prior = RunRecordSchema.parse({
      ...priorBase,
      envelope: { ...priorBase.envelope, itemId: uuidOf(999) },
    });
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);

    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: (runId) => [
            receiptFor(runId === current.envelope.runId ? current : prior, "4502"),
          ],
        },
      }, current.envelope.runId),
      new RegExp(
        `run ${current.envelope.runId} retries ${prior.envelope.runId}, but item `
        + `${current.envelope.itemId} does not equal prior item ${prior.envelope.itemId}`,
      ),
    );
  });

  it("refuses a retry whose prior run belongs to another workflow", () => {
    const [priorBase, current] = runPair();
    const prior = RunRecordSchema.parse({
      ...priorBase,
      envelope: { ...priorBase.envelope, workflow: "person-lookup" },
    });
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);

    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: () => {
            throw new Error("receipt authority must not be read for a foreign workflow");
          },
        },
      }, current.envelope.runId),
      new RegExp(
        `run ${current.envelope.runId} is separations, but retryOf ${prior.envelope.runId} is person-lookup`,
      ),
    );
  });

  it("refuses a receipt returned for a different exact run id", () => {
    const [prior, current] = runPair();
    const foreignReceipt = receiptFor(prior, "4502");
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);

    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: () => [foreignReceipt],
        },
      }, current.envelope.runId),
      new RegExp(
        `receipt ${foreignReceipt.receiptId} belongs to run ${prior.envelope.runId}, `
        + `not requested run ${current.envelope.runId}`,
      ),
    );
  });
});
