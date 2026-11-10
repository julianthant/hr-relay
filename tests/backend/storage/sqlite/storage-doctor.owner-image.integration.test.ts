import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSync, readSync, writeSync, closeSync, statSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { doctorAuthorityStorage, StorageDoctorObservationChangedError } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
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
        try { live.exec("PRAGMA wal_checkpoint(TRUNCATE)"); journalWrite(f); } finally { live.close(); }
        state.raced = true;
      }
    }
    return prepare.apply(this, args);
  });
  return state;
}

it("keeps a normal report when a live checkpoint or write hits every active-authority read", async () => {
  const f = await fixture();
  journalWrite(f);
  const census = checkpointDuringSnapshotRead(f);
  const baseline = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database);
  assert.equal(baseline.authority.state, "healthy");
  assert.equal(baseline.spanAuthority.state, "reconciled");
  vi.restoreAllMocks();
  assert.ok(census.snapshots >= 1, `the owner image is read (saw ${String(census.snapshots)})`);
  for (let raceAt = 1; raceAt <= census.snapshots; raceAt += 1) {
    const race = checkpointDuringSnapshotRead(f, raceAt);
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database);
    assert.equal(report.authority.state, "healthy", `snapshot read ${String(raceAt)}`);
    assert.equal(report.spanAuthority.state, "reconciled");
    assert.equal(race.raced, true);
    vi.restoreAllMocks();
  }
});

it("still reports a changed observation when a backup changes during its read", async () => {
  const f = await fixture();
  const service = new AuthorityBackupService(f.admission, f.database, { directory: f.options.backupDirectory }, systemClock);
  const taken = await service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  const manifest = taken.manifests[0];
  assert.ok(manifest);
  const backupPath = join(f.options.backupDirectory, manifest.backupFileName);
  const seen = new WeakSet<DatabaseSync>();
  let imageDirectory: string | undefined;
  let changed = false;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareDuringBackupChange(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
    const location = this.location() ?? "";
    if (!seen.has(this) && SNAPSHOT_DIRECTORY.test(location)) {
      seen.add(this);
      const directory = location.slice(0, location.lastIndexOf("/"));
      imageDirectory ??= directory;
      if (directory !== imageDirectory) {
        const live = new DatabaseSync(backupPath);
        try { live.exec("PRAGMA user_version=1"); } finally { live.close(); }
        changed = true;
      }
    }
    return prepare.apply(this, args);
  });
  await assert.rejects(doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database),
    (error: unknown) => error instanceof StorageDoctorObservationChangedError);
  assert.equal(changed, true);
});

it("still reports an unhealthy authority when a live page is corrupt", async () => {
  const f = await fixture();
  const checkpoint = new DatabaseSync(f.options.authorityPath);
  try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
  const size = statSync(f.options.authorityPath).size;
  assert.ok(size > 4096);
  const fd = openSync(f.options.authorityPath, "r+");
  try {
    const byte = Buffer.alloc(1);
    const offset = 4096 + 80;
    assert.equal(readSync(fd, byte, 0, 1, offset), 1);
    byte[0] ^= 0xff;
    assert.equal(writeSync(fd, byte, 0, 1, offset), 1);
  } finally { closeSync(fd); }
  const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database);
  assert.notEqual(report.authority.state, "healthy");
  const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore, f.database).run(context);
  assert.equal(observation.state, "unhealthy");
});

const BINDING_SQL = "FROM database_states WHERE id=1";

function duringBindingRead(f: Fixture, effect: () => void) {
  const state = { fired: false };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareDuringBinding(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
    if (!state.fired && String(args[0]).includes(BINDING_SQL) && SNAPSHOT_DIRECTORY.test(this.location() ?? "")) {
      state.fired = true;
      effect();
    }
    return prepare.apply(this, args);
  });
  return state;
}

it("keeps a verified backup restore-eligible when a checkpoint lands during the binding read", async () => {
  const f = await fixture();
  const service = new AuthorityBackupService(f.admission, f.database, { directory: f.options.backupDirectory }, systemClock);
  const taken = await service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  assert.ok(taken.manifests[0]);
  const race = duringBindingRead(f, () => {
    journalWrite(f);
    const live = new DatabaseSync(f.options.authorityPath);
    try { live.exec("PRAGMA busy_timeout=2000; PRAGMA wal_checkpoint(TRUNCATE)"); } finally { live.close(); }
  });
  const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database);
  assert.equal(race.fired, true);
  const candidate = report.restoreCandidates.find(entry => entry.state === "verified-compatible");
  if (candidate === undefined || candidate.state !== "verified-compatible") throw new Error("verified-backup-missing");
  assert.equal(candidate.restoreEligibility.state, "eligible");
});

it("refuses a verified backup when another database is renamed onto the path during the binding read", async () => {
  const f = await fixture();
  const service = new AuthorityBackupService(f.admission, f.database, { directory: f.options.backupDirectory }, systemClock);
  const taken = await service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  assert.ok(taken.manifests[0]);
  const replacement = `${f.options.authorityPath}.replacement`;
  const race = duringBindingRead(f, () => {
    copyFileSync(f.options.authorityPath, replacement);
    renameSync(replacement, f.options.authorityPath);
  });
  const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database);
  assert.equal(race.fired, true);
  const candidate = report.restoreCandidates.find(entry => entry.state === "verified-compatible");
  if (candidate === undefined || candidate.state !== "verified-compatible") throw new Error("verified-backup-missing");
  assert.equal(candidate.restoreEligibility.state, "unavailable");
});
