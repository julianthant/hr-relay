import { join } from "node:path";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../timeline-write-fixture.js";

export function openConfirmedRetentionDatabase(
  root: () => string,
  ts: string,
  commit: unknown,
  intent: { readonly runId: string },
  attempt: unknown,
) {
  const path = join(root(), "confirmed.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
    migrationOwner: "confirmed-retention-test" }, manualClock(new Date(ts)));
  seedAtomicWriteOwner(database, commit, path);
  database.authority.writeIntents.fenceAttempt({ intent, attempt });
  database.commitWriteAttempt(commit, atomicWriteCheckpoint(commit));
  const run = database.authority.runs.get(intent.runId);
  if (run === undefined) throw new Error("missing fixture owner");
  database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
  return { database, run, path };
}
