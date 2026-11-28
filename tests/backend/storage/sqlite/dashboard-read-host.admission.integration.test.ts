import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { chmodSync, copyFileSync, linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { ReadLaneWriteRefusedError, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import { workerExecArgv } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthoritySnapshotChangedError } from "../../../../src/backend/storage/sqlite/authority-errors.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { createDashboardReadHost, ReadLaneStartError } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { historyArchivePath } from "../../../../src/backend/storage/sqlite/isolated-history-store.js";
import { admitReadLane, openReadLane, prepareReadLaneStart, READ_LANE_OPEN_MODE } from "../../../../src/backend/storage/sqlite/read-lane-admission.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { importProfileLibrary } from "../../../../scripts/profiles/profile-copy.js";
import { LANE_READS_ENTRY, laneHistory, laneRunPage, laneSleep, laneSnapshotChanged, laneStuck, laneWrite } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture, openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The members a read lane answers; everything else on the admission must refuse. */
const READ_MEMBERS = ["assertLive", "assertReadable", "assertProfileRuntime", "assertAuthorityDatabase", "assertReadOnlyAuthorityDatabase", "assertCheckpointOnlyDatabase",
  "assertAuthorityOpenMode", "assertStorageRootsSafe", "profileBinding", "stateRoot", "retainSourceClosure", "release"];

async function laneFixture() {
  const fixture = await openBoundDatabaseFixture("read-lane-admission");
  cleanups.push(() => fixture.close());
  return { fixture, start: prepareReadLaneStart(fixture.profile.admission, fixture.database, "navigation") };
}

it("refuses a wrong protocol by name in a worker started on Relay's lane entry", async () => {
  const { start } = await laneFixture();
  const worker = new Worker(new URL("../../../../src/backend/storage/sqlite/dashboard-read-lane.js", import.meta.url), {
    workerData: { start: { ...start, protocol: "relay.dashboard-read-lane.v0" }, gate: new Int32Array(new SharedArrayBuffer(4)), clock: "host" }, execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
  const failure = await new Promise<unknown>(resolve => worker.once("error", resolve));
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

it("proves a read's source when it begins and before it returns, not per statement, and refuses a read whose source changed", async () => {
  const { fixture, start } = await laneFixture();
  const admitted = admitReadLane(start);
  const opened = openReadLane(admitted, 250);
  cleanups.push(() => { opened.native.close(); admitted.admission.release(); });
  const held = `${fixture.path}.held`;
  const replace = () => {
    renameSync(fixture.path, held);
    new DatabaseSync(held, { readOnly: true }).exec(`VACUUM INTO '${fixture.path}'`);
    chmodSync(fixture.path, 0o600);
  };
  const restore = () => { unlinkSync(fixture.path); renameSync(held, fixture.path); };
  const { schemaVersion } = opened.history.getMeta();
  assert.equal(opened.history.withAuthorityReadSnapshot(() => admitted.withProvedSource(() => opened.history.getMeta().schemaVersion)), schemaVersion);

  let readInside = false;
  try {
    assert.throws(() => opened.history.withAuthorityReadSnapshot(() => admitted.withProvedSource(() => {
      replace();
      opened.history.getMeta();
      readInside = true;
    })), /profile-database-open-source-changed/u);
  } finally { restore(); }
  assert.ok(readInside, "a statement inside the read does not re-prove the source");

  replace();
  try { assert.throws(() => opened.history.getMeta(), /profile-database-open-source-changed/u, "outside a read every statement still proves it"); }
  finally { restore(); }
  assert.equal(opened.history.getMeta().schemaVersion, schemaVersion);
  assert.throws(() => admitted.withProvedSource(() => admitted.withProvedSource(() => 0)), /read-lane-source-proof-nested/u);
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

it("grants the checkpoint-only connection to the navigation lane alone", async () => {
  const { fixture, start } = await laneFixture();
  assert.throws(() => { fixture.profile.admission.assertCheckpointOnlyDatabase(fixture.path); }, /read-lane-checkpoint-admission-required/u);
  const search = prepareReadLaneStart(fixture.profile.admission, fixture.database, "search");
  assert.equal(search.checkpoint, false);
  assert.throws(() => admitReadLane({ ...search, checkpoint: true }), /read-lane-checkpoint-refused/u);
  assert.throws(() => admitReadLane({ ...start, checkpoint: false }), /read-lane-checkpoint-refused/u);
  const lanes = [admitReadLane(start), admitReadLane(search)];
  try {
    lanes[0].admission.assertCheckpointOnlyDatabase(fixture.path);
    assert.throws(() => { lanes[0].admission.assertCheckpointOnlyDatabase(`${fixture.stateRoot}/other.db`); }, /read-lane-path-refused/u);
    assert.throws(() => { lanes[1].admission.assertCheckpointOnlyDatabase(fixture.path); },
      (error: unknown) => error instanceof ReadLaneWriteRefusedError && error.member === "checkpoint-only");
  } finally { for (const lane of lanes) lane.admission.release(); }
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

it.skipIf(process.platform === "win32")("reuses reply custody until the WAL changes or the lane restarts", async () => {
  const { fixture } = await laneFixture();
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes: ["navigation"],
    checkpoint: { thresholdBytes: Number.MAX_SAFE_INTEGER }, entry: LANE_READS_ENTRY });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  const registry = join(fixture.profile.machine.stateRoot, "machine", "profiles.json");
  const open = fs.openSync;
  let registryReads = 0;
  const observeRegistry = vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (path === registry) registryReads++;
    return open(path, flags, mode);
  });
  syncBuiltinESMExports();
  const read = () => lanes.read(laneSleep, { tag: "custody", ms: 0 });
  const assertReusedCustody = async () => {
    // SQLite readers can update WAL shared memory even without a new commit.
    for (let attempt = 0; attempt < 5; attempt++) {
      const unchanged = fixture.profile.admission.observeDashboardReadCustody(fixture.path);
      assert.ok(unchanged);
      await read();
      const first = registryReads;
      await read();
      if (unchanged()) {
        assert.equal(registryReads, first, "the next reply reuses unchanged custody");
        return;
      }
    }
    assert.fail("no pair of reads with unchanged custody");
  };
  try {
    await read();
    assert.ok(registryReads > 0);
    await assertReusedCustody();

    fixture.database.authority.workerPools.plan({ workflow: "person-lookup", desiredWorkers: 1, expectedVersion: 0, requestedBy: "local-operator",
      now: systemClock.now().toISOString() });
    const afterCommit = registryReads;
    await read();
    const afterProof = registryReads;
    assert.ok(afterProof > afterCommit, "the WAL commit requires a fresh proof");
    await assertReusedCustody();

    await assert.rejects(lanes.read(laneStuck, {}), /read-lane-restarted/u);
    const afterRestart = registryReads;
    await read();
    assert.ok(registryReads > afterRestart, "the replacement lane proves its first reply");
  } finally { observeRegistry.mockRestore(); syncBuiltinESMExports(); }
});

it("refuses replies after in-place profile evidence changes or replacement of the lane database", async () => {
  const { fixture } = await laneFixture();
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  const read = () => lanes.read(laneSleep, { tag: "custody", ms: 0 });
  try {
    await read();
    const registry = join(fixture.profile.machine.stateRoot, "machine", "profiles.json");
    const saved = readFileSync(registry);
    writeFileSync(registry, "invalid profile evidence");
    try { await assert.rejects(read(), SyntaxError); }
    finally { writeFileSync(registry, saved); }
    await read();

    const held = `${fixture.path}.held`;
    renameSync(fixture.path, held);
    try {
      copyFileSync(held, fixture.path);
      await assert.rejects(read(), (error: unknown) => error instanceof Error && error.constructor === Error
        && error.message === "profile-database-open-source-changed");
    } finally { renameSync(held, fixture.path); }
    await read();
  } finally { await lanes.close(); }
});

it("carries a changed-snapshot refusal across the lane reply as the typed, retryable error, and the lane keeps serving", async () => {
  const { fixture } = await laneFixture();
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  try {
    const refused = await lanes.read(laneSnapshotChanged, {}).then(() => undefined, (error: unknown) => error);
    assert.ok(refused instanceof AuthoritySnapshotChangedError);
    assert.equal(refused.code, "STORAGE_SNAPSHOT_CHANGED");
    const mapped = failureStatus(refused);
    assert.equal(mapped.status, 503);
    assert.equal(lanes.status().restarts, 0);
    assert.equal(z.strictObject({ native: z.string(), history: z.string() }).parse(JSON.parse((await lanes.read(laneWrite, {})).body)).native,
      "authority mutation cannot run inside an authority read snapshot");
  } finally { await lanes.close(); }
});

it("pages runs through TEMP tables without an archive while the lane's connection still refuses writes to main", async () => {
  const { fixture } = await laneFixture();
  const database = fixture.database;
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  for (const seed of [859, 860, 861]) database.authority.runs.enqueue(runRecordOf({ seed, enqueuedAt: systemClock.now().toISOString() }));
  const expected = database.authority.runs.listPage({ offset: 0, limit: 10 }).map(run => run.envelope.runId);
  assert.equal(expected.length, 3);
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database, clock: systemClock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  try {
    const PageSchema = z.strictObject({ archive: z.boolean(), runIds: z.array(z.string()) });
    const page = (offset: number, limit: number) => lanes.read(laneRunPage, { offset, limit }).then(reply => PageSchema.parse(JSON.parse(reply.body)));
    assert.deepEqual(await page(0, 10), { archive: false, runIds: expected });
    assert.deepEqual(await page(1, 1), { archive: false, runIds: expected.slice(1, 2) });
    const refused = z.strictObject({ native: z.string(), history: z.string() }).parse(JSON.parse((await lanes.read(laneWrite, {})).body));
    assert.notEqual(refused.native, "written");
    assert.notEqual(refused.history, "written");
    assert.equal(database.authority.workerPools.get("person-lookup"), undefined);
  } finally { await lanes.close(); }

  // The lane's native connection: opened through its admission, TEMP writes allowed, trusted_schema off, main refused by the read-only open.
  const lane = openReadLane(admitReadLane(prepareReadLaneStart(fixture.profile.admission, database, "navigation")), 250);
  try {
    assert.equal(lane.history, lane.native);
    assert.deepEqual(lane.native.authority.runs.listPage({ offset: 0, limit: 10 }).map(run => run.envelope.runId), expected);
    assert.throws(() => { lane.native.authority.workerPools.plan({ workflow: "person-lookup", desiredWorkers: 9, expectedVersion: 0,
      requestedBy: "local-operator", now: systemClock.now().toISOString() }); }, /read-lane-write-refused/u);
  } finally { lane.native.close(); }
  const connection = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    connection.exec("PRAGMA query_only=OFF; PRAGMA trusted_schema=OFF");
    connection.exec("CREATE TEMP TABLE lane_probe_page(position INTEGER PRIMARY KEY,run_id TEXT NOT NULL UNIQUE); INSERT INTO lane_probe_page SELECT NULL,id FROM runs");
    assert.equal(connection.prepare("SELECT count(*) AS n FROM lane_probe_page").get()?.n, 3);
    assert.equal(connection.prepare("PRAGMA trusted_schema").get()?.trusted_schema, 0);
    for (const sql of ["INSERT INTO main.commands DEFAULT VALUES", "DELETE FROM main.runs", "CREATE TABLE main.lane_probe_table(x)"]) {
      assert.throws(() => connection.exec(sql), /readonly|read-only/u, sql);
    }
  } finally { connection.close(); }
  assert.equal(database.authority.runs.listPage({ offset: 0, limit: 10 }).length, 3);
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
    // The history reader's snapshot is paired with the native connection's, so a native write meets that snapshot before the lane's admission.
    assert.deepEqual(JSON.parse((await lanes.read(laneWrite, {})).body),
      { native: "authority mutation cannot run inside an authority read snapshot", history: "isolated-history-read-only" });
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

  // A lane only validates the archive: an outdated one, or one missing a native index, is refused and left unchanged.
  const onArchive = <T>(use: (edit: DatabaseSync) => T) => { const edit = new DatabaseSync(archive); try { return use(edit); } finally { edit.close(); } };
  const stale = (sql: string) => { onArchive(edit => { edit.exec(sql); }); };
  const nativeIndexes = new DatabaseSync(destination.path, { readOnly: true });
  const required = (() => { try {
    return nativeIndexes.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()
      .map(row => z.object({ name: z.string() }).parse(row).name);
  } finally { nativeIndexes.close(); } })();
  // One native index the archive carries; without it the archive needs an upgrade.
  const index = onArchive(edit => z.object({ name: z.string(), sql: z.string() }).parse(edit.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name IN (SELECT value FROM json_each(?)) ORDER BY name LIMIT 1")
    .get(JSON.stringify(required))));
  for (const [damage, repair] of [[`DROP INDEX ${index.name}`, index.sql],
    ["UPDATE history_header SET schema_version=schema_version-1", "UPDATE history_header SET schema_version=schema_version+1"]] as const) {
    stale(damage);
    const before = { bytes: readFileSync(archive), mtimeMs: statSync(archive).mtimeMs };
    assert.throws(() => openReadLane(admitReadLane(start), 250), /isolated-history-upgrade-required/u, damage);
    assert.deepEqual({ bytes: readFileSync(archive), mtimeMs: statSync(archive).mtimeMs }, before, damage);
    stale(repair);
  }
});

it("joins an already started lane before a partial start failure lets the store close", async () => {
  const fixture = await openBoundDatabaseFixture("read-lane-partial-start");
  const retain: unknown = Reflect.get(AuthorityDatabase.prototype, "retainDashboardReadSource");
  if (typeof retain !== "function") throw new Error("fixture retainDashboardReadSource missing");
  let calls = 0;
  const spy = vi.spyOn(AuthorityDatabase.prototype, "retainDashboardReadSource").mockImplementation(function (this: AuthorityDatabase, ...args) {
    if (++calls === 2) throw new Error("injected-second-lane-failure");
    const release: unknown = Reflect.apply(retain, this, args);
    if (typeof release !== "function") throw new Error("fixture lane source release missing");
    return () => { Reflect.apply(release, undefined, []); };
  });
  let failure: unknown;
  try {
    // Only a parallel start launches a second lane while the first is already running.
    createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, entry: LANE_READS_ENTRY, start: "parallel" });
  } catch (error) { failure = error; } finally { spy.mockRestore(); }
  assert.ok(failure instanceof ReadLaneStartError);
  assert.match(failure.message, /injected-second-lane-failure/u);
  // The navigation lane started and still holds its source until it exits.
  assert.throws(() => { fixture.database.close(); }, /dashboard-background-reader-open/u);
  await failure.exited;
  await fixture.close();
});
