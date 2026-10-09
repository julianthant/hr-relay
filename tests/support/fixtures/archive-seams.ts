import { createArchiveSnapshotSource } from "../../../src/backend/runs/queries/archive-snapshot.js";
import { sqliteRunReader } from "../helpers/canonical-run-reader.js";

import type { Clock } from "../../../src/rules/time/clock.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import type { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import {
  type ArchiveQueryDeps,
} from "../../../src/backend/runs/queries/archive.js";
import type { RunDetailQueryDeps } from "../../../src/backend/runs/queries/run-detail.js";

export interface ArchiveSeamDescriptor {
  readonly id: string;
  readonly label: string;

  readonly code: string;
  readonly version: number;
  readonly contractFingerprint: string;
}

export function archiveQueryDeps(input: Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  appVersion: string;
  descriptors: readonly ArchiveSeamDescriptor[];
  /** Retained fixture argument; archive reads authenticate the frozen database section. */
  stateRoot?: string;
}>): ArchiveQueryDeps {
  return {
    reader: sqliteRunReader(input.database, input.clock),
    clock: input.clock,
    appVersion: input.appVersion,
    authority: { withAuthorityTransaction: (work) => input.database.withAuthorityTransaction(work) },
    descriptors: { list: () => input.descriptors },
    ledger: createTransactionHistory(input.database.authority),
  };
}

export function archiveSnapshots(runDetail: RunDetailQueryDeps): ReturnType<typeof createArchiveSnapshotSource> {
  if (runDetail.runReader === undefined) throw new Error("archive fixture requires its canonical run reader");
  return createArchiveSnapshotSource(runDetail);
}
