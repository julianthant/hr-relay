import { createWorkerLeaseFixtures } from "../../support/helpers/backend/worker-lease-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { WorkerLeaseRecordSchema } from "../../../src/models/run/worker.js";

const STARTED = "2026-08-20T16:00:00.000Z";

const { leaseOf } = createWorkerLeaseFixtures(STARTED);
describe("the card the projector composes from a lease", () => {
  it("accepts the descriptor browser systems the worker persisted at launch", () => {
    const parsed = WorkerLeaseRecordSchema.safeParse({
      ...leaseOf(),
      browserSystems: ["kuali", "ucpath"],
    });

    assert.equal(parsed.success, true);
  });
});
