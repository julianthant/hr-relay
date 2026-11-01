import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock, bindWorkerProcessAdmission, observeRuntimeLockSnapshot, WorkerProcessCustodyUncertainError } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const refuseChildClose of [false, true]) it(`closes actual profile storage before failed worker admission releases process custody (${refuseChildClose ? "unproved child" : "proved child"})`, async () => {
  const f = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(f.workspace, "process-locks");
  const initial = acquireRuntimeProcessLock({ processLockRoot, name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: f.path } }, clock);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.admission.authorityBackupExpectedSource());
  const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
  const events: string[] = [];
  const fault = new Error("synthetic worker admission refusal");
  try {
    assert.throws(() => bindWorkerProcessAdmission({ processLockRoot, authorityPath: f.path, pid: process.pid, clock, initialCustody: initial,
      open: () => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "child-custody-test" }, clock),
      admit: database => { assert.equal(database.getMeta().profileId, f.admission.profileBinding.profileId); throw fault; },
      close: database => { assert.equal(snapshot().processLocks.workers.state, "active"); database.close(); events.push("database closed"); },
      releaseStorageCustody: () => {
        assert.equal(snapshot().processLocks.workers.state, "active");
        assert.deepEqual(events, ["database closed"]);
        if (refuseChildClose) throw new Error("synthetic child release refusal");
        f.admission.release();
        events.push("child released");
      },
    }), error => refuseChildClose ? error instanceof WorkerProcessCustodyUncertainError && error.cause === fault : error === fault);
    assert.equal(snapshot().processLocks.workers.state, refuseChildClose ? "active" : "stopped");
    if (refuseChildClose) f.admission.assertLive();
    else assert.throws(() => f.admission.assertLive());
    assert.deepEqual(events, refuseChildClose ? ["database closed"] : ["database closed", "child released"]);
  } finally { f.admission.release(); initial.release(); await f.close(); }
});

it("retains the opened database, profile and process when startup proof has unproved source closure", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(f.workspace, "process-locks");
  const initial = acquireRuntimeProcessLock({ processLockRoot, name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: f.path } }, clock);
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "child-custody-test" }, clock);
  const failure = new AuthoritySourceClosureUnprovedError([new Error("synthetic source close failure")]);
  const closed: string[] = [];
  try {
    assert.throws(() => bindWorkerProcessAdmission({ processLockRoot, authorityPath: f.path, pid: process.pid, clock, initialCustody: initial,
      open: () => database, admit: () => { throw failure; }, close: () => { closed.push("database"); },
      releaseStorageCustody: () => { closed.push("profile"); } }), WorkerProcessCustodyUncertainError);
    assert.deepEqual(closed, []); f.admission.assertLive(); assert.ok(database.getMeta());
    assert.equal(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.admission.authorityBackupExpectedSource()) }, clock).processLocks.workers.state, "active");
  } finally { database.close(); initial.release(); await f.close(); }
});
