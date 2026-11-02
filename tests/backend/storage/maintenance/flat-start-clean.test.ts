import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { initialProtectedStoreRecord } from "../../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { captureFlatArchiveSource, flatArchiveFiles, hash, StorageBackupSchema, writeFlatArchiveCopies } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { assertFlatStartCleanCredentials, assertFlatStartCleanFiles, FlatStartCleanIntentSchema, flatStartCleanPlan, readFlatStartCleanSource } from "../../../../src/backend/storage/maintenance/flat-start-clean.js";

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "flat-start-clean-files-")));
  const stateRoot = join(workspace, ".tracker", "data"), control = join(workspace, ".tracker", "control");
  const installationId = randomUUID(), operationId = randomUUID(), archive = join(control, "storage-backups", installationId);
  const protectedPath = join(stateRoot, "credentials", "protected.json");
  for (const path of [dirname(protectedPath), join(stateRoot, "artifacts"), join(stateRoot, "locks"), archive]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(protectedPath, canonicalJsonStringify({ schemaVersion: 2, record: initialProtectedStoreRecord(), history: [] }), { mode: 0o600 });
  writeFileSync(join(stateRoot, "state.db"), "opaque bytes; no native qualification claimed", { mode: 0o600 });
  writeFileSync(join(stateRoot, "artifacts", `${"a".repeat(64)}.artifact`), "old managed artifact", { mode: 0o600 });
  writeFileSync(join(stateRoot, ".runtime-owner.json"), "fixed owner", { mode: 0o600 });
  writeFileSync(join(control, "installation.json"), canonicalJsonStringify({ installationId }), { mode: 0o600 });
  const source = captureFlatArchiveSource({ workspace, stateRoot, installationId, operationId }).document;
  const bytes = Buffer.from(canonicalJsonStringify(source));
  writeFileSync(join(archive, "source.json"), bytes, { mode: 0o600 });
  writeFlatArchiveCopies(archive, source, () => undefined);
  const record = StorageBackupSchema.parse({ schemaVersion: 2, kind: "flat-native6-archive", installationId, operationId,
    sourceStateRoot: stateRoot, sourceDigest: hash(bytes), files: flatArchiveFiles(source) });
  const backupPath = join(archive, "backup.json"), backup = Buffer.from(canonicalJsonStringify(record));
  writeFileSync(backupPath, backup, { mode: 0o600 });
  const intent = FlatStartCleanIntentSchema.parse({ schemaVersion: 2, kind: "flat-start-clean", installationId, operationId,
    sourceDigest: hash(bytes), backup: { backupPath, backupDigest: hash(backup) }, credentialLayout: "flat-plaintext",
    pepperDigest: "a".repeat(64), timing: { launchTimeoutMs: 5000, closeProofMs: 3000 }, phase: "erasing", cursor: 0, pending: false });
  const plan = flatStartCleanPlan(source);
  function remove(index: number) {
    const member = plan[index]; assert.ok(member);
    const path = join(stateRoot, ...member.path.split("/").slice(1));
    if (member.kind === "directory") rmdirSync(path); else unlinkSync(path);
  }
  return { workspace, stateRoot, control, installationId, operationId, source, intent, plan, protectedPath, remove,
    close() { rmSync(workspace, { recursive: true }); } };
}

it("binds the verified archive to the exact installation, operation and source before erasure", () => {
  const f = fixture();
  try {
    assert.deepEqual(readFlatStartCleanSource(f.workspace, f.installationId, f.intent), f.source);
    for (const changed of [{ operationId: randomUUID() }, { sourceDigest: "0".repeat(64) }, { installationId: randomUUID() },
      { backup: { ...f.intent.backup, backupDigest: "0".repeat(64) } }, { cursor: f.plan.length + 1 },
      { cursor: f.plan.length, pending: true }, { phase: "publishing" as const }]) {
      assert.throws(() => readFlatStartCleanSource(f.workspace, f.installationId, { ...f.intent, ...changed }));
    }
    assertFlatStartCleanFiles(f.source, f.intent);
  } finally { f.close(); }
});

it("accepts only its exact deletion prefix, including both outcomes of the one pending member", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.plan.map(member => member.path), [
      `profile/artifacts/${"a".repeat(64)}.artifact`, "profile/credentials/protected.json", "profile/state.db", "profile/credentials",
    ]);
    for (let cursor = 0; cursor < f.plan.length; cursor++) {
      assertFlatStartCleanFiles(f.source, { ...f.intent, cursor, pending: false });
      assertFlatStartCleanFiles(f.source, { ...f.intent, cursor, pending: true });
      f.remove(cursor);
      assert.throws(() => assertFlatStartCleanFiles(f.source, { ...f.intent, cursor, pending: false }), /source-changed/u);
      assertFlatStartCleanFiles(f.source, { ...f.intent, cursor, pending: true });
      assertFlatStartCleanFiles(f.source, { ...f.intent, cursor: cursor + 1 });
    }
    assert.equal(existsSync(f.protectedPath), false);
    assert.equal(existsSync(join(f.stateRoot, "state.db")), false);
    assert.equal(existsSync(join(f.stateRoot, "artifacts", `${"a".repeat(64)}.artifact`)), false);
    assert.equal(readFileSync(join(f.stateRoot, ".runtime-owner.json"), "utf8"), "fixed owner");
    assert.equal(existsSync(join(f.stateRoot, "artifacts")), true);
    assert.equal(existsSync(join(f.stateRoot, "locks")), true);
    assert.deepEqual(readFlatStartCleanSource(f.workspace, f.installationId, f.intent), f.source);
  } finally { f.close(); }
});

for (const change of ["missing-later", "changed-later", "unknown-source", "unknown-control", "changed-control", "reappeared-prefix"] as const) {
  it(`refuses ${change} before accepting the next effect`, () => {
    const f = fixture();
    try {
      const later = f.plan.findIndex(member => member.path === "profile/state.db"); assert.ok(later > 0);
      if (change === "missing-later") f.remove(later);
      if (change === "changed-later") writeFileSync(join(f.stateRoot, "state.db"), "changed", { mode: 0o600 });
      if (change === "unknown-source") writeFileSync(join(f.stateRoot, "unknown"), "unknown", { mode: 0o600 });
      if (change === "unknown-control") writeFileSync(join(f.control, "unknown"), "unknown", { mode: 0o600 });
      if (change === "changed-control") writeFileSync(join(f.control, "installation.json"), "changed", { mode: 0o600 });
      assert.throws(() => assertFlatStartCleanFiles(f.source, { ...f.intent, cursor: change === "reappeared-prefix" ? 1 : 0, pending: true }), /changed/u);
    } finally { f.close(); }
  });
}

it("admits only the finite plaintext credential layout and refuses an encrypted or native-key identity", () => {
  const f = fixture();
  try {
    assertFlatStartCleanCredentials(f.source);
    for (const value of [{ schemaVersion: 4, algorithm: "aes-256-gcm", ciphertext: "unknown" },
      { schemaVersion: 2, record: initialProtectedStoreRecord(), history: [], keyId: randomUUID() }]) {
      writeFileSync(f.protectedPath, canonicalJsonStringify(value), { mode: 0o600 });
      const source = captureFlatArchiveSource({ workspace: f.workspace, stateRoot: f.stateRoot, installationId: f.installationId, operationId: f.operationId }).document;
      assert.throws(() => assertFlatStartCleanCredentials(source), /credential-layout-unsupported/u);
      assert.equal(existsSync(join(f.stateRoot, "state.db")), true);
    }
  } finally { f.close(); }
});

it("admits only the finite empty-publication paths after every old member is erased", () => {
  const f = fixture();
  try {
    for (let index = 0; index < f.plan.length; index++) f.remove(index);
    const machine = join(f.stateRoot, "machine"); mkdirSync(machine, { mode: 0o700 });
    writeFileSync(join(machine, "profiles.json"), "pending exact publication validation", { mode: 0o600 });
    assert.throws(() => assertFlatStartCleanFiles(f.source, { ...f.intent, cursor: f.plan.length }), /membership-changed/u);
    assertFlatStartCleanFiles(f.source, { ...f.intent, cursor: f.plan.length, phase: "publishing" });
    writeFileSync(join(machine, "unknown"), "unknown", { mode: 0o600 });
    assert.throws(() => assertFlatStartCleanFiles(f.source, { ...f.intent, cursor: f.plan.length, phase: "publishing" }), /membership-changed/u);
  } finally { f.close(); }
});

it("refuses a symlinked credential ancestor before reading matching private credential bytes", () => {
  const f = fixture();
  try {
    const credentials = join(f.stateRoot, "credentials"), retained = join(f.workspace, "retained-credentials");
    renameSync(credentials, retained); symlinkSync(retained, credentials, "dir");
    assert.throws(() => assertFlatStartCleanCredentials(f.source), /symbolic link/u);
    assert.equal(existsSync(join(f.stateRoot, "state.db")), true);
    assert.equal(readFileSync(join(retained, "protected.json"), "utf8"), canonicalJsonStringify({ schemaVersion: 2, record: initialProtectedStoreRecord(), history: [] }));
  } finally { f.close(); }
});
