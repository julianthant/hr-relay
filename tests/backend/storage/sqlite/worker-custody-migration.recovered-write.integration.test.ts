import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { ExecutorSpanEventSchema, type ExecutorSpanEvent } from "../../../../src/backend/logs/span-emitter.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { inspectArtifactDeletionFile } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { authenticateParkedWriteResolution } from "../../../../src/rules/write-safety/parked-resolution.js";
import { WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { restorePredecessorCustodySchema, writePredecessorWorkerLifetimes } from "../../../support/fixtures/storage/predecessor-worker-custody.js";
import { migrateWorkerCustody } from "../../../support/helpers/storage/worker-custody-migration.js";

const { cleanup, roundTrip, parkedIntent, resolutionCommand } = createParkedWriteRoundTripTestWorld();
afterEach(cleanup);

type FenceSpan = Extract<ExecutorSpanEvent, { t: "transaction.fenced" }>;

/** A worker-claimed run whose UNKNOWN write was settled by an authenticated read-only recheck; `extra` spans join the timeline before it moves to schema 22. */
async function recovered(extra: (fence: FenceSpan) => readonly unknown[] = () => []) {
  const h = await roundTrip(); await h.park();
  const intent = parkedIntent(h.database);
  const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(run);
  const command = resolutionCommand("recheck-write", { runId: run.envelope.runId, expectedVersion: run.version,
    writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
  assert.equal(h.kernel.execute(command).state, "applied");
  h.world.probeResults.push({ state: "present", proof: { transactionId: "T998877" } });
  assert.equal((await h.resume()).outcomes[0]?.state, "done");
  const settled = h.database.authority.writeIntents.get(intent.writeIntentId);
  assert.ok(settled?.status === "committed" && settled.resolution !== undefined);
  const fence = h.spans().flatMap(event => event.t === "transaction.fenced" ? [event] : [])[0];
  assert.ok(fence);
  const timeline = createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock });
  // The worker's span sink persists the fence; the conversion reads it from the timeline.
  for (const event of [fence, ...extra(fence)]) timeline.emit(ExecutorSpanEventSchema.parse(event));
  const raw = new DatabaseSync(h.profile.path);
  raw.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  assert.notEqual(writePredecessorWorkerLifetimes(raw, WRITE_FIXTURE_RUN_ID).length, 0, "the run must be claimed with a worker lifetime");
  raw.exec("BEGIN EXCLUSIVE"); restorePredecessorCustodySchema(raw);
  raw.exec("UPDATE database_states SET schema_version=22; PRAGMA user_version=22; COMMIT");
  const migrate = () => migrateWorkerCustody(raw, WRITE_FIXTURE_NOW, ref => inspectArtifactDeletionFile(h.profile.admission, ref));
  return { h, raw, resolution: settled.resolution, migrate };
}

function writeEvidence(raw: DatabaseSync, resolution: { commandId: string; auditId: string }) {
  return [raw.prepare("SELECT * FROM write_intents ORDER BY id").all(), raw.prepare("SELECT * FROM write_attempts ORDER BY id").all(),
    raw.prepare("SELECT * FROM commands WHERE id=?").get(resolution.commandId), raw.prepare("SELECT * FROM command_audits WHERE id=?").get(resolution.auditId)];
}

it("keeps a recovered committed write with its parked attempt and authenticated recheck, ignoring a dry-run preview", async () => {
  const { raw, resolution, migrate } = await recovered(fence => {
    const { taskId: _taskId, ...preview } = fence;
    return [{ ...preview, t: "transaction.previewed", subject: "match", externalCommit: "none" }];
  });
  try {
    const before = writeEvidence(raw, resolution);
    migrate();
    assert.equal(raw.prepare("SELECT 1 FROM runs WHERE id=?").get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.ok(raw.prepare("SELECT 1 FROM deleted_runs WHERE run_id=?").get(WRITE_FIXTURE_RUN_ID));
    assert.deepEqual(writeEvidence(raw, resolution), before);
    const intent = nativeOrdinaryRecordFromRow("write_intents", raw.prepare("SELECT * FROM write_intents").get());
    const attempt = nativeOrdinaryRecordFromRow("write_attempts", raw.prepare("SELECT * FROM write_attempts").get());
    authenticateParkedWriteResolution(intent, attempt, commandFromRow(raw.prepare("SELECT * FROM commands WHERE id=?").get(resolution.commandId)),
      nativeOrdinaryRecordFromRow("command_audits", raw.prepare("SELECT * FROM command_audits WHERE id=?").get(resolution.auditId)));
  } finally { raw.close(); }
});

it("keeps the committed write evidence through a verified backup and the startup upgrade", async () => {
  const { h, raw, resolution } = await recovered();
  const before = writeEvidence(raw, resolution);
  raw.close();
  const profileId = h.profile.admission.profileBinding.profileId;
  h.database.close(); h.profile.admission.release();
  assert.equal((await upgradeProfileAtStartup(profileBrowserClosure, h.profile.machine, profileId, { primaryDisplay: null }, systemClock)).state, "upgraded");
  const after = new DatabaseSync(h.profile.path, { readOnly: true });
  try {
    assert.equal(after.prepare("SELECT 1 FROM runs WHERE id=?").get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.ok(after.prepare("SELECT 1 FROM deleted_runs WHERE run_id=?").get(WRITE_FIXTURE_RUN_ID));
    assert.deepEqual(writeEvidence(after, resolution), before);
    authenticateParkedWriteResolution(nativeOrdinaryRecordFromRow("write_intents", after.prepare("SELECT * FROM write_intents").get()),
      nativeOrdinaryRecordFromRow("write_attempts", after.prepare("SELECT * FROM write_attempts").get()),
      commandFromRow(after.prepare("SELECT * FROM commands WHERE id=?").get(resolution.commandId)),
      nativeOrdinaryRecordFromRow("command_audits", after.prepare("SELECT * FROM command_audits WHERE id=?").get(resolution.auditId)));
  } finally { after.close(); }
});

it("refuses a fence for another task that no committed write settles, beside a committed one", async () => {
  const { raw, migrate } = await recovered(fence => [{ ...fence, taskId: `${fence.taskId}-second` }]);
  try {
    const dump = () => ["runs", "commands", "command_audits", "write_intents", "write_attempts", "timeline_events", "deleted_runs"].map(table => raw.prepare(`SELECT * FROM ${table}`).all());
    const before = dump();
    assert.throws(migrate, /authority-upgrade-unresolved-writes/u);
    assert.deepEqual(dump(), before);
  } finally { raw.close(); }
});

it("refuses a later fence for the same task that the earlier committed write cannot settle", async () => {
  const { raw, migrate } = await recovered(fence => [{ ...fence, ts: new Date(Date.parse(fence.ts) + 1_000).toISOString() }]);
  try {
    const dump = () => ["runs", "commands", "command_audits", "write_intents", "write_attempts", "timeline_events", "deleted_runs"].map(table => raw.prepare(`SELECT * FROM ${table}`).all());
    const before = dump();
    assert.throws(migrate, /authority-upgrade-unresolved-writes/u);
    assert.deepEqual(dump(), before);
  } finally { raw.close(); }
});
