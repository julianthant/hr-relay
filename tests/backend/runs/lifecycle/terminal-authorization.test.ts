
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildFailureTerminalAuthorization,
buildSuccessTerminalAuthorization,
buildTerminalAuthorization,
} from "../../../../src/backend/runs/lifecycle/terminal-authorization.js";
import { buildEntryValidationFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { LATER,NOW,UUID_6,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,RUN_ID,WORKER_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";

const RUNNING_RUN = RunRecordSchema.parse({
  ...QUEUED_RUN,
  lifecycle: {
    state: "running",
    workerId: WORKER_ID,
    claimedAt: NOW,
    heartbeatAt: NOW,
    currentNodeId: "searching",
  },
  claimGeneration: 3,
  version: 7,
});

function failureFor(run: unknown) {
  return buildEntryValidationFailureRecord({
    run,
    failureId: UUID_6,
    problems: ["missing context \"searching\""],
    occurredAt: LATER,
  });
}

describe("terminal authorization factory", () => {
  it("binds a successful consequence to its exact run, claim, version and result digest", () => {
    const evidence = kualiReceiptEvidence();
    const completed = RunRecordSchema.parse(evidence.run);
    const result = RunResultRecordSchema.parse(evidence.result);
    const running = RunRecordSchema.parse({
      ...completed,
      lifecycle: {
        state: "running", workerId: WORKER_ID,
        claimedAt: completed.envelope.enqueuedAt,
        heartbeatAt: completed.envelope.enqueuedAt,
        currentNodeId: "finalize-kuali",
      },
      claimGeneration: 3,
      version: 7,
      completion: undefined,
    });
    const authorization = buildSuccessTerminalAuthorization({
      run: running,
      authorizedAt: result.createdAt,
      consequence: { kind: "done", result },
    });
    assert.deepEqual(authorization, {
      kind: "done",
      runId: running.envelope.runId,
      workflowId: running.envelope.workflow,
      attempt: running.envelope.attempt,
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      expectedVersion: 7,
      claim: { workerId: WORKER_ID, claimGeneration: 3 },
      authorizedAt: result.createdAt,
      resultDigest: result.resultDigest,
    });
  });

  it("binds the failed arm to the exact run, claim, and pre-terminal version", () => {
    const failure = failureFor(RUNNING_RUN);
    const authorization = buildFailureTerminalAuthorization({
      run: RUNNING_RUN,
      authorizedAt: LATER,
      consequence: { kind: "failed", failure },
    });
    assert.deepEqual(authorization, {
      kind: "failed",
      runId: RUN_ID,
      workflowId: "person-lookup",
      attempt: 1,
      descriptorVersion: 1,
      contractFingerprint: RUNNING_RUN.envelope.contractFingerprint,
      expectedVersion: 7,
      claim: { workerId: WORKER_ID, claimGeneration: 3 },
      authorizedAt: LATER,
      failureId: UUID_6,
    });
  });

  it("refuses to authorize for a run that holds no claim", () => {
    const failure = failureFor(RUNNING_RUN);
    assert.throws(
      () => buildTerminalAuthorization({
        run: QUEUED_RUN,
        authorizedAt: LATER,
        consequence: { kind: "failed", failure },
      }),
      /holds no claim/,
    );
  });

  it("refuses a failure that does not identify the run being settled", () => {
    const foreign = failureFor(RunRecordSchema.parse({
      ...RUNNING_RUN,
      envelope: { ...RUNNING_RUN.envelope, runId: UUID_7 },
    }));
    assert.throws(
      () => buildTerminalAuthorization({
        run: RUNNING_RUN,
        authorizedAt: LATER,
        consequence: { kind: "failed", failure: foreign },
      }),
      /unrelated failure/,
    );
  });

  it("refuses an authorization instant before the run was enqueued", () => {
    const failure = failureFor(RUNNING_RUN);
    assert.throws(
      () => buildTerminalAuthorization({
        run: RUNNING_RUN,
        authorizedAt: "2020-01-01T00:00:00.000Z",
        consequence: { kind: "failed", failure },
      }),
      /predates its enqueue/,
    );
  });

  it("rejects a done consequence whose result binds different fingerprints", () => {
    // A structurally valid result for ANOTHER config snapshot must not be
    // authorizable against this run.
    assert.throws(
      () => buildSuccessTerminalAuthorization({
        run: RUNNING_RUN,
        authorizedAt: LATER,
        consequence: {
          kind: "done",
          result: {
            runId: RUN_ID,
            attempt: 1,
            workflowId: "person-lookup",
            descriptorVersion: 1,
            contractFingerprint: RUNNING_RUN.envelope.contractFingerprint,
            configFingerprint: RUNNING_RUN.envelope.contractFingerprint,
            configSnapshotId: RUNNING_RUN.envelope.configSnapshotId,
            resultSchemaHash: RUNNING_RUN.envelope.contractFingerprint,
            result: { schemaHash: RUNNING_RUN.envelope.contractFingerprint, value: {} },
            resultDigest: RUNNING_RUN.envelope.contractFingerprint,
            dependencies: [],
            dependencyDigest: RUNNING_RUN.envelope.contractFingerprint,
            createdAt: LATER,
          } as never,
        },
      }),
      /digest|does not bind|Invalid input/,
    );
  });
});
