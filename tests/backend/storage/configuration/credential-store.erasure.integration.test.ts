import { observeCredentialPresence } from "../../../../src/backend/storage/configuration/credential-store.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";

import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { createCredentialPersistenceFixtures } from "../../../support/helpers/credential-persistence-fixtures.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "credential-erase-private-password";
const NOW = "2026-09-06T12:00:00.000Z";
const roots: string[] = [];
const { fixture, registeredFixture, releaseFixtures, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW);

afterEach(() => {
  releaseFixtures();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("credential history plaintext", () => {
  it("does not keep a cleared password in protected.json", () => {
    const stored = fixture();
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const cleared = stored.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { ucpathPassword: { clear: true } },
    }));
    assert.equal(cleared.state, "applied");
    assert.equal(stored.store.read().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
  });

  it("strips a restored password when the erasure journal survived the crash", () => {
    const stored = registeredFixture({ afterErasureJournal: () => { throw new Error("crash after journal"); } });
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 2,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const before = readFileSync(stored.path);
    assert.throws(() => stored.erase(CredentialEraseInputSchema.parse({
      commandId: COMMAND_2,
      commandFingerprint: "b".repeat(64),
      expectedRevision: 3,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_2,
      updatedAt: NOW,
    })), /crash after journal/);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    assert.equal(stored.recoverErasure().state, "applied");
    assert.equal(stored.readErasure().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    writeFileSync(stored.path, before, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.equal(stored.recoverErasure().state, "applied");
    assert.equal(stored.readErasure().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    assert.throws(() => stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: stored.readErasure().revision, entries: { ucpathPassword: { set: SECRET } } })));
    assert.throws(() => stored.retryErasure(CredentialEraseInputSchema.parse({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: stored.readErasure().revision, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: NOW })));
  });

  it("refuses an implicit version-two conversion outside an admitted conversion intent", () => {
    const stored = versionTwoFixture();
    const bytes = `${JSON.stringify(stored.document)}\n`;
    writeFileSync(stored.path, bytes, { mode: 0o600 });
    assert.throws(() => stored.store.read());
    assert.throws(() => stored.store.migrateHistory({ operation: stored.operation }));
    assert.equal(readFileSync(stored.path, "utf8"), bytes);
  });

  it("strips an older password generation restored after erasure", () => {
    const stored = registeredFixture();
    const first = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 2,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(first.state, "applied");
    const older = readFileSync(stored.path);
    const newer = stored.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 3,
      entries: { ucpathPassword: { set: "credential-erase-newer-password" } },
    }));
    assert.equal(newer.state, "applied");
    const erased = stored.erase(CredentialEraseInputSchema.parse({
      commandId: "33333333-3333-4333-8333-333333333333",
      commandFingerprint: "b".repeat(64),
      expectedRevision: 4,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      updatedAt: NOW,
    }));
    assert.equal(erased.state, "applied");
    writeFileSync(stored.path, older, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.equal(stored.recoverErasure().state, "applied");
    assert.equal(stored.readErasure().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    assert.throws(() => stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: stored.readErasure().revision, entries: { ucpathPassword: { set: SECRET } } })));
    assert.throws(() => stored.retryErasure(CredentialEraseInputSchema.parse({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: stored.readErasure().revision, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: NOW })));
  });

  it("does not treat a missing established erasure journal as empty", () => {
    const stored = registeredFixture();
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 2,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const older = readFileSync(stored.path);
    const erased = stored.erase(CredentialEraseInputSchema.parse({
      commandId: COMMAND_2,
      commandFingerprint: "b".repeat(64),
      expectedRevision: 3,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_2,
      updatedAt: NOW,
    }));
    assert.equal(erased.state, "applied");
    unlinkSync(stored.journalPath);
    writeFileSync(stored.path, older, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.throws(() => stored.readErasure(), /credential-erasure-head-missing/u);
  });
});


it("refuses a missing established erasure anchor and accepts the same restored anchor", () => {
  const stored = registeredFixture();
  assert.equal(stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 2, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
  assert.equal(stored.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2, commandFingerprint: "b".repeat(64), expectedRevision: 3,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: WRITE_2, updatedAt: NOW })).state, "applied");
  const anchor = `${stored.journalPath}.authority`;
  const bytes = readFileSync(anchor);
  const heldAnchor = `${anchor}.held`;
  renameSync(anchor, heldAnchor);
  assert.throws(() => stored.readErasure(), /credential-erasure-head-missing/u);
  writeFileSync(anchor, bytes, { mode: 0o600 });
  assert.throws(() => stored.readErasure(), /credential-erasure-head-changed/u);
  unlinkSync(anchor);
  renameSync(heldAnchor, anchor);
  assert.equal(stored.readErasure().entries.ucpathPassword, undefined);
});


it("keeps genuine private profile reads and writes beneath a sticky workspace while released authority refuses", () => {
  const stored = fixture();
  try {
    assert.equal(stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
    chmodSync(stored.stateRoot, 0o1777);
    assert.equal(stored.store.read().entries.ucpathPassword?.value, SECRET);
    assert.equal(stored.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2,
      expectedRevision: 2, entries: { ucpathPassword: { clear: true } } })).state, "applied");
    assert.equal(stored.store.read().entries.ucpathPassword, undefined);
    stored.admission.release();
    assert.throws(() => stored.store.read(), /released admission/u);
  } finally { chmodSync(stored.stateRoot, 0o700); }
});

it("refuses a substituted local journal ancestor before treating missing files as empty", () => {
  const stored = registeredFixture();
  assert.equal(stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
    expectedRevision: 2, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
  assert.equal(stored.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2,
    commandFingerprint: "b".repeat(64), expectedRevision: 3, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: WRITE_2, updatedAt: NOW })).state, "applied");
  assert.equal(stored.readErasure().entries.ucpathPassword, undefined);
  const directory = dirname(stored.journalPath);
  renameSync(directory, `${directory}-held`);
  mkdirSync(directory, { mode: 0o700 });
  assert.throws(() => stored.readErasure(), /credential-erasure-head-missing/u);
});


function versionTwoFixture() {
  const stored = fixture();
  const original = request({ commandId: COMMAND_1, writeId: WRITE_1,
    expectedRevision: 1, entries: { ucpathPassword: { set: SECRET } } });
  assert.equal(stored.store.apply(original).state, "applied");
  const record = stored.store.read();
  const password = record.entries.ucpathPassword;
  assert.ok(password !== undefined && record.lastApplied !== undefined);
  const document = { schemaVersion: 2, record, history: [{ request: original,
    setValueIds: { ucpathPassword: password.valueId } }] };
  return { ...stored, original, document, password, lastApplied: record.lastApplied };
}

it("requires explicit conversion before ordinary version-two read or replay", () => {
  const stored = versionTwoFixture();
  const bytes = `${JSON.stringify(stored.document)}\n`;
  writeFileSync(stored.path, bytes, { mode: 0o600 });
  assert.throws(() => stored.store.read());
  assert.throws(() => stored.store.verifyReplay(stored.original));
  assert.throws(() => stored.store.migrateHistory({ operation: stored.operation }));
  assert.equal(readFileSync(stored.path, "utf8"), bytes);
});

it.each(["value", "timestamp", "commandFingerprint", "expectedRevision", "protectedSchemaHash"] as const)(
  "refuses version-two %s corruption through ordinary reads and unadmitted conversion", corruption => {
    const stored = versionTwoFixture();
    const record = corruption === "value" || corruption === "timestamp"
      ? { ...stored.document.record, entries: { ...stored.document.record.entries,
        ucpathPassword: { ...stored.password, ...(corruption === "value"
          ? { value: "credential-erase-different-password" } : { updatedAt: "2026-09-06T12:01:00.000Z" }) } } }
      : { ...stored.document.record, lastApplied: { ...stored.lastApplied,
        ...(corruption === "commandFingerprint" ? { commandFingerprint: "9".repeat(64) }
          : corruption === "expectedRevision" ? { expectedRevision: 2 } : { protectedSchemaHash: "9".repeat(64) }) } };
    const bytes = `${JSON.stringify({ ...stored.document, record })}\n`;
    writeFileSync(stored.path, bytes, { mode: 0o600 });
    for (const observe of [() => stored.store.read(), () => stored.store.verifyReplay(stored.original),
      () => stored.store.migrateHistory({ operation: stored.operation })]) {
      assert.throws(observe);
      assert.equal(readFileSync(stored.path, "utf8"), bytes);
    }
  });

it.each(["commandFingerprint", "expectedRevision", "protectedSchemaHash"] as const)(
  "refuses legacy version-three lastApplied %s without ordinary compatibility reads", field => {
    const stored = versionTwoFixture();
    const record = { ...stored.document.record, lastApplied: { ...stored.lastApplied,
      ...(field === "commandFingerprint" ? { commandFingerprint: "9".repeat(64) }
        : field === "expectedRevision" ? { expectedRevision: 2 } : { protectedSchemaHash: "9".repeat(64) }) } };
    const bytes = `${JSON.stringify({ schemaVersion: 3, record, history: [{
      receipt: { ...stored.lastApplied, updatedAt: NOW, requestReceipt: "f".repeat(64) },
      marked: { ucpathPassword: { set: "<set>" } }, setValueIds: { ucpathPassword: stored.password.valueId },
    }] })}\n`;
    writeFileSync(stored.path, bytes, { mode: 0o600 });
    assert.throws(() => stored.store.read());
    assert.throws(() => stored.store.verifyReplay(stored.original));
    assert.equal(readFileSync(stored.path, "utf8"), bytes);
  });

it("refuses passive doctor presence when an exact external erasure advances between observations", async () => {
  const snapshot = createCredentialDoctorFixtures([]).snapshot;
  let captured: unknown, capturedControl: unknown, armed = false;
  const stored = registeredFixture({ betweenPresenceObservations: () => {
    if (!armed) return;
    armed = false;
    const erased = stored.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2, writeId: WRITE_2,
      commandFingerprint: "b".repeat(64), expectedRevision: stored.store.read().revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: NOW }));
    assert.equal(erased.state, "applied");
    writeFileSync(stored.path, originalCiphertext, { mode: 0o600 });
    assert.equal(readFileSync(stored.path).equals(originalCiphertext), true);
    captured = snapshot(stored.machine.stateRoot);
    capturedControl = snapshot(join(stored.stateRoot, ".tracker", "control"));
  } });
  const originalCiphertext = readFileSync(stored.path);
  armed = true;
  const report = await doctorAuthorityStorage(stored.admission, { stateRoot: stored.tracker, authorityPath: join(stored.tracker, "state.db"),
    stateRootTrustAnchor: stored.stateRoot, backupDirectory: join(stored.tracker, "backups", "authority"), busyTimeoutMs: 250 }, undefined, stored.store);
  assert.equal(report.protectedSettings.state, "unavailable");
  assert.ok(captured !== undefined);
  assert.ok(isDeepStrictEqual(snapshot(stored.machine.stateRoot), captured), "doctor changed external writer's settled bytes");
  assert.ok(isDeepStrictEqual(snapshot(join(stored.stateRoot, ".tracker", "control")), capturedControl), "doctor changed settled control bytes");
  assert.throws(() => observeCredentialPresence(stored.store, stored.admission), /profile-storage-claim-generation-changed/u);
});
