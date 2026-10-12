

import { WorkerLeaseRecordSchema } from "../../../../src/models/run/worker.js";

export function createWorkerLeaseFixtures(STARTED: string) {
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
  return { leaseOf };
}
