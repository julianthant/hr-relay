import assert from "node:assert/strict";
import fs, { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import * as readonlySnapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createCredentialStore, createChatGptCredentialRepository, CredentialErasureHeadSchema, erasureRequestIdentity, readForErasure } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

async function pending(f?: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  f ??= await createBoundProfileFixture();
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
    activity: { hasUnquiescedWork: () => true } });
  const active = session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture activation refused");
  const result = session.logOut(active.token, { at: "2026-10-21T12:01:00.000Z" });
  assert.equal(result.state, "cancelling"); if (result.state !== "cancelling") throw new Error("fixture cancellation refused"); assert.ok(result.operationId);
  const path = join(f.machine.stateRoot, "machine", "operations", `${result.operationId}.json`);
  const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  session.close();
  const owner = f.machine.admitProfileSettlement(operation.operationId);
  const store = createCredentialStore({ admission: owner, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`) });
  return { f, owner, store, operation, path, async close() { owner.release(); await f.close(); } };
}

it("issues exact early pending-logout inspection without runtime, credential, database-write or artifact authority", async () => {
  const f = await pending();
  const purpose = f.owner.forPendingLogoutInventory(f.operation);
  try {
    assert.equal(f.operation.commandId, undefined); assert.equal(f.operation.expectedRevision, undefined);
    const before = AuthorityDatabase.readProfileMaintenanceInventory(purpose);
    purpose.assertPendingLogoutInventory(f.owner, f.operation);
    assert.equal(before.authorityGeneration, AuthorityDatabase.readProfileMaintenanceInventory(purpose).authorityGeneration);
    assert.throws(() => purpose.assertProfileRuntime());
    assert.throws(() => purpose.assertCredentialRead());
    assert.throws(() => purpose.assertWritable());
    assert.throws(() => purpose.assertExclusive());
    assert.throws(() => purpose.beginCredentialErasure({ epoch: 1 }));
    assert.throws(() => purpose.assertReadOnlyAuthorityDatabase(":memory:"));
    assert.throws(() => purpose.assertArtifactRoot(purpose.artifactRoot));
    assert.throws(() => AuthorityDatabase.open(purpose, { path: f.f.path, busyTimeoutMs: 250, migrationOwner: "refused" }));
    assert.throws(() => createCredentialStore({ admission: purpose, stateRoot: purpose.stateRoot,
      erasureJournalAdmission: f.f.machine, erasureJournalPath: join(f.f.machine.stateRoot, "machine", "erasures", `${f.operation.profileId}.json`) }));
    const sibling = f.f.machine.admitProfileSettlement(f.operation.operationId);
    try { assert.throws(() => purpose.assertPendingLogoutInventory(sibling, f.operation)); }
    finally { sibling.release(); }
    assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, { ...f.operation, operationId: randomUUID() }));
    assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, { ...f.operation, phase: "complete" }));
    const foreign = await pending();
    try {
      assert.throws(() => purpose.assertPendingLogoutInventory(foreign.owner, f.operation));
      assert.throws(() => purpose.assertReadOnlyAuthorityDatabase(foreign.f.path));
      assert.throws(() => purpose.verifiedReadOnlyCopy(foreign.f.path, "a".repeat(64)));
    } finally { await foreign.close(); }
  } finally { purpose.release(); await f.close(); }
});

for (const mutation of ["operation-inode", "operation-phase", "operation-at", "database-inode", "selection", "released-child", "released-parent"] as const) {
  it(`revokes pending inspection after actual ${mutation} changes`, async () => {
    const f = await pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
    let restore: (() => void) | undefined;
    try {
      if (mutation === "operation-inode" || mutation === "database-inode") {
        const path = mutation === "operation-inode" ? f.path : f.f.path, original = `${path}.retained`;
        renameSync(path, original); copyFileSync(original, path);
        restore = () => { unlinkSync(path); renameSync(original, path); };
      } else if (mutation === "operation-at") {
        const before = readFileSync(f.path);
        writeFileSync(f.path, JSON.stringify({ ...f.operation, at: new Date(Date.parse(f.operation.at) + 1).toISOString() }));
        restore = () => writeFileSync(f.path, before);
      } else if (mutation === "operation-phase") f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
      else if (mutation === "selection") createProfileRegistry(f.f.machine).advanceSession(null);
      else if (mutation === "released-child") f.owner.release();
      else f.f.machine.release();
      assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, f.operation));
      assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(purpose));
      if (mutation === "operation-at") {
        assert.ok(restore); restore(); restore = undefined;
        assert.throws(() => purpose.assertLive());
        assert.throws(() => f.owner.assertCredentialErasureObservation(randomUUID()));
        f.owner.assertCredentialErasureObservation(f.operation.operationId);
      }
    } finally { restore?.(); purpose.release(); await f.close(); }
  });
}


for (const phase of ["early", "incomplete", "partial"] as const) it(`observes only the exact original ${phase} erasure head without changing phase or granting erasure`, async () => {
  const f = await pending();
  let operation = f.operation;
  const revision = readForErasure(f.store, operation.operationId).revision;
  if (phase !== "early") {
    operation = LogoutOperationSchema.parse({ ...operation, phase: "incomplete", commandId: randomUUID(),
      ...(phase === "incomplete" ? { writeId: randomUUID(), expectedRevision: revision } : {}) });
    f.f.machine.publishProfileOperation(operation);
  }
  const purpose = f.owner.forPendingLogoutInventory(operation);
  const continuity = z.object({ erasures: z.array(z.object({ profileId: z.string(), head: CredentialErasureHeadSchema })) })
    .parse(JSON.parse(readFileSync(join(f.f.workspace, ".tracker", "control", "profile-registry.json"), "utf8")));
  const head = continuity.erasures.find(row => row.profileId === operation.profileId)?.head; assert.ok(head);
  const before = readFileSync(f.path);
  try {
    assert.throws(() => purpose.assertCredentialErasureHead(head));
    if (phase === "early") {
      purpose.assertPendingLogoutErasureHead(f.owner, operation, head);
      const unexpected = erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), expectedRevision: revision,
        updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, unexpected));
    } else if (phase === "incomplete") {
      const request = erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
        expectedRevision: operation.expectedRevision, updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      purpose.assertPendingLogoutErasureHead(f.owner, operation, head, request);
      assert.throws(() => f.owner.assertCredentialErasure(request));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, { ...request, requestReceipt: "forged" }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, { ...request, commandId: randomUUID() }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, { ...operation, phase: "erasing" }, head, request));
    } else assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head));
    assert.equal(readFileSync(f.path).equals(before), true, "read-only head observation cannot rewrite the original operation");
  } finally { purpose.release(); await f.close(); }
});


it("reads an ordinary account record but refuses direct pending-purpose access without changing it", async () => {
  const profile = await createBoundProfileFixture();
  const repository = createChatGptCredentialRepository({ admission: profile.admission, stateRoot: profile.stateRoot });
  const record = { schemaVersion: 1 as const, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
  let current: Awaited<ReturnType<typeof pending>> | undefined;
  try {
    await repository.withLock(async transaction => { transaction.replace(record, null); });
    assert.deepEqual(repository.read(), record);
    const path = join(profile.stateRoot, "credentials", "chatgpt-account.json"), before = readFileSync(path);
    current = await pending(profile);
    const purpose = current.owner.forPendingLogoutInventory(current.operation);
    try {
      const denied = createChatGptCredentialRepository({ admission: purpose, stateRoot: profile.stateRoot });
      assert.throws(() => denied.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
      assert.equal(readFileSync(path).equals(before), true);
    } finally { purpose.release(); }
  } finally { if (current === undefined) await profile.close(); else await current.close(); }
});

for (const mutation of ["operation", "child", "parent", "copy-bytes", "copy-release"] as const) it(`keeps an exact digest copy read-only and revokes it after ${mutation} changes`, async () => {
  const f = await pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
  const path = join(f.f.stateRoot, "pending-inventory-copy.sqlite");
  copyFileSync(f.f.path, path);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  const copy = purpose.verifiedReadOnlyCopy(path, digest);
  const registry = z.object({ erasures: z.array(z.object({ profileId: z.string(), head: CredentialErasureHeadSchema })) })
    .parse(JSON.parse(readFileSync(join(f.f.workspace, ".tracker", "control", "profile-registry.json"), "utf8")));
  const head = registry.erasures.find(row => row.profileId === f.operation.profileId)?.head; assert.ok(head);
  try {
    copy.assertReadOnlyAuthorityDatabase(path);
    copy.assertStateRoot(path);
    const sourceBytes = readFileSync(f.f.path), copyBytes = readFileSync(path);
    const binding = withAuthorityDatabaseReadOnly(copy, path, database =>
      database.prepare("SELECT installation_id AS installationId, profile_id AS profileId FROM database_states WHERE id=1").get());
    assert.equal(binding?.installationId, f.owner.profileBinding.installationId);
    assert.equal(binding?.profileId, f.operation.profileId);
    assert.equal(readFileSync(f.f.path).equals(sourceBytes), true);
    assert.equal(readFileSync(path).equals(copyBytes), true);
    assert.throws(() => copy.assertReadOnlyAuthorityDatabase(f.f.path));
    assert.throws(() => copy.assertReadOnlyAuthorityDatabase(join(f.f.stateRoot, "backups", "authority", `authority-g1-1-${randomUUID()}.sqlite`)));
    assert.throws(() => copy.assertReadOnlyAuthorityDatabase(":memory:"));
    assert.throws(() => copy.assertStateRoot(f.f.stateRoot));
    assert.throws(() => copy.verifiedReadOnlyCopy(path, digest));
    assert.throws(() => copy.assertPendingLogoutInventory(f.owner, f.operation));
    assert.throws(() => copy.assertPendingLogoutErasureHead(f.owner, f.operation, head));
    assert.throws(() => copy.assertCredentialRead());
    assert.throws(() => createChatGptCredentialRepository({ admission: copy, stateRoot: f.f.stateRoot }).read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => copy.assertExclusive());
    assert.throws(() => copy.assertWritable());
    assert.throws(() => copy.assertProfileRuntime());
    assert.throws(() => copy.assertAuthorityDatabase(path));
    assert.throws(() => copy.assertArtifactRoot(copy.artifactRoot));
    assert.throws(() => copy.assertCredentialErasureHead(head));
    assert.throws(() => copy.beginCredentialErasure({ epoch: 1 }));
    if (mutation === "operation") f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
    else if (mutation === "child") f.owner.release();
    else if (mutation === "parent") f.f.machine.release();
    else if (mutation === "copy-bytes") appendFileSync(path, "changed-copy");
    else copy.release();
    assert.throws(() => copy.assertReadOnlyAuthorityDatabase(path));
  } finally { copy.release(); purpose.release(); unlinkSync(path); await f.close(); }
});


it("retains one strict binding snapshot per pending purpose while native facts stay fresh and disposes it on release", async () => {
  const f = await pending(), capture = readonlySnapshots.createReadonlyAuthoritySnapshot;
  const copies: string[] = [];
  const observer = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const snapshot = capture(path); copies.push(snapshot.path); return snapshot;
  });
  const reads = vi.spyOn(DatabaseSync.prototype, "prepare");
  let purpose: ReturnType<typeof f.owner.forPendingLogoutInventory> | undefined;
  const source = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
    const info = lstatSync(f.f.path + suffix, { bigint: true, throwIfNoEntry: false });
    return info === undefined ? null : [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs];
  });
  const before = source();
  try {
    purpose = f.owner.forPendingLogoutInventory(f.operation);
    assert.equal(copies.length, 1);
    const held = copies[0]; assert.ok(held);
    for (let count = 0; count < 5; count++) purpose.assertPendingLogoutInventory(f.owner, f.operation);
    assert.equal(copies.length, 1);
    assert.equal(existsSync(held), true);
    const bindingReaders = new Set(reads.mock.contexts);
    assert.equal(bindingReaders.size, 1);
    const first = AuthorityDatabase.readProfileMaintenanceInventory(purpose);
    const firstReaders = new Set(reads.mock.contexts.filter(reader => !bindingReaders.has(reader)));
    assert.equal(firstReaders.size, 1);
    const observed = new Set(reads.mock.contexts);
    const second = AuthorityDatabase.readProfileMaintenanceInventory(purpose);
    const secondReaders = new Set(reads.mock.contexts.filter(reader => !observed.has(reader)));
    assert.equal(secondReaders.size, 1);
    assert.equal(first.authorityGeneration, second.authorityGeneration);
    assert.equal(copies.length, 1);
    reads.mockRestore();
    for (const reader of [...bindingReaders, ...firstReaders, ...secondReaders]) {
      assert.ok(reader instanceof DatabaseSync);
      assert.throws(() => reader.prepare("SELECT 1"));
    }
    assert.deepEqual(source(), before);
    purpose.release();
    assert.equal(existsSync(held), false);
    assert.throws(() => purpose?.assertLive());
    purpose.release();
  } finally { purpose?.release(); reads.mockRestore(); observer.mockRestore(); await f.close(); }
});

for (const suffix of ["", "-wal", "-shm", "-journal"] as const) it(`permanently revokes a pending snapshot after a changed ${suffix === "" ? "main" : suffix.slice(1)} source`, async () => {
  const f = await pending(), path = f.f.path + suffix;
  if (!existsSync(path)) writeFileSync(path, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  const purpose = f.owner.forPendingLogoutInventory(f.operation), before = readFileSync(path);
  try {
    purpose.assertLive();
    appendFileSync(path, Buffer.from([1]));
    let refusal: unknown;
    assert.throws(() => purpose.assertLive(), error => {
      refusal = error; return error instanceof Error && error.message === "authority-readonly-source-changed";
    });
    writeFileSync(path, before);
    assert.throws(() => purpose.assertLive(), error => error === refusal);
    assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(purpose), error => error === refusal);
  } finally { purpose.release(); await f.close(); }
});

for (const suffix of ["-wal", "-shm", "-journal"] as const) it(`remembers a pending ${suffix.slice(1)} absence and cannot re-admit a restored absence`, async () => {
  const f = await pending(), path = f.f.path + suffix;
  let purpose: ReturnType<typeof f.owner.forPendingLogoutInventory> | undefined;
  const rows = () => withAuthorityDatabaseReadOnly(f.owner, f.f.path, database => ({
    inspection: inspectNativeAuthority(database, CURRENT_AUTHORITY_SCHEMA_VERSION),
    tables: Object.fromEntries(migrationTableNames(CURRENT_AUTHORITY_SCHEMA_VERSION)
      .map(table => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()])),
  }));
  const credentialFiles = () => [join(f.f.stateRoot, "credentials", "protected.json"),
    join(f.f.machine.stateRoot, "machine", "credential-keys", `${f.operation.profileId}.json`),
    ...["", ".authority"].map(tail => join(f.f.machine.stateRoot, "machine", "erasures", `${f.operation.profileId}.json${tail}`)),
    join(f.f.workspace, ".tracker", "control", "profile-registry.json")].map(file => {
    const info = lstatSync(file, { bigint: true, throwIfNoEntry: false });
    return info === undefined ? null : { bytes: readFileSync(file), identity: [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs] };
  });
  const before = rows(), beforeCredentials = credentialFiles();
  try {
    const database = new DatabaseSync(f.f.path);
    try { assert.equal(database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()?.busy, 0); }
    finally { database.close(); }
    assert.deepEqual(rows(), before);
    assert.deepEqual(credentialFiles(), beforeCredentials);
    assert.equal(existsSync(path), false);
    purpose = f.owner.forPendingLogoutInventory(f.operation);
    const issued = purpose;
    writeFileSync(path, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    let refusal: unknown;
    assert.throws(() => issued.assertLive(), error => {
      refusal = error; return error instanceof Error && error.message === "authority-readonly-source-changed";
    });
    unlinkSync(path);
    assert.throws(() => issued.assertLive(), error => error === refusal);
  } finally { purpose?.release(); await f.close(); }
});

for (const mutation of ["schema", "binding"] as const) it(`rejects an actual ${mutation} mismatch at issuance and disposes the failed copy`, async () => {
  const f = await pending(), database = new DatabaseSync(f.f.path);
  try {
    if (mutation === "schema") database.exec("PRAGMA user_version=0");
    else {
      database.exec("DROP TRIGGER database_states_binding_immutable");
      database.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID());
    }
  } finally { database.close(); }
  const capture = readonlySnapshots.createReadonlyAuthoritySnapshot, copies: string[] = [];
  const observer = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const snapshot = capture(path); copies.push(snapshot.path); return snapshot;
  });
  try {
    assert.throws(() => f.owner.forPendingLogoutInventory(f.operation), { message: `profile-database-${mutation}-mismatch` });
    assert.equal(copies.length, 1);
    assert.equal(copies.every(path => !existsSync(path)), true);
    const forged: unknown = Object.create(f.owner);
    assert.ok(forged instanceof RuntimeAdmission);
    assert.throws(() => forged.forPendingLogoutInventory(f.operation));
  } finally { observer.mockRestore(); await f.close(); }
});

it("keeps the real original writer lock held across pending binding issuance and repeated native inspection", async () => {
  const f = await pending(), database = new DatabaseSync(f.f.path);
  let purpose: ReturnType<typeof f.owner.forPendingLogoutInventory> | undefined;
  try {
    database.exec("PRAGMA wal_autocheckpoint=0; BEGIN IMMEDIATE");
    purpose = f.owner.forPendingLogoutInventory(f.operation);
    for (let count = 0; count < 3; count++) purpose.assertLive();
    AuthorityDatabase.readProfileMaintenanceInventory(purpose);
    const peer = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
      const { DatabaseSync } = require("node:sqlite");
      const database = new DatabaseSync(process.argv[1], { timeout: 100 });
      try { database.exec("BEGIN IMMEDIATE; ROLLBACK"); process.stdout.write("acquired"); }
      catch (error) { if (error.errcode !== 5) throw error; process.stdout.write("busy"); }
      finally { database.close(); }
    `, f.f.path], { encoding: "utf8" });
    assert.equal(peer.error, undefined); assert.equal(peer.signal, null); assert.equal(peer.status, 0);
    assert.equal(peer.stdout === "busy", true);
  } finally { purpose?.release(); database.exec("ROLLBACK"); database.close(); await f.close(); }
});

it("retains the exact cleanup failure and refuses all future use when its owned snapshot cannot be disposed", async () => {
  const f = await pending(), capture = readonlySnapshots.createReadonlyAuthoritySnapshot, failure = new Error("synthetic retained snapshot cleanup failure");
  let owned: ReturnType<typeof capture> | undefined;
  const observer = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    owned = capture(path); return { ...owned, dispose: () => { throw failure; } };
  });
  const purpose = f.owner.forPendingLogoutInventory(f.operation);
  try {
    assert.ok(owned); assert.equal(existsSync(owned.path), true);
    assert.throws(() => purpose.release(), error => error === failure);
    assert.throws(() => purpose.assertLive(), error => error === failure);
    assert.throws(() => purpose.release(), error => error === failure);
    assert.equal(existsSync(owned.path), true);
  } finally {
    observer.mockRestore(); owned?.dispose();
    assert.equal(owned === undefined || !existsSync(owned.path), true);
    await f.close();
  }
});


it("disposes the issued copy if actual operation custody changes before pending admission returns", async () => {
  const f = await pending(), capture = readonlySnapshots.createReadonlyAuthoritySnapshot, copies: string[] = [];
  const observer = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const snapshot = capture(path); copies.push(snapshot.path);
    f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
    return snapshot;
  });
  try {
    assert.throws(() => f.owner.forPendingLogoutInventory(f.operation), /profile-pending-logout-operation-changed/u);
    assert.equal(copies.length, 1);
    assert.equal(copies.every(path => !existsSync(path)), true);
  } finally { observer.mockRestore(); await f.close(); }
});


for (const method of ["state-root", "readonly-database"] as const) {
  it(`keeps actual physical root checks in direct pending ${method} inspection`, async () => {
    const f = await pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
    const path = method === "state-root" ? f.f.stateRoot : f.f.path;
    const artifactRoot = join(f.f.stateRoot, "artifacts"), mode = lstatSync(artifactRoot).mode & 0o7777;
    const databaseBefore = readFileSync(f.f.path), operationBefore = readFileSync(f.path);
    const protectedPath = join(f.f.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
    const inspect = () => method === "state-root" ? purpose.assertStateRoot(path) : purpose.assertReadOnlyAuthorityDatabase(path);
    try {
      inspect();
      chmodSync(artifactRoot, 0o770);
      purpose.assertLive();
      assert.throws(inspect, /runtime-admission: storage root ownership changed/u);
      assert.equal(readFileSync(f.f.path).equals(databaseBefore), true);
      assert.equal(readFileSync(f.path).equals(operationBefore), true);
      assert.equal(readFileSync(protectedPath).equals(protectedBefore), true);
    } finally { chmodSync(artifactRoot, mode); purpose.release(); await f.close(); }
  });

  for (const state of ["released", "changed-operation"] as const) it(`checks ${state} pending custody before a refused ${method} path`, async () => {
    const f = await pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
    const invalidPath = method === "state-root" ? join(f.f.workspace, "outside-profile") : ":memory:";
    const databaseBefore = readFileSync(f.f.path);
    try {
      if (state === "released") purpose.release();
      else f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
      const inspect = () => method === "state-root" ? purpose.assertStateRoot(invalidPath) : purpose.assertReadOnlyAuthorityDatabase(invalidPath);
      assert.throws(inspect, state === "released" ? /runtime-admission: missing or released admission/u : /profile-pending-logout-operation-changed/u);
      assert.equal(readFileSync(f.f.path).equals(databaseBefore), true);
    } finally { purpose.release(); await f.close(); }
  });
}

it("revalidates actual pending copy custody after its completed digest read", async () => {
  const f = await pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
  const path = join(f.f.stateRoot, "pending-digest-observation.sqlite");
  copyFileSync(f.f.path, path);
  const sourceBefore = readFileSync(f.f.path), copyBefore = readFileSync(path);
  const copy = purpose.verifiedReadOnlyCopy(path, createHash("sha256").update(copyBefore).digest("hex"));
  const identity = lstatSync(path), close = fs.closeSync;
  let changed = false;
  const observer = vi.spyOn(fs, "closeSync").mockImplementation(descriptor => {
    const current = fs.fstatSync(descriptor);
    close(descriptor);
    if (!changed && current.dev === identity.dev && current.ino === identity.ino) {
      changed = true;
      f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
    }
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => copy.assertReadOnlyAuthorityDatabase(path), /profile-pending-logout-operation-changed/u);
    assert.equal(changed, true);
    assert.equal(readFileSync(f.f.path).equals(sourceBefore), true);
    assert.equal(readFileSync(path).equals(copyBefore), true);
    const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(f.path, "utf8")));
    assert.equal(operation.operationId, f.operation.operationId);
    assert.equal(operation.at, f.operation.at);
    assert.equal(operation.phase, "incomplete");
    assert.equal(operation.commandId, f.operation.commandId);
    assert.equal(operation.writeId, f.operation.writeId);
    assert.equal(operation.expectedRevision, f.operation.expectedRevision);
  } finally {
    observer.mockRestore(); syncBuiltinESMExports();
    copy.release(); purpose.release(); unlinkSync(path); await f.close();
  }
});
