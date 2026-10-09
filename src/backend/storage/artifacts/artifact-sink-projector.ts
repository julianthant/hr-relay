// Replace the file before atomically committing head and ack; an interrupted replace is an explicit conflict, never an automatic overwrite.
import { mkdir, open, unlink } from "node:fs/promises";
import type { Clock } from "../../../rules/time/clock.js";
import type { AuthorityRepositories } from "../sqlite/authority-database.js";
import { ArtifactSinkConflictError, type ArtifactSink } from "./xlsx-retention-sink.js";


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
  readonly authority: Pick<AuthorityRepositories, "artifactOutbox" | "artifactSinkHeads" | "generatedArtifacts">;
  /** Head + ack must commit together; the caller supplies the one transaction door. */
  readonly withAuthorityTransaction: <Result>(work: () => Result) => Result;
  readonly sinks: Readonly<Partial<Record<string, ArtifactSink>>>;
  /** Existing composition root; destination locks are beside the canonical workbook. */
  readonly lockDir: string;
  readonly clock: Clock;
  readonly fault?: (point: "before-settlement" | "after-head" | "after-ack") => void;
}

export function createArtifactSinkProjector(options: ArtifactSinkProjectorOptions): ArtifactSinkProjector {
  const withSinkLock = async <Result>(sinkId: string, sink: ArtifactSink, work: () => Promise<Result>): Promise<Result> => {
    await mkdir(options.lockDir, { recursive: true });
    const lockPath = await sink.writerLockPath();
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
        const settled = await withSinkLock(row.sinkId, sink, async () => {
          const current = options.authority.artifactOutbox.get(outboxId);
          if (current === undefined) throw new Error("generated-artifact-update-disappeared");
          if (current.state === "projected") return false;
          const first = options.authority.artifactOutbox.listPending().find((pending) => pending.sinkId === row.sinkId);
          if (first?.outboxId !== row.outboxId) throw new Error("generated-artifact-out-of-order");
          const head = options.authority.artifactSinkHeads.get(row.sinkId);
          const identity = { sinkId: row.sinkId, updateId: row.outboxId, expectedGeneration: head?.generation ?? 0 };
          const publication = options.authority.generatedArtifacts.publication;
          publication.assertAvailable(identity);
          try {
            let prepared = false;
            const version = options.authority.generatedArtifacts.get(`sink:${row.sinkId}`)?.versions.at(-1);
            const previousArtifact = version?.state === "verified" ? version.artifact : undefined;
            const { contentSha256, artifact } = await sink.project({ row, head, previousArtifact, prepare: (artifact) => {
              publication.prepare({ ...identity, artifact });
              prepared = true;
            }, assertPrepared: artifact => publication.assertPrepared({ ...identity, artifact }) });
            if (!prepared) throw new Error("generated-artifact-publication-not-prepared");
            options.fault?.("before-settlement");
            const projectedAt = options.clock.now().toISOString();
            options.withAuthorityTransaction(() => {
              options.authority.artifactSinkHeads.record({
                sinkId: row.sinkId,
                contentSha256, artifact, expectedGeneration: head?.generation ?? 0,
                lastOutboxId: row.outboxId,
                projectedAt,
              });
              options.fault?.("after-head");
              options.authority.artifactOutbox.markProjected({ outboxId: row.outboxId, projectedAt });
              options.fault?.("after-ack");
            });
            return true;
          } catch (error) {
            publication.fail({ ...identity, state: error instanceof ArtifactSinkConflictError ? "conflict" : "failed" });
            throw error;
          }
        });
        if (settled) projected += 1;
      }
      return Object.freeze({ projected });
    },
  });
}
