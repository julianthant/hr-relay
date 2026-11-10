import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { doctorAuthorityStorage, StorageDoctorObservationChangedError } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { PreflightObservationChangedError } from "../../../../src/rules/preflight/preflight-admission.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
const { fixture } = createCredentialDoctorFixtures(cleanups);
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const context = { signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only" as const };
const SNAPSHOT_DIRECTORY = /relay-readonly-authority-/u;

type Fixture = Awaited<ReturnType<typeof fixture>>;

function journalWrite(f: Fixture): void {
  f.database.authority.notifications.create({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "e"),
    trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice",
    summary: "Concurrent fixture write", links: [{ kind: "run", runId: UUID_1 }], count: 1, lastSeenAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW });
}

/** Counts read-only snapshot databases the doctor opens; while snapshot `raceAt` is being read, checkpoints the live WAL.
 * A checkpoint rewrites the live files without changing the authority identity, like the concurrent writers a busy dashboard has. */
function checkpointDuringSnapshotRead(f: Fixture, raceAt?: number) {
  const seen = new WeakSet<DatabaseSync>();
  const state = { snapshots: 0, raced: false };
  // Captured before the prototype probe and invoked below with its original connection.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareDuringRace(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
    if (!seen.has(this) && SNAPSHOT_DIRECTORY.test(this.location() ?? "")) {
      seen.add(this);
      state.snapshots += 1;
      if (state.snapshots === raceAt) {
        const live = new DatabaseSync(f.options.authorityPath);
        try { live.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { live.close(); }
        state.raced = true;
      }
    }
    return prepare.apply(this, args);
  });
  return state;
}

it("reports a live file change during every doctor snapshot read as a changed observation, never an unhealthy report", async () => {
  const f = await fixture();
  journalWrite(f);
  const census = checkpointDuringSnapshotRead(f);
  const baseline = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
  assert.equal(baseline.authority.state, "healthy");
  assert.equal(baseline.spanAuthority.state, "reconciled");
  vi.restoreAllMocks();
  assert.ok(census.snapshots >= 4, `the doctor reads at least authority, timeline, span and upgrade snapshots (saw ${String(census.snapshots)})`);

  for (let raceAt = 1; raceAt <= census.snapshots; raceAt += 1) {
    journalWrite(f);
    const race = checkpointDuringSnapshotRead(f, raceAt);
    await assert.rejects(doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore),
      (error: unknown) => error instanceof StorageDoctorObservationChangedError, `snapshot read ${String(raceAt)}`);
    assert.equal(race.raced, true);
    vi.restoreAllMocks();
  }
  assert.equal((await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore)).authority.state, "healthy");
});

it("maps a copy race into the preflight observation refusal at the authority.health runner", async () => {
  const f = await fixture();
  journalWrite(f);
  const census = checkpointDuringSnapshotRead(f);
  await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
  vi.restoreAllMocks();
  const runner = new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore);
  for (let raceAt = 1; raceAt <= census.snapshots; raceAt += 1) {
    journalWrite(f);
    checkpointDuringSnapshotRead(f, raceAt);
    await assert.rejects(runner.run(context), PreflightObservationChangedError, `snapshot read ${String(raceAt)}`);
    vi.restoreAllMocks();
  }
  const healthy = await runner.run(context);
  assert.equal(healthy.state, "healthy");
});
