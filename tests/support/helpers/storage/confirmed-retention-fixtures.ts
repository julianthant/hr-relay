import assert from "node:assert/strict";
import { testRunService } from "../../fixtures/run-lifecycle-fixtures.js";
import { fixtureUuid } from "../../fixtures/ledger-projection-fixtures.js";
import { separationsDescriptor } from "../registered-workflows.js";
import { boundProfileAdmission } from "../admission-fixture.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../timeline-write-fixture.js";

export function openConfirmedRetentionDatabase(
  path: string,
  ts: string,
  commit: unknown,
  intent: { readonly runId: string },
  attempt: unknown,
) {
  boundProfileAdmission(path);
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
    migrationOwner: "confirmed-retention-test" }, manualClock(new Date(ts)));
  seedAtomicWriteOwner(database, commit, path);
  fenceWriteFixture(database, { intent, attempt });
  database.commitWriteAttempt(commit, atomicWriteCheckpoint(commit));
  const run = database.authority.runs.get(intent.runId);
  if (run === undefined) throw new Error("missing fixture owner");
  const service=testRunService(database,manualClock(new Date(ts)));
  const requested=service.transition({ commandId:fixtureUuid("retention-cancel-request"),runId:run.envelope.runId,expectedVersion:run.version,
    lifecycle:{state:"terminal",outcome:"cancelled",endedAt:ts} });
  assert.equal(requested.state,"applied");
  if(requested.state!=="applied" || !("workerId" in requested.run.lifecycle))throw new Error("retention fixture cancellation claim unavailable");
  const terminal=service.terminalize({kind:"cancelled",commandId:fixtureUuid("retention-cancel-settle"),runId:run.envelope.runId,
    expectedVersion:requested.run.version,claim:{workerId:requested.run.lifecycle.workerId,claimGeneration:requested.run.claimGeneration},endedAt:ts},separationsDescriptor);
  assert.equal(terminal.state,"applied");
  if(terminal.state!=="applied")throw new Error("retention fixture cancellation refused");
  assert.ok(database.authority.runResults.get(run.envelope.runId));
  return { database, run:terminal.run, path };
}
