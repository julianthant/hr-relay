import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../src/domain/trust/evidence.js";
import { defineReceiptComparisonRegistry } from "../../../src/domain/trust/receipt-comparison.js";
import { buildRunReceiptComparison } from "../../../src/server/dashboard/queries/run-comparison.js";
import { failureStatus } from "../../../src/server/dashboard/routes/failure-status.js";
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
  it("emits one typed refusal for every expected D289 identity, cardinality, and registry failure", () => {
    const [prior, current] = runPair();
    const priorReceipt = receiptFor(prior, "4502");
    const currentReceipt = receiptFor(current, "4537");
    const foreignRunId = uuidOf(9401);
    const foreignItemId = uuidOf(9402);
    const foreignWorkflowPrior = RunRecordSchema.parse({
      ...prior,
      envelope: { ...prior.envelope, workflow: "person-lookup" },
    });
    const foreignItemPrior = RunRecordSchema.parse({
      ...prior,
      envelope: { ...prior.envelope, itemId: foreignItemId },
    });
    const emptyPriorReceipt = RunEvidenceReceiptSchema.parse({ ...priorReceipt, observations: [] });
    const emptyCurrentReceipt = RunEvidenceReceiptSchema.parse({ ...currentReceipt, observations: [] });
    const cases: readonly Readonly<{
      label: string;
      runs: ReadonlyMap<string, RunRecord>;
      receipts: ReadonlyMap<string, readonly RunEvidenceReceipt[]>;
    }>[] = [
      {
        label: "current receipt identity",
        runs: new Map([[prior.envelope.runId, prior], [current.envelope.runId, current]]),
        receipts: new Map([
          [prior.envelope.runId, [priorReceipt]],
          [current.envelope.runId, [RunEvidenceReceiptSchema.parse({ ...currentReceipt, runId: foreignRunId })]],
        ]),
      },
      {
        label: "prior receipt identity",
        runs: new Map([[prior.envelope.runId, prior], [current.envelope.runId, current]]),
        receipts: new Map([
          [prior.envelope.runId, [RunEvidenceReceiptSchema.parse({ ...priorReceipt, runId: foreignRunId })]],
          [current.envelope.runId, [currentReceipt]],
        ]),
      },
      {
        label: "retry authority",
        runs: new Map([[current.envelope.runId, current]]),
        receipts: new Map(),
      },
      {
        label: "same workflow",
        runs: new Map([[prior.envelope.runId, foreignWorkflowPrior], [current.envelope.runId, current]]),
        receipts: new Map(),
      },
      {
        label: "same item",
        runs: new Map([[prior.envelope.runId, foreignItemPrior], [current.envelope.runId, current]]),
        receipts: new Map(),
      },
      {
        label: "current receipt cardinality",
        runs: new Map([[prior.envelope.runId, prior], [current.envelope.runId, current]]),
        receipts: new Map([[prior.envelope.runId, [priorReceipt]], [current.envelope.runId, []]]),
      },
      {
        label: "prior receipt cardinality",
        runs: new Map([[prior.envelope.runId, prior], [current.envelope.runId, current]]),
        receipts: new Map([
          [prior.envelope.runId, [priorReceipt, priorReceipt]],
          [current.envelope.runId, [currentReceipt]],
        ]),
      },
      {
        label: "closed registry coordinate",
        runs: new Map([[prior.envelope.runId, prior], [current.envelope.runId, current]]),
        receipts: new Map([
          [prior.envelope.runId, [emptyPriorReceipt]],
          [current.envelope.runId, [emptyCurrentReceipt]],
        ]),
      },
    ];

    for (const testCase of cases) {
      let classified: ReturnType<typeof failureStatus>;
      try {
        buildRunReceiptComparison({
          registry: REGISTRY,
          authority: {
            getRun: (runId) => testCase.runs.get(runId),
            listReceiptsByRun: (runId) => testCase.receipts.get(runId) ?? [],
          },
        }, current.envelope.runId);
        throw new Error(`comparison case ${testCase.label} unexpectedly succeeded`);
      } catch (error) {
        classified = failureStatus(error);
      }

      assert.equal(classified.status, 409, testCase.label);
      assert.equal(classified.body.code, "COMPARISON_IDENTITY_REFUSED", testCase.label);
      assert.equal(classified.body.retryable, false, testCase.label);
      assert.equal(String(classified.body.message).includes(current.envelope.runId), false, testCase.label);
      assert.equal(String(classified.body.message).includes(priorReceipt.receiptId), false, testCase.label);
    }
  });

  it("keeps an unexpected comparison authority exception as INTERNAL_FAILURE", () => {
    const [prior, current] = runPair();
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);
    let classified: ReturnType<typeof failureStatus>;

    try {
      buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: () => {
            throw new Error("receipt database read exploded");
          },
        },
      }, current.envelope.runId);
      throw new Error("unexpected comparison exception case succeeded");
    } catch (error) {
      classified = failureStatus(error);
    }

    assert.equal(classified.status, 500);
    assert.equal(classified.body.code, "INTERNAL_FAILURE");
    assert.equal(classified.body.retryable, false);
  });

  it("refuses a malformed run id before reading authority", () => {
    let readCount = 0;

    assert.throws(() => buildRunReceiptComparison({
      registry: REGISTRY,
      authority: {
        getRun: () => {
          readCount += 1;
          return undefined;
        },
        listReceiptsByRun: () => {
          readCount += 1;
          return [];
        },
      },
    }, "latest"));
    assert.equal(readCount, 0);
  });

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

  it("refuses every receipt identity dimension against its own run authority", () => {
    const [prior, current] = runPair();
    const priorReceipt = receiptFor(prior, "4502");
    const currentReceipt = receiptFor(current, "4537");
    const foreignRunId = uuidOf(9191);
    const foreignRetryOf = uuidOf(9292);
    const cases: readonly Readonly<{
      label: string;
      role: "current" | "prior";
      dimension: "runId" | "workflow" | "attempt" | "retryOf";
      priorReceipt: RunEvidenceReceipt;
      currentReceipt: RunEvidenceReceipt;
    }>[] = [
      {
        label: "current attempt",
        role: "current",
        dimension: "attempt",
        priorReceipt,
        currentReceipt: RunEvidenceReceiptSchema.parse({ ...currentReceipt, attempt: current.envelope.attempt + 1 }),
      },
      {
        label: "prior attempt",
        role: "prior",
        dimension: "attempt",
        priorReceipt: RunEvidenceReceiptSchema.parse({ ...priorReceipt, attempt: prior.envelope.attempt + 1 }),
        currentReceipt,
      },
      {
        label: "current workflow",
        role: "current",
        dimension: "workflow",
        priorReceipt,
        currentReceipt: RunEvidenceReceiptSchema.parse({ ...currentReceipt, workflowId: "person-lookup" }),
      },
      {
        label: "prior workflow",
        role: "prior",
        dimension: "workflow",
        priorReceipt: RunEvidenceReceiptSchema.parse({ ...priorReceipt, workflowId: "person-lookup" }),
        currentReceipt,
      },
      {
        label: "current run",
        role: "current",
        dimension: "runId",
        priorReceipt,
        currentReceipt: RunEvidenceReceiptSchema.parse({ ...currentReceipt, runId: foreignRunId }),
      },
      {
        label: "prior run",
        role: "prior",
        dimension: "runId",
        priorReceipt: RunEvidenceReceiptSchema.parse({ ...priorReceipt, runId: foreignRunId }),
        currentReceipt,
      },
      {
        label: "prior retry",
        role: "prior",
        dimension: "retryOf",
        priorReceipt: RunEvidenceReceiptSchema.parse({
          ...priorReceipt,
          retryOf: { state: "present", value: foreignRetryOf },
        }),
        currentReceipt,
      },
    ];
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);

    for (const testCase of cases) {
      assert.throws(
        () => buildRunReceiptComparison({
          registry: REGISTRY,
          authority: {
            getRun: (runId) => runs.get(runId),
            listReceiptsByRun: (runId) => runId === current.envelope.runId
              ? [testCase.currentReceipt]
              : [testCase.priorReceipt],
          },
        }, current.envelope.runId),
        new RegExp(`receipt comparison authority refused: ${testCase.role} receipt identity: ${testCase.dimension}`),
        testCase.label,
      );
    }
  });

  it("refuses missing retry authority and non-unique exact receipts by name", () => {
    const [prior, current] = runPair();
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);
    const authority = (currentReceipts: readonly RunEvidenceReceipt[]) => ({
      getRun: (runId: string) => runs.get(runId),
      listReceiptsByRun: (runId: string) => runId === current.envelope.runId
        ? currentReceipts
        : [receiptFor(prior, "4502")],
    });

    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runId === prior.envelope.runId ? prior : undefined,
          listReceiptsByRun: () => {
            throw new Error("a run without retryOf must not read receipt authority");
          },
        },
      }, prior.envelope.runId),
      new RegExp(`run ${prior.envelope.runId} names no retryOf run, so no prior receipt can be compared`),
    );

    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: {
          getRun: (runId) => runId === current.envelope.runId ? current : undefined,
          listReceiptsByRun: () => {
            throw new Error("a missing prior run must not read receipt authority");
          },
        },
      }, current.envelope.runId),
      /receipt comparison authority refused: retry authority: prior run/u,
    );

    assert.throws(
      () => buildRunReceiptComparison({ registry: REGISTRY, authority: authority([]) }, current.envelope.runId),
      /receipt comparison authority refused: current receipt cardinality/u,
    );

    const duplicate = receiptFor(current, "4537");
    assert.throws(
      () => buildRunReceiptComparison({
        registry: REGISTRY,
        authority: authority([duplicate, duplicate]),
      }, current.envelope.runId),
      /receipt comparison authority refused: current receipt cardinality/u,
    );
  });

  it("refuses the complete prior-receipt cardinality and identity matrix", () => {
    const [prior, current] = runPair();
    const priorReceipt = receiptFor(prior, "4502");
    const currentReceipt = receiptFor(current, "4537");
    const foreignRunId = uuidOf(9391);
    const foreignRetryOf = uuidOf(9392);
    const cases: readonly Readonly<{
      label: string;
      receipts: readonly RunEvidenceReceipt[];
      expected: RegExp;
    }>[] = [
      {
        label: "missing",
        receipts: [],
        expected: /receipt comparison authority refused: prior receipt cardinality/u,
      },
      {
        label: "duplicate",
        receipts: [priorReceipt, priorReceipt],
        expected: /receipt comparison authority refused: prior receipt cardinality/u,
      },
      {
        label: "foreign run",
        receipts: [RunEvidenceReceiptSchema.parse({ ...priorReceipt, runId: foreignRunId })],
        expected: /receipt comparison authority refused: prior receipt identity: runId/u,
      },
      {
        label: "mismatched workflow",
        receipts: [RunEvidenceReceiptSchema.parse({ ...priorReceipt, workflowId: "person-lookup" })],
        expected: /receipt comparison authority refused: prior receipt identity: workflow/u,
      },
      {
        label: "mismatched attempt",
        receipts: [RunEvidenceReceiptSchema.parse({ ...priorReceipt, attempt: prior.envelope.attempt + 1 })],
        expected: /receipt comparison authority refused: prior receipt identity: attempt/u,
      },
      {
        label: "mismatched retry identity",
        receipts: [RunEvidenceReceiptSchema.parse({
          ...priorReceipt,
          retryOf: { state: "present", value: foreignRetryOf },
        })],
        expected: /receipt comparison authority refused: prior receipt identity: retryOf/u,
      },
    ];
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);

    for (const testCase of cases) {
      assert.throws(
        () => buildRunReceiptComparison({
          registry: REGISTRY,
          authority: {
            getRun: (runId) => runs.get(runId),
            listReceiptsByRun: (runId) => runId === current.envelope.runId
              ? [currentReceipt]
              : testCase.receipts,
          },
        }, current.envelope.runId),
        testCase.expected,
        testCase.label,
      );
    }
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
      /receipt comparison authority refused: retry authority: itemId/u,
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
      /receipt comparison authority refused: retry authority: workflow/u,
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
      /receipt comparison authority refused: current receipt identity: runId/u,
    );
  });

  it("refuses a current receipt that does not bind the run's exact retryOf", () => {
    const [prior, current] = runPair();
    const currentReceipt = RunEvidenceReceiptSchema.parse({
      ...receiptFor(current, "4537"),
      retryOf: { state: "absent" },
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
          listReceiptsByRun: (runId) => runId === current.envelope.runId
            ? [currentReceipt]
            : [receiptFor(prior, "4502")],
        },
      }, current.envelope.runId),
      /receipt comparison authority refused: current receipt identity: retryOf/u,
    );
  });
});
