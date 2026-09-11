import { RunRecordService } from "../../../src/core/run-record-service.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { manualClock } from "../../../src/domain/clock.js";
export function createRunLifecycleStorage(database: AuthorityDatabase) {
  return new RunRecordService({ database, clock: manualClock(new Date(database.getMeta().updatedAt)),
    ids: {uuid: () => {throw new Error("archive-proof-cannot-allocate-run");}},
    publishQueued: () => {throw new Error("archive-proof-cannot-enqueue");},
  }).lifecycleStorage();
}
