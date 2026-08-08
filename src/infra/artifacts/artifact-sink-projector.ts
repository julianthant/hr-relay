/**
 * The one sink projector (doc 06 §4.1, doc 03 §2.1): pending outbox row →
 * exclusive sink lease → head-verified idempotent sink write → head + ack in
 * ONE authority transaction.
 *
 * Ordering is load-bearing, mirroring the ledger projector's lesson: the
 * FILE is replaced first, then the new hash and the acknowledgement commit
 * together. The two crash windows are both fail-closed:
 * - after the replace, before the head commits — the retry finds bytes the
 *   recorded head cannot vouch for and PARKS as a conflict (indistinguishable
 *   from an operator edit, and treated with the same respect);
 * - after the head, before... does not exist: head and ack are one
 *   transaction, so a row is never acknowledged against an unrecorded hash.
 *
 * The lease is LOCAL and exclusive — an `O_EXCL` lock file per sink — which
 * is exactly the scope doc 06 §4.1 names ("the local exclusive lease"). A
 * held lock refuses loudly rather than queueing behind an unknown holder;
 * the multi-worker story is 2j's soak, not silent contention here.
 */
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../../domain/clock.js";
import type { AuthorityRepositories } from "../sqlite/authority-database.js";
import type { ArtifactSink } from "./xlsx-retention-sink.js";

/**
 * Structurally identical to the executor's `RunArtifactProjector` seam — the
 * name is NOT imported because infra sits below core in the layer matrix;
 * the composition root proves the fit where the two meet.
 */
export interface ArtifactSinkProjector {
  projectOutbox(outboxIds: readonly string[]): Promise<Readonly<{ projected: number }>>;
}

export class ArtifactSinkBusyError extends Error {
  constructor(sinkId: string, lockPath: string) {
    super(`sink ${sinkId} is held by another projector (lock ${lockPath}); refusing to project concurrently`);
    this.name = "ArtifactSinkBusyError";
  }
}

export interface ArtifactSinkProjectorOptions {
  readonly authority: Pick<AuthorityRepositories, "artifactOutbox" | "artifactSinkHeads">;
  /** Head + ack must commit together; the caller supplies the one transaction door. */
  readonly withAuthorityTransaction: <Result>(work: () => Result) => Result;
  readonly sinks: Readonly<Partial<Record<string, ArtifactSink>>>;
  /** Where the per-sink lock files live; created on demand. */
  readonly lockDir: string;
  readonly clock: Clock;
}

export function createArtifactSinkProjector(options: ArtifactSinkProjectorOptions): ArtifactSinkProjector {
  const withSinkLock = async <Result>(sinkId: string, work: () => Promise<Result>): Promise<Result> => {
    await mkdir(options.lockDir, { recursive: true });
    const lockPath = join(options.lockDir, `${sinkId}.lock`);
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new ArtifactSinkBusyError(sinkId, lockPath);
      }
      throw error;
    }
    try {
      await handle.writeFile(`${String(process.pid)}\n${options.clock.now().toISOString()}\n`);
      return await work();
    } finally {
      await handle.close();
      await unlink(lockPath);
    }
  };

  return Object.freeze({
    async projectOutbox(outboxIds: readonly string[]) {
      let projected = 0;
      for (const outboxId of outboxIds) {
        const row = options.authority.artifactOutbox.get(outboxId);
        if (row === undefined) {
          throw new Error(`artifact outbox row ${outboxId} does not exist; nothing to project`);
        }
        // An already-acknowledged row is a completed fact, not an error —
        // this is what makes a resumed blocking projection idempotent.
        if (row.state === "projected") continue;
        const sink = options.sinks[row.sinkId];
        if (sink === undefined) {
          throw new Error(
            `no ${row.sinkId} sink is composed; a blocking projection cannot proceed without its sink`,
          );
        }
        await withSinkLock(row.sinkId, async () => {
          const head = options.authority.artifactSinkHeads.get(row.sinkId);
          const { contentSha256 } = await sink.project({ row, head });
          const projectedAt = options.clock.now().toISOString();
          options.withAuthorityTransaction(() => {
            options.authority.artifactSinkHeads.record({
              sinkId: row.sinkId,
              contentSha256,
              lastOutboxId: row.outboxId,
              projectedAt,
            });
            options.authority.artifactOutbox.markProjected({ outboxId: row.outboxId, projectedAt });
          });
        });
        projected += 1;
      }
      return Object.freeze({ projected });
    },
  });
}
