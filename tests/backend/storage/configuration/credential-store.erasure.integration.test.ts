import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "vitest";

import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createCredentialStore, CredentialErasureAuthorityError } from "../../../../src/backend/storage/configuration/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { createCredentialPersistenceFixtures } from "../../../support/helpers/credential-persistence-fixtures.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "credential-erase-private-password";
const NOW = "2026-09-06T12:00:00.000Z";
const roots: string[] = [];
const { fixture, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW);

afterEach(() => {
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
    const stored = fixture({ afterErasureJournal: () => { throw new Error("crash after journal"); } });
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const before = readFileSync(stored.path);
    assert.throws(() => stored.store.erase(CredentialEraseInputSchema.parse({
      commandId: COMMAND_2,
      commandFingerprint: "3".repeat(64),
      expectedRevision: 2,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_2,
      updatedAt: NOW,
    })), /crash after journal/);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), true);
    assert.equal(stored.store.read().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    writeFileSync(stored.path, before, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.equal(stored.store.read().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    const replay = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: stored.store.read().revision,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(replay.state, "rejected");
    if (replay.state === "rejected") assert.equal(replay.code, "command-divergent");
  });

  it("migrates a version-2 credential document without leaving historical plaintext", () => {
    const stored = fixture();
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const document = JSON.parse(readFileSync(stored.path, "utf8")) as {
      schemaVersion: number;
      history: { setValueIds?: unknown }[];
    };
    document.schemaVersion = 2;
    document.history = document.history.map((entry) => ({
      request: {
        commandId: COMMAND_1,
        commandFingerprint: "1".repeat(64),
        expectedRevision: 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: WRITE_1,
        updatedAt: NOW,
        entries: { ucpathPassword: { set: SECRET } },
      },
      setValueIds: entry.setValueIds,
    }));
    writeFileSync(stored.path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    stored.store.migrateHistory();
    const migrated = readFileSync(stored.path, "utf8");
    assert.equal(migrated.includes(`"schemaVersion":2`), false);
    assert.equal(migrated.includes(SECRET), true);
    const parsed = JSON.parse(migrated) as { history: readonly { request?: unknown }[] };
    assert.equal(parsed.history.some((entry) => entry.request !== undefined), false);
  });

  it("strips an older password generation restored after erasure", () => {
    const stored = fixture();
    const first = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(first.state, "applied");
    const older = readFileSync(stored.path);
    const newer = stored.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { ucpathPassword: { set: "credential-erase-newer-password" } },
    }));
    assert.equal(newer.state, "applied");
    const erased = stored.store.erase(CredentialEraseInputSchema.parse({
      commandId: "33333333-3333-4333-8333-333333333333",
      commandFingerprint: "3".repeat(64),
      expectedRevision: 3,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      updatedAt: NOW,
    }));
    assert.equal(erased.state, "applied");
    writeFileSync(stored.path, older, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.equal(stored.store.read().entries.ucpathPassword, undefined);
    assert.equal(readFileSync(stored.path, "utf8").includes(SECRET), false);
    const replay = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: stored.store.read().revision,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(replay.state, "rejected");
    if (replay.state === "rejected") assert.equal(replay.code, "command-divergent");
  });

  it("does not treat a missing established erasure journal as empty", () => {
    const stored = fixture();
    const applied = stored.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: SECRET } },
    }));
    assert.equal(applied.state, "applied");
    const older = readFileSync(stored.path);
    const erased = stored.store.erase(CredentialEraseInputSchema.parse({
      commandId: COMMAND_2,
      commandFingerprint: "3".repeat(64),
      expectedRevision: 2,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_2,
      updatedAt: NOW,
    }));
    assert.equal(erased.state, "applied");
    unlinkSync(join(stored.tracker, "credential-erasures", "journal.json"));
    writeFileSync(stored.path, older, { mode: 0o600 });
    chmodSync(stored.path, 0o600);
    assert.throws(() => stored.store.read(), CredentialErasureAuthorityError);
  });
});


it("refuses a missing established erasure anchor and accepts the same restored anchor", () => {
  const stored = fixture();
  assert.equal(stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
  assert.equal(stored.store.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2, commandFingerprint: "3".repeat(64), expectedRevision: 2,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: WRITE_2, updatedAt: NOW })).state, "applied");
  const anchor = join(stored.tracker, "credential-erasures", "journal.json.authority");
  const bytes = readFileSync(anchor); unlinkSync(anchor);
  assert.throws(() => stored.store.read(), CredentialErasureAuthorityError);
  writeFileSync(anchor, bytes, { mode: 0o600 });
  assert.equal(stored.store.read().entries.ucpathPassword, undefined);
});


it("keeps local sticky-ancestor reads live while writes and released authority refuse", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "credential-local-read-")));
  roots.push(root);
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  const admission = RuntimeAdmission.syntheticRoots(stateRoot, stateRoot);
  const store = createCredentialStore({ admission, stateRoot });
  try {
    assert.equal(store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
    chmodSync(root, 0o1777);
    assert.equal(store.read().entries.ucpathPassword?.value, SECRET);
    assert.throws(() => store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2,
      expectedRevision: 2, entries: { ucpathPassword: { clear: true } } })), /unsafe synthetic fixture ancestor/u);
    assert.throws(() => store.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2,
      commandFingerprint: "3".repeat(64), expectedRevision: 2, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_2, updatedAt: NOW })), /unsafe synthetic fixture ancestor/u);
    assert.equal(store.read().entries.ucpathPassword?.value, SECRET);
    admission.release();
    assert.throws(() => store.read(), /released admission/u);
  } finally { chmodSync(root, 0o700); admission.release(); }
});

it("refuses a substituted local journal ancestor before treating missing files as empty", () => {
  const stored = fixture();
  assert.equal(stored.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
    expectedRevision: 1, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
  assert.equal(stored.store.erase(CredentialEraseInputSchema.parse({ commandId: COMMAND_2,
    commandFingerprint: "3".repeat(64), expectedRevision: 2, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: WRITE_2, updatedAt: NOW })).state, "applied");
  assert.equal(stored.store.read().entries.ucpathPassword, undefined);
  const directory = join(stored.tracker, "credential-erasures");
  renameSync(directory, `${directory}-held`);
  mkdirSync(directory, { mode: 0o700 });
  assert.throws(() => stored.store.read(), /credential ancestor identity changed/u);
});
