import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, renameSync, unlinkSync } from "node:fs";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { ReadLaneWriteRefusedError, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import { workerExecArgv } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createDashboardReadHost } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { historyArchivePath } from "../../../../src/backend/storage/sqlite/isolated-history-store.js";
import { admitReadLane, openReadLane, prepareReadLaneStart, READ_LANE_OPEN_MODE } from "../../../../src/backend/storage/sqlite/read-lane-admission.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { importProfileLibrary } from "../../../../scripts/profiles/profile-copy.js";
import { LANE_READS_ENTRY, laneHistory, laneWrite } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture, openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The members a read lane answers; everything else on the admission must refuse. */
const READ_MEMBERS = ["assertLive", "assertReadable", "assertProfileRuntime", "assertAuthorityDatabase", "assertReadOnlyAuthorityDatabase",
  "assertAuthorityOpenMode", "assertStorageRootsSafe", "profileBinding", "stateRoot", "retainSourceClosure", "release"];

async function laneFixture() {
  const fixture = await openBoundDatabaseFixture("read-lane-admission");
  cleanups.push(() => fixture.close());
  return { fixture, start: prepareReadLaneStart(fixture.profile.admission, fixture.database, "navigation") };
}

it("refuses a wrong protocol by name in a worker started on Relay's lane entry", async () => {
  const { start } = await laneFixture();
  const worker = new Worker(new URL("../../../../src/backend/storage/sqlite/dashboard-read-lane.js", import.meta.url), {
    workerData: { ...start, protocol: "relay.dashboard-read-lane.v0" }, execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
  const [failure]: unknown[] = await once(worker, "error");
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /read-lane-protocol-mismatch/u);
});

it("refuses a protocol mismatch, a binding mismatch and an inode change between admission and open", async () => {
  const { fixture, start } = await laneFixture();
  assert.throws(() => admitReadLane({ ...start, protocol: "relay.dashboard-read-lane.v0" }), /read-lane-protocol-mismatch/u);
  assert.throws(() => admitReadLane({ protocol: start.protocol }), /lane|path|identity/u);
  assert.throws(() => admitReadLane({ ...start, cursorOffset: 3 }), /read-lane-history-cursor-mismatch/u);

  const foreign = admitReadLane({ ...start, binding: { ...start.binding, profileId: randomUUID() } });
  assert.throws(() => openReadLane(foreign, 250), /profile-database-binding-mismatch/u);
  foreign.admission.release();

  const admitted = admitReadLane(start);
  const held = `${fixture.path}.held`;
  renameSync(fixture.path, held);
  try {
    new DatabaseSync(held, { readOnly: true }).exec(`VACUUM INTO '${fixture.path}'`);
    chmodSync(fixture.path, 0o600);
    assert.throws(() => openReadLane(admitted, 250), /profile-database-open-source-changed/u);
  } finally { renameSync(held, fixture.path); }
  admitted.admission.release();

  const opened = openReadLane(admitReadLane(start), 250);
  assert.equal(opened.history, opened.native);
  opened.native.close();
});

it("refuses a group-writable source, a hard-linked source and a missing write-ahead log", async () => {
  const { fixture, start } = await laneFixture();
  chmodSync(fixture.path, 0o660);
  try { assert.throws(() => admitReadLane(start), /profile-database-identity-invalid/u); }
  finally { chmodSync(fixture.path, 0o600); }

  const link = `${fixture.path}.link`;
  linkSync(fixture.path, link);
  try { assert.throws(() => admitReadLane(start), /profile-database-identity-invalid/u); }
  finally { unlinkSync(link); }

  const wal = `${fixture.path}-wal`;
  renameSync(wal, `${wal}.held`);
  try { assert.throws(() => admitReadLane(start), /read-lane-wal-source-missing/u); }
  finally { renameSync(`${wal}.held`, wal); }
  admitReadLane(start).admission.release();
});

it("refuses a read-write open and every assertion a read lane does not answer", async () => {
  const { fixture, start } = await laneFixture();
  assert.throws(() => AuthorityDatabase.open(fixture.profile.admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "read-lane-admission",
    openMode: READ_LANE_OPEN_MODE }), /read-lane-open-mode-refused/u);
  const { admission } = admitReadLane(start);
  try {
    assert.throws(() => AuthorityDatabase.open(admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "read-lane-admission" }),
      (error: unknown) => error instanceof ReadLaneWriteRefusedError && error.member === "open:read-write");
    for (const openMode of ["storage-backup-read-only-no-migrate", "storage-doctor-read-only-no-migrate"]) {
      assert.throws(() => AuthorityDatabase.open(admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "read-lane-admission", openMode }),
        ReadLaneWriteRefusedError);
    }
    assert.throws(() => { admission.assertAuthorityDatabase(`${fixture.stateRoot}/other.db`); }, /read-lane-path-refused/u);
    admission.assertReadOnlyAuthorityDatabase(fixture.path);
    admission.assertProfileRuntime();

    const members = Object.keys(Object.getOwnPropertyDescriptors(RuntimeAdmission.prototype)).filter(member => member !== "constructor");
    for (const member of READ_MEMBERS) {
      assert.ok(members.includes(member), member);
      assert.equal(Object.getOwnPropertyDescriptor(admission, member), undefined, member);
    }
    const refused = members.filter(member => !READ_MEMBERS.includes(member));
    assert.ok(refused.length > 20);
    for (const member of refused) {
      assert.throws(() => {
        const value: unknown = Reflect.get(admission, member);
        if (typeof value === "function") Reflect.apply(value, admission, []);
      }, (error: unknown) => error instanceof ReadLaneWriteRefusedError && error.code === "read-lane-write-refused" && error.member === member, member);
    }
  } finally { admission.release(); }
});

it("answers writes through both lane connections with a refusal", async () => {
  const { fixture } = await laneFixture();
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  try {
    // Without an archive the history reader is the native connection, already inside the read's snapshot.
    const result = z.strictObject({ native: z.string(), history: z.string() }).parse(JSON.parse((await lanes.read(laneWrite, {})).body));
    assert.match(result.native, /cannot run inside an authority read snapshot/u);
    assert.match(result.history, /cannot run inside an authority read snapshot/u);
    assert.equal(fixture.database.authority.workerPools.get("person-lookup"), undefined);
  } finally { await lanes.close(); }
});

it("attaches a profile copy's history archive in the lane with the host's logical cursors, and the lane connection cannot write", async () => {
  const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, systemClock);
  const source = await openCurrentWorld();
  const destination = await createBoundProfileFixture();
  cleanups.push(() => destination.close());
  if (source.database.authority.runtimeConfig.get() === undefined) source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  source.database.authority.runs.enqueue(runRecordOf({ seed: 859, enqueuedAt: systemClock.now().toISOString() }));
  createNoteTimelineWriter({ repository: source.database.authority.timelineEvents, clock: systemClock }).emitNote({ workflow: "person-lookup",
    address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: "archived before copy" });
  await takeBackup(source);
  const binding = destination.admission.profileBinding;
  await destination.closeController();

  const lock = await acquireRuntimeLifetimeLock(0);
  cleanups.push(() => lock.close());
  const imported = await importProfileLibrary({ sourceWorkspace: source.workspace, targetWorkspace: destination.workspace,
    sourceProfile: source.admission.profileBinding.profileId }, lock);
  assert.ok(imported.history.timeline_events > 0);

  const machine = acquireEntrypointAdmission(destination.workspace, "exclusive", lock);
  cleanups.push(() => { machine.release(); });
  const admission = machine.admitProfile(binding.profileId);
  cleanups.push(() => { admission.release(); });
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
  const database = AuthorityDatabase.open(admission, { path: destination.path, busyTimeoutMs: 250, migrationOwner: "read-lane-history" },
    systemClock, undefined, undefined, undefined, credentials);
  cleanups.push(() => { database.close(); });
  createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock: systemClock }).emitNote({ workflow: "person-lookup",
    address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: "native after copy" });

  const history = database.dashboardHistory();
  const offset = history.timelineCursorOffset();
  assert.ok(offset > 0);
  const expected = { highWater: history.authority.timelineEvents.highWaterMark(), offset,
    records: history.authority.timelineEvents.page({ after: 0, limit: 1000 }) };
  assert.ok(expected.records.some(record => record.cursor <= offset));
  assert.ok(expected.records.some(record => record.cursor > offset));

  const start = prepareReadLaneStart(admission, database, "navigation");
  assert.deepEqual(start.historyArchive?.path, historyArchivePath(admission.stateRoot));
  assert.equal(start.cursorOffset, offset);
  const lanes = createDashboardReadHost({ admission, database, clock: systemClock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  try {
    assert.deepEqual(JSON.parse((await lanes.read(laneHistory, { after: 0, limit: 1000 })).body), JSON.parse(JSON.stringify(expected)));
    assert.deepEqual(JSON.parse((await lanes.read(laneWrite, {})).body), { native: "read-lane-write-refused", history: "isolated-history-read-only" });
  } finally { await lanes.close(); }

  assert.throws(() => openReadLane(admitReadLane({ ...start, cursorOffset: offset + 1 }), 250), /read-lane-history-cursor-mismatch/u);

  // The lane's history connection: read-only open, query_only off for its TEMP views, the archive attached read-only and immutable.
  const archive = historyArchivePath(admission.stateRoot);
  const connection = new DatabaseSync(destination.path, { readOnly: true });
  try {
    connection.exec("PRAGMA query_only=OFF");
    const url = pathToFileURL(archive);
    url.search = "mode=ro&immutable=1";
    connection.prepare("ATTACH DATABASE ? AS history").run(url.href);
    connection.exec("CREATE TEMP VIEW lane_probe AS SELECT 1 AS one");
    for (const sql of ["INSERT INTO main.commands DEFAULT VALUES", "DELETE FROM main.timeline_events", "DELETE FROM history.timeline_events",
      "CREATE TABLE main.lane_probe_table(x)", "CREATE TABLE history.lane_probe_table(x)"]) {
      assert.throws(() => connection.exec(sql), /readonly|read-only/u, sql);
    }
  } finally { connection.close(); }
});
