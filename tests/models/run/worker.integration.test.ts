
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WorkerLeaseRecordSchema } from "../../../src/models/run/worker.js";
import {
NOW
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
WORKFLOW_ID
} from "../../support/fixtures/phase1f-run-fixtures.js";

const WORKER_ID = `${WORKFLOW_ID}-worker-1`;

const LATER = "2026-07-31T17:05:00.000Z";

describe("worker leases", () => {

  it("refuses a stopped lease that still carries a run directive", () => {
    assert.throws(
      () => WorkerLeaseRecordSchema.parse({
        workerId: WORKER_ID,
        workflow: WORKFLOW_ID,
        processId: 1,
        browserSystems: [],
        controlRevision: 1,
        leaseGeneration: 1,
        lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: LATER, reason: "shutdown" },
        control: { directive: "run", requestedAt: NOW, requestedBy: "local-operator" },
        version: 1,
        createdAt: NOW,
        updatedAt: LATER,
      }),
      /cannot carry a run directive/,
    );
  });
});
