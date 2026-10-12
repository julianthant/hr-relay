
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { WorkerLeaseRecordSchema } from "../../../src/models/run/worker.js";

const STARTED = "2026-08-20T16:00:00.000Z";

function leaseOf(overrides: Readonly<Record<string, unknown>> = {}): ReturnType<typeof WorkerLeaseRecordSchema.parse> {
  return WorkerLeaseRecordSchema.parse({
    workerId: "person-lookup-worker-1",
    workflow: "person-lookup",
    browserSystems: ["ucpath"],
    processId: 1234,
    leaseGeneration: 1, controlRevision: 1,
    lifecycle: { state: "idle", startedAt: STARTED, heartbeatAt: "2026-08-20T16:00:30.000Z" },
    control: { directive: "run", requestedAt: STARTED, requestedBy: "local-operator" },
    version: 5,
    createdAt: STARTED,
    updatedAt: "2026-08-20T16:00:30.000Z",
    ...overrides,
  });
}
describe("the card the projector composes from a lease", () => {
  it("accepts the descriptor browser systems the worker persisted at launch", () => {
    const parsed = WorkerLeaseRecordSchema.safeParse({
      ...leaseOf(),
      browserSystems: ["kuali", "ucpath"],
    });

    assert.equal(parsed.success, true);
  });
});
