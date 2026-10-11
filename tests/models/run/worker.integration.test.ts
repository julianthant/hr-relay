
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { WorkerLeaseRecordSchema } from "../../../src/models/run/worker.js";
import {
NOW
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
WORKFLOW_ID
} from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const WORKER_ID = `${WORKFLOW_ID}-worker-1`;
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

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
