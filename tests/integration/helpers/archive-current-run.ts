import assert from "node:assert/strict";
import type { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import type { ArchiveReport } from "../../../src/domain/archive/report.js";
import { createRunLifecycleStorage } from "../../../src/backend/storage/sqlite/lifecycle-storage.js";
import { captureArchiveReport } from "../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/backend/storage/archive-transfer.js";
/** Real current custody protocol for no-file unit fixtures. */
export function archiveCurrentRun(database:AuthorityDatabase,run:RunRecord,capturedAt:string,transferId:string,sections:ArchiveReport["content"]["sections"]=[]) {
  const storage=createRunLifecycleStorage(database);
  const report=captureArchiveReport({snapshot:storage.capture(run.envelope.runId),capturedAt,transferId,sections,files:[]});
  assert.ok(transferArchiveReport(storage,report,run.version));
  assert.equal(database.authority.runs.get(run.envelope.runId),undefined);
  assert.equal(database.authority.deletedRuns.get(run.envelope.runId),undefined);
  return report;
}
