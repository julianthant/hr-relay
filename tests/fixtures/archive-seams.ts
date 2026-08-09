/**
 * The archive dependency blocks, built ONCE and shared by every harness that
 * needs them (D179) — the same reason `explorer-seams.ts` exists: two harnesses
 * that each assembled their own archive deps could drift into two different
 * answers about what "the archive" is, and the whole point of D80 is that there
 * is exactly one.
 */
import type { Clock } from "../../src/domain/clock.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import {
  createArchiveSnapshotSource,
  type ArchiveQueryDeps,
} from "../../src/server/dashboard/queries/archive.js";
import type { RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";

export interface ArchiveSeamDescriptor {
  readonly id: string;
  readonly label: string;
  readonly version: number;
  readonly contractFingerprint: string;
}

export function archiveQueryDeps(input: Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  appVersion: string;
  descriptors: readonly ArchiveSeamDescriptor[];
}>): ArchiveQueryDeps {
  return {
    clock: input.clock,
    appVersion: input.appVersion,
    authority: { withAuthorityTransaction: (work) => input.database.withAuthorityTransaction(work) },
    descriptors: { list: () => input.descriptors },
  };
}

export function archiveSnapshots(runDetail: RunDetailQueryDeps): ReturnType<typeof createArchiveSnapshotSource> {
  return createArchiveSnapshotSource(runDetail);
}
