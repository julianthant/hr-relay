import assert from "node:assert/strict";
import childProcesses from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync, readSync, writeSync, closeSync, statSync, copyFileSync, renameSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { doctorAuthorityStorage, StorageDoctorObservationChangedError } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
const { fixture } = createCredentialDoctorFixtures(cleanups);
const actualSpawn = childProcesses.spawnSync;
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
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

async function backupChangedDuringRead(f: Fixture, owner: Fixture["database"] | undefined) {
  const service = new AuthorityBackupService(f.admission, f.database, { directory: f.options.backupDirectory }, systemClock);
  const taken = await service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  const manifest = taken.manifests.at(-1);
  assert.ok(manifest);
  const backupPath = join(f.options.backupDirectory, manifest.backupFileName);
  const readers = new Set<string>();
  let changed = false;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  const reading = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareDuringBackupChange(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
    const location = this.location() ?? "";
    if (!changed && readers.has(location)) {
      changed = true;
      const live = new DatabaseSync(backupPath);
      try { live.exec("PRAGMA user_version=1"); } finally { live.close(); }
    }
    return prepare.apply(this, args);
  });
  const copying = vi.spyOn(childProcesses, "spawnSync").mockImplementation((command, args, options) => {
    if (Array.isArray(args) && typeof args[3] === "string" && typeof args[4] === "string") {
      try {
        const sources = z.array(z.object({ path: z.string() })).safeParse(JSON.parse(args[4]));
        if (sources.success && sources.data.some(source => source.path === backupPath)) readers.add(args[3]);
      } catch { /* a different child, not the backup copy */ }
    }
    return actualSpawn(command, args, options);
  });
  syncBuiltinESMExports();
  try {
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, owner);
    assert.equal(changed, true);
    const candidate = report.restoreCandidates.find(entry => entry.state === "invalid");
    if (report.backup.state !== "invalid" || candidate?.state !== "invalid") {
      return { backup: report.backup.state, code: "", candidate: candidate?.state ?? "absent", candidateCode: "" };
    }
    return { backup: report.backup.state, code: report.backup.cause.code, candidate: candidate.state, candidateCode: candidate.cause.code };
  } finally { reading.mockRestore(); copying.mockRestore(); syncBuiltinESMExports(); }
}

it("reports the same invalid backup when the backup changes during its read with or without an owner", async () => {
  const f = await fixture();
  const withoutOwner = await backupChangedDuringRead(f, undefined);
  const withOwner = await backupChangedDuringRead(f, f.database);
  assert.deepEqual(withOwner, withoutOwner);
  assert.deepEqual(withoutOwner, { backup: "invalid", code: "backup-invalid", candidate: "invalid", candidateCode: "backup-invalid" });
});

function corruptTablePage(path: string): void {
  const checkpoint = new DatabaseSync(path);
  try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
  const fd = openSync(path, "r+");
  try {
    const header = Buffer.alloc(100);
    assert.equal(readSync(fd, header, 0, 100, 0), 100);
    const declared = header.readUInt16BE(16);
    const pageSize = declared === 1 ? 65536 : declared;
    assert.ok(pageSize >= 512);
    const size = statSync(path).size;
    const type = Buffer.alloc(1);
    let chosen: number | undefined;
    for (let offset = pageSize; offset + 1 <= size; offset += pageSize) {
      assert.equal(readSync(fd, type, 0, 1, offset), 1);
      if (type[0] === 0x0d || type[0] === 0x05) { chosen = offset; break; }
    }
    if (chosen === undefined) throw new Error("no table page to corrupt");
    type[0] = 0x00;
    assert.equal(writeSync(fd, type, 0, 1, chosen), 1);
  } finally { closeSync(fd); }
}

it("still reports an unhealthy authority when a live page is corrupt", async () => {
  const f = await fixture();
  corruptTablePage(f.options.authorityPath);
  for (const owner of [undefined, f.database]) {
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, owner);
    assert.notEqual(report.authority.state, "healthy");
    const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore, owner).run(context);
    assert.equal(observation.state, "unhealthy");
  }
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
  await assert.rejects(doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore, f.database),
    (error: unknown) => error instanceof StorageDoctorObservationChangedError);
  assert.equal(race.fired, true);
});
