import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
export function createRunLifecycleStorage(database: AuthorityDatabase) {
  return new RunRecordService({ database, clock: manualClock(new Date(database.getMeta().updatedAt)),
    ids: {uuid: () => {throw new Error("archive-proof-cannot-allocate-run");}},
    publishQueued: () => {throw new Error("archive-proof-cannot-enqueue");},
  }).lifecycleStorage();
}
