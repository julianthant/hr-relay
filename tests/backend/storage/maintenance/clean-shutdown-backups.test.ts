import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { retainCleanShutdownBackups, resumeShutdownBackupRetirement } from "../../../../src/backend/storage/maintenance/clean-shutdown-backups.js";
import { backupLogPaths, verifyBackupBytesAtPath, verifyBackupManifestAtPath, type VerifiedBackup } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

vi.mock("../../../../src/backend/storage/admission/admission-identity.js", () => ({ requireRuntimeAdmission: (input: unknown) => input }));

vi.mock("../../../../src/backend/storage/sqlite/backup-service.js", async actual => {
  const service = await actual<typeof import("../../../../src/backend/storage/sqlite/backup-service.js")>();
  return { ...service, verifyBackupManifestAtPath: vi.fn(), verifyBackupBytesAtPath: vi.fn(service.verifyBackupBytesAtPath) };
});

const faults = vi.hoisted(() => ({ target: "" }));
vi.mock("node:fs", async actual => {
  const fs = await actual<typeof import("node:fs")>();
  return { ...fs, unlinkSync(path: Parameters<typeof fs.unlinkSync>[0]) {
    if (faults.target !== "" && String(path).endsWith(faults.target)) { faults.target = ""; throw new Error("interrupted shutdown backup retirement"); }
    return fs.unlinkSync(path);
  } };
});

/** `firstGeneration` numbers the six backups from it; `sameInstant` gives them one creation time, as a frozen clock does. */
function fixture(firstGeneration = 0, sameInstant = false, withLogs = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shutdown-backup-retention-"))), directory = join(root, "backups", "authority");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const proofs = new Map<string, VerifiedBackup>();
  const clock = manualClock(new Date("2026-11-02T12:00:00.000Z")), digest = createHash("sha256").update("db").digest("hex"), installationId = randomUUID(), profileId = randomUUID();
  const admission = { stateRoot: root, profileBinding: { installationId, profileId },
    assertAuthorityBackupWrite: (path: string) => assert.equal(path, directory),
    authorityBackupExpectedSource: () => ({ kind: "profile" as const, binding: { installationId, profileId } }) };
  // @ts-expect-error This pure filesystem test replaces issued admission and native verification.
  const retain = (fresh = newest()) => retainCleanShutdownBackups(admission, clock, fresh);
  const newest = () => { const proof = [...proofs.values()].find(value => value.manifest.authorityGeneration === firstGeneration + 4); assert.ok(proof); return proof; };
  // @ts-expect-error This pure filesystem test replaces issued admission and native verification.
  const resume = () => resumeShutdownBackupRetirement(admission, clock);
  const sourceIdentity = authoritySourceDatabaseIdentity({ kind: "profile", binding: { installationId, profileId } });
  for (let index = 0; index < 6; index++) {
    const backupFileName = `authority-g${firstGeneration + index}-20261101000000000-${randomUUID()}${index === 5 ? "" : ".shutdown"}.sqlite`;
    const observed = { applicationId: AUTHORITY_APPLICATION_ID, schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, installationId, profileId, pageCount: 1, authorityGeneration: firstGeneration + index, authorityContentFingerprint: digest };
    const manifest = AuthorityBackupManifestSchema.parse({ ...observed, kind: "hrauto-authority-backup", manifestVersion: 4, backupFileName,
      sourceDatabaseIdentity: sourceIdentity, createdAt: new Date(Date.parse("2026-11-01T12:00:00.000Z") + (sameInstant ? 0 : index * 1000)).toISOString(), byteSize: 2, sha256: digest,
      ...(withLogs ? { logFiles: { timeline: { byteSize: 2, sha256: digest }, dashboard: { byteSize: 2, sha256: digest } } } : {}),
      verification: { ...observed, state: "verified", observedFrom: "backup-copy", observedAt: clock.now().toISOString(), quickCheck: "ok", foreignKeyViolations: 0, invariantViolations: [], exactTableRegistry: true } });
    const backupPath = join(directory, backupFileName), manifestPath = `${backupPath}.manifest.json`;
    writeFileSync(backupPath, "db", { mode: 0o600 }); writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    if (withLogs) for (const path of backupLogPaths(backupPath)) writeFileSync(path, "db", { mode: 0o600 });
    proofs.set(manifestPath, { backupPath, manifestPath, manifest });
  }
  const before = new Map(readdirSync(directory).map(name => [name, readFileSync(join(directory, name))]));
  vi.mocked(verifyBackupManifestAtPath).mockImplementation(async (_owner, path) => {
    const proof = proofs.get(path.endsWith(".retiring") ? path.slice(0, -".retiring".length) : path); assert.ok(proof);
    return { ...proof, manifestPath: path };
  });
  vi.mocked(verifyBackupBytesAtPath).mockClear();
  return { retain, resume, directory, clock, proofs, before, close() {
    faults.target = ""; vi.restoreAllMocks(); vi.mocked(verifyBackupManifestAtPath).mockReset(); vi.mocked(verifyBackupBytesAtPath).mockClear(); rmSync(root, { recursive: true });
  } };
}

it("keeps the highest generation as the fresh backup when every backup has one creation time", async () => {
  const f = fixture(8, true);
  try {
    await f.retain();
    const remaining = readdirSync(f.directory);
    for (const proof of f.proofs.values()) if (proof.manifest.backupFileName.includes(".shutdown")) {
      assert.equal(remaining.includes(proof.manifest.backupFileName), proof.manifest.authorityGeneration >= 10, proof.manifest.backupFileName);
    }
  } finally { f.close(); }
});

for (const invalid of [false, true]) it(`retires only verified old shutdown pairs, preserving other backup classes (verification refusal: ${invalid})`, async () => {
  const f = fixture(), { directory, before, proofs } = f;
  const failure = new Error("mock native verification refused");
  if (invalid) vi.mocked(verifyBackupBytesAtPath).mockRejectedValueOnce(failure);
  try {
    if (invalid) { await assert.rejects(f.retain(), error => error === failure); assert.deepEqual(new Map(readdirSync(directory).map(name => [name, readFileSync(join(directory, name))])), before); }
    else {
      await f.retain();
      const remaining = readdirSync(directory); assert.equal(remaining.length, 8);
      for (const [path, proof] of proofs) {
        const present = remaining.includes(proof.manifest.backupFileName);
        assert.equal(present, proof.manifest.authorityGeneration >= 2);
        assert.equal(remaining.includes(path.slice(directory.length + 1)), present);
        if (present) { assert.deepEqual(readFileSync(proof.backupPath), before.get(proof.manifest.backupFileName)); assert.deepEqual(readFileSync(path), before.get(path.slice(directory.length + 1))); }
      }
    }
  } finally { f.close(); }
});

for (const target of [".shutdown.sqlite", ".retiring"]) it(`resumes the exact retirement after interruption before deleting ${target}`, async () => {
  const f = fixture(); faults.target = target;
  try {
    await assert.rejects(f.retain(), /interrupted shutdown backup retirement/u);
    assert.equal(readdirSync(f.directory).filter(name => name.endsWith(".retiring")).length, 1);
    await f.resume();
    await f.retain();
    assert.equal(readdirSync(f.directory).length, 8);
    assert.equal(readdirSync(f.directory).filter(name => name.endsWith(".retiring")).length, 0);
  } finally { f.close(); }
});

it("resumes a shutdown backup retirement interrupted between its log companions", async () => {
  const f = fixture(0, false, true);
  const doomed = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 1);
  assert.ok(doomed);
  faults.target = ".sqlite.dashboard.db";
  try {
    await assert.rejects(f.retain(), /interrupted shutdown backup retirement/u);
    assert.equal(readdirSync(f.directory).includes(doomed.manifest.backupFileName), true);
    assert.equal(readdirSync(f.directory).includes(`${doomed.manifest.backupFileName}.timeline.db`), false);
    await f.resume();
    await f.retain();
    assert.equal(readdirSync(f.directory).length, 16);
    assert.equal(readdirSync(f.directory).some(name => name.startsWith(doomed.manifest.backupFileName)), false);
  } finally { f.close(); }
});

for (const mutation of ["foreign-person", "missing-newer"]) it(`refuses changed retirement evidence without deletion: ${mutation}`, async () => {
  const f = fixture(); faults.target = ".shutdown.sqlite";
  try {
    await assert.rejects(f.retain(), /interrupted shutdown backup retirement/u);
    const name = readdirSync(f.directory).find(value => value.endsWith(".retiring")); assert.ok(name);
    const path = join(f.directory, name), record = AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (mutation === "foreign-person") {
      const profileId = randomUUID();
      writeFileSync(path, JSON.stringify({ ...record, profileId, verification: { ...record.verification, profileId } }), { mode: 0o600 });
    }
    else {
      const newer = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 4); assert.ok(newer);
      rmSync(newer.manifestPath);
    }
    const before = new Map(readdirSync(f.directory).map(value => [value, readFileSync(join(f.directory, value))]));
    await assert.rejects(f.resume(), /retirement-unproved/u);
    assert.deepEqual(new Map(readdirSync(f.directory).map(value => [value, readFileSync(join(f.directory, value))])), before);
  } finally { f.close(); }
});

for (const mutation of ["record", "backup"] as const) it(`refuses ${mutation} mutation after its byte check before deleting the backup`, async () => {
  const f = fixture(), doomed = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 1); assert.ok(doomed);
  const check = vi.mocked(verifyBackupBytesAtPath).getMockImplementation(); assert.ok(check);
  let changed = false;
  vi.mocked(verifyBackupBytesAtPath).mockImplementation(async (...args) => {
    await check(...args);
    if (!changed && args[0] === doomed.backupPath) {
      changed = true;
      const record = doomed.manifest;
      if (mutation === "record") writeFileSync(doomed.manifestPath, JSON.stringify({ ...record, authorityGeneration: record.authorityGeneration + 1,
        verification: { ...record.verification, authorityGeneration: record.authorityGeneration + 1 } }), { mode: 0o600 });
      else writeFileSync(doomed.backupPath, "changed backup bytes", { mode: 0o600 });
    }
  });
  try {
    await assert.rejects(f.retain(), /retirement-changed/u);
    assert.equal(changed, true); assert.equal(readFileSync(doomed.backupPath, "utf8"), mutation === "record" ? "db" : "changed backup bytes");
  } finally { f.close(); }
});

it("checks each quit-time backup's bytes once per quit and inspects none of them", async () => {
  const f = fixture(), fresh = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 4); assert.ok(fresh);
  try {
    await f.retain();
    assert.equal(vi.mocked(verifyBackupManifestAtPath).mock.calls.length, 0);
    const reads = new Map<number, number>();
    for (const [path] of vi.mocked(verifyBackupBytesAtPath).mock.calls) {
      const proof = [...f.proofs.values()].find(value => value.backupPath === path); assert.ok(proof);
      reads.set(proof.manifest.authorityGeneration, (reads.get(proof.manifest.authorityGeneration) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries(reads), { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 });
    assert.equal(readdirSync(f.directory).length, 8);
  } finally { f.close(); }
});

it("refuses retention without deletion when the fresh backup's bytes changed after its backup request verified them", async () => {
  const f = fixture(), fresh = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 4); assert.ok(fresh);
  try {
    writeFileSync(fresh.backupPath, "dx", { mode: 0o600 });
    const before = new Map(readdirSync(f.directory).map(name => [name, readFileSync(join(f.directory, name))]));
    await assert.rejects(f.retain(fresh));
    assert.deepEqual(new Map(readdirSync(f.directory).map(name => [name, readFileSync(join(f.directory, name))])), before);
  } finally { f.close(); }
});

it("removes no older backup unless the newest one was verified in this quit", async () => {
  const f = fixture(), older = [...f.proofs.values()].find(value => value.manifest.authorityGeneration === 3); assert.ok(older);
  try {
    await assert.rejects(f.retain(older), /retention-unproved/u);
    assert.deepEqual(new Map(readdirSync(f.directory).map(name => [name, readFileSync(join(f.directory, name))])), f.before);
  } finally { f.close(); }
});
