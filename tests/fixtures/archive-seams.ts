/**
 * The archive dependency blocks, built ONCE and shared by every harness that
 * needs them (D179) — the same reason `explorer-seams.ts` exists: two harnesses
 * that each assembled their own archive deps could drift into two different
 * answers about what "the archive" is, and the whole point of D80 is that there
 * is exactly one.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../../src/domain/clock.js";
import { createLedgerReadThrough } from "../../src/infra/ledger/ledger-read-through.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import {
  createArchiveSnapshotSource,
  type ArchiveQueryDeps,
} from "../../src/server/dashboard/queries/archive.js";
import type { RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";

export interface ArchiveSeamDescriptor {
  readonly id: string;
  readonly label: string;
  /** the short code the version registry prints beside the label (D242) */
  readonly code: string;
  readonly version: number;
  readonly contractFingerprint: string;
}

export function archiveQueryDeps(input: Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  appVersion: string;
  descriptors: readonly ArchiveSeamDescriptor[];
  /**
   * The state root the ledger read-through opens. A test that omits it gets
   * the PRODUCTION reader over a directory that does not exist, so every
   * pointer resolves to a named `partition-missing` — which is the honest
   * answer for a world with no ledger, and never a silently empty card.
   */
  stateRoot?: string;
}>): ArchiveQueryDeps {
  return {
    clock: input.clock,
    appVersion: input.appVersion,
    authority: { withAuthorityTransaction: (work) => input.database.withAuthorityTransaction(work) },
    descriptors: { list: () => input.descriptors },
    ledger: createLedgerReadThrough(input.stateRoot ?? join(tmpdir(), "hrauto-no-ledger")),
  };
}

export function archiveSnapshots(runDetail: RunDetailQueryDeps): ReturnType<typeof createArchiveSnapshotSource> {
  return createArchiveSnapshotSource(runDetail);
}
