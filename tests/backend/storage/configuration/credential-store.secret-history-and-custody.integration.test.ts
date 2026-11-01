import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { createCredentialStore, authenticateDocument, initialDocument, CredentialStoreCommitUncertainError,
  type CredentialStoreHooks, type CredentialStoreIds } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createCanonicalCredentials, initializeCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsApplyInput } from "../../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111", COMMAND_2 = "22222222-2222-4222-8222-222222222222", COMMAND_3 = "33333333-3333-4333-8333-333333333333";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", WRITE_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRIVATE_VALUE_1 = "credential-store-private-one", PRIVATE_VALUE_2 = "credential-store-private-two";
const NOW_1 = "2026-09-06T12:00:00.000Z", NOW_2 = "2026-09-06T12:01:00.000Z";
function request(patch: Partial<z.input<typeof ProtectedSettingsApplyInputSchema>> = {}): ProtectedSettingsApplyInput {
  return ProtectedSettingsApplyInputSchema.parse({ commandId: COMMAND_1, writeId: WRITE_1, commandFingerprint: "1".repeat(64),
    expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: NOW_1, entries: {}, ...patch });
}
async function freshProfile() {
  const profile = await createBoundProfileFixture({ pending: "storage" });
  try {
    AuthorityDatabase.initializeProfile(profile.admission);
    const directory = join(profile.machine.stateRoot, "machine", "operations"), names = readdirSync(directory);
    assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8"))), document = initialDocument();
    initializeCanonicalCredentials(profile.machine, profile.admission, operation, { revision: document.record.revision, value: document });
    profile.machine.publishProfileOperation({ ...operation, credentials: { ...operation.credentials, phase: "ready", protectedRevision: document.record.revision } });
    return profile;
  } catch (error) { await profile.close(); throw error; }
}
async function fixture(hooks?: CredentialStoreHooks, ids?: CredentialStoreIds) {
  const profile = await freshProfile();
  const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot, hooks, ids });
  return { ...profile, store, path: join(profile.stateRoot, "credentials", "protected.json"), directory: join(profile.stateRoot, "credentials") };
}
function applied(store: ReturnType<typeof createCredentialStore>, input: ProtectedSettingsApplyInput) {
  const outcome = store.apply(input); assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential test expected an applied outcome");
  return outcome.record;
}
for (const change of ["directory permissions", "key permissions", "unexpected companion"] as const)
  it(`revalidates command ownership after ${change} without rewriting credentials`, async () => {
    const f = await fixture();
    try {
      applied(f.store, request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
      assert.equal(f.store.ownsCommandId(COMMAND_1), true); const bytes = readFileSync(f.path);
      const key = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), companion = join(f.directory, "unexpected-companion.json");
      const path = change === "directory permissions" ? f.directory : key, mode = lstatSync(path).mode & 0o777;
      try {
        if (change === "unexpected companion") writeFileSync(companion, "{}", { mode: 0o600 }); else chmodSync(path, 0o755);
        assert.throws(() => f.store.ownsCommandId(COMMAND_1), { code: "CREDENTIAL_UNAVAILABLE" });
        assert.deepEqual(readFileSync(f.path), bytes);
      } finally { if (change === "unexpected companion") unlinkSync(companion); else chmodSync(path, mode); }
      assert.equal(f.store.ownsCommandId(COMMAND_1), true); assert.equal(f.store.ownsCommandId(COMMAND_2), false);
    } finally { await f.close(); }
  });
it("keeps initialized read, lookup and replay read-only and writes private canonical authority", async () => {
  const f = await fixture();
  try {
    const bytes = readFileSync(f.path), names = readdirSync(f.directory).sort();
    assert.deepEqual(f.store.read().entries, {}); assert.equal(f.store.read().revision, 1);
    assert.equal(f.store.ownsCommandId(COMMAND_1), false); assert.equal(f.store.acceptedAt(COMMAND_1), undefined);
    assert.equal(f.store.verifyReplay(request()).state, "rejected");
    assert.deepEqual(readFileSync(f.path), bytes); assert.deepEqual(readdirSync(f.directory).sort(), names);
    applied(f.store, request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700); assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(f.directory).sort(), names);
  } finally { await f.close(); }
});
it("enforces CAS, exact last replay and divergent command/write identities without rewriting", async () => {
  const f = await fixture();
  try {
    const first = request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }), record = applied(f.store, first), bytes = readFileSync(f.path);
    assert.equal(record.revision, 2); assert.deepEqual(f.store.apply(first), { state: "applied", record });
    assert.deepEqual(f.store.verifyReplay(first), { state: "applied", record }); assert.equal(f.store.acceptedAt(COMMAND_1), NOW_1);
    assert.deepEqual(f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2 })), { state: "conflict", currentRevision: 2, message: "credential revision 1 is stale; current revision is 2" });
    for (const divergent of [request({ writeId: WRITE_2 }), request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } }), request({ commandId: COMMAND_2, expectedRevision: 2 })]) {
      const outcome = f.store.apply(divergent); assert.equal(outcome.state, "rejected");
      if (outcome.state === "rejected") assert.equal(outcome.code, "command-divergent");
    }
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("retains all command/write identities while only the latest command owns acceptedAt and exact replay", async () => {
  const f = await fixture();
  try {
    const first = request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }); applied(f.store, first);
    applied(f.store, request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, updatedAt: NOW_2, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } }));
    const bytes = readFileSync(f.path);
    assert.equal(f.store.ownsCommandId(COMMAND_1), true); assert.equal(f.store.ownsCommandId(COMMAND_2), true); assert.equal(f.store.ownsCommandId(COMMAND_3), false);
    assert.equal(f.store.acceptedAt(COMMAND_1), undefined); assert.equal(f.store.acceptedAt(COMMAND_2), NOW_2); assert.equal(f.store.acceptedAt(COMMAND_3), undefined);
    assert.equal(f.store.apply(first).state, "conflict"); assert.equal(f.store.verifyReplay(first).state, "conflict");
    assert.equal(f.store.apply({ ...first, writeId: WRITE_3 }).state, "conflict");
    for (const reused of [request({ commandId: COMMAND_1, writeId: WRITE_3, expectedRevision: 3 }), request({ commandId: COMMAND_3, writeId: WRITE_1, expectedRevision: 3 })]) {
      const result = f.store.apply(reused); assert.equal(result.state, "rejected"); if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    }
    assert.equal(f.store.read().revision, 3); assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("lost CAS preserves the peer's command and never publishes a stale candidate", async () => {
  const profile = await freshProfile(), peer = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
  const path = join(profile.stateRoot, "credentials", "protected.json"); let peerBytes: Buffer | undefined;
  const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot, hooks: { beforeRename() {
    applied(peer, request({ commandId: COMMAND_2, writeId: WRITE_2, entries: { timekeeperName: { set: "peer" } } })); peerBytes = readFileSync(path);
  } } });
  try {
    const result = store.apply(request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    assert.equal(result.state, "conflict"); assert.equal(store.ownsCommandId(COMMAND_1), false); assert.equal(store.ownsCommandId(COMMAND_2), true);
    assert.equal(store.read().entries.ucpathPassword, undefined); assert.ok(peerBytes); assert.deepEqual(readFileSync(path), peerBytes);
  } finally { await profile.close(); }
});
it("a peer's exact winning command settles the lost CAS without another write", async () => {
  const profile = await freshProfile(), peer = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
  const input = request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }), path = join(profile.stateRoot, "credentials", "protected.json");
  let peerBytes: Buffer | undefined, publications = 0;
  const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot, hooks: {
    beforeRename() { applied(peer, input); peerBytes = readFileSync(path); }, afterRename() { publications++; },
  } });
  try {
    assert.deepEqual(store.apply(input), { state: "applied", record: peer.read() });
    assert.equal(publications, 0); assert.ok(peerBytes); assert.deepEqual(readFileSync(path), peerBytes);
  } finally { await profile.close(); }
});
for (const unsafe of ["directory-mode", "root-mode", "hardlink", "symlink", "missing", "malformed"] as const)
  it(`refuses ${unsafe} authority on read and apply without replacing source`, async () => {
    const f = await fixture();
    try {
      const bytes = readFileSync(f.path), alias = join(f.stateRoot, "credential-alias");
      if (unsafe === "directory-mode") chmodSync(f.directory, 0o755);
      if (unsafe === "root-mode") chmodSync(f.stateRoot, 0o777);
      if (unsafe === "hardlink") linkSync(f.path, alias);
      if (unsafe === "symlink") { renameSync(f.path, alias); symlinkSync(alias, f.path); }
      if (unsafe === "missing") unlinkSync(f.path);
      if (unsafe === "malformed") writeFileSync(f.path, '{"secret":"synthetic"');
      const names = readdirSync(f.directory).sort();
      assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.throws(() => f.store.apply(request()), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readdirSync(f.directory).sort(), names);
      if (unsafe === "symlink") { assert.equal(readlinkSync(f.path), alias); assert.deepEqual(readFileSync(alias), bytes); }
      else if (unsafe !== "missing") assert.deepEqual(readFileSync(f.path), unsafe === "malformed" ? Buffer.from('{"secret":"synthetic"') : bytes);
    } finally {
      if (unsafe === "directory-mode") chmodSync(f.directory, 0o700);
      if (unsafe === "root-mode") chmodSync(f.stateRoot, 0o700);
      await f.close();
    }
  });
it("rejects a symlinked source root and lexical alias without changing current bytes", async () => {
  const f = await fixture(), moved = `${f.stateRoot}-moved`;
  try {
    const bytes = readFileSync(f.path); renameSync(f.stateRoot, moved); symlinkSync(moved, f.stateRoot);
    try { assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" }); assert.deepEqual(readFileSync(join(moved, "credentials", "protected.json")), bytes); }
    finally { unlinkSync(f.stateRoot); renameSync(moved, f.stateRoot); }
    assert.throws(() => createCredentialStore({ admission: f.admission, stateRoot: `${f.stateRoot}/pivot/../same` }), /raw credential path/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("rechecks source safety after the pre-publication hook", async () => {
  const f = await fixture({ beforeRename() { chmodSync(f.directory, 0o755); } });
  try {
    const bytes = readFileSync(f.path); assert.throws(() => f.store.apply(request()), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { chmodSync(f.directory, 0o700); await f.close(); }
});
it("keeps a post-publication uncertain commit and settles its exact retry without rewriting", async () => {
  let fail = true;
  const f = await fixture({ afterRename() { if (fail) { fail = false; throw new Error("injected private interruption"); } } });
  try {
    const first = request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } });
    assert.throws(() => f.store.apply(first), error => error instanceof CredentialStoreCommitUncertainError
      && error.message === "credential-commit-uncertain: credential commit reached protected.json but completion is uncertain" && !error.message.includes(PRIVATE_VALUE_1));
    const bytes = readFileSync(f.path); assert.equal(f.store.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);
    assert.equal(f.store.apply(first).state, "applied"); assert.equal(f.store.verifyReplay(first).state, "applied");
    const divergent = f.store.apply({ ...first, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } });
    assert.equal(divergent.state, "rejected"); if (divergent.state === "rejected") assert.equal(divergent.code, "command-divergent");
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("retains the original private source closure cause when publication is uncertain", async () => {
  await runCredentialSourceRetentionCase("protected-source");
});
for (const name of [".protected.lock", ".protected.reaper", ".protected.reaper-claim", ".protected.88888888-8888-4888-8888-888888888888.99999999-9999-4999-8999-999999999999.tmp"])
  it(`preserves unknown old ${name} instead of granting dead-PID cleanup authority`, async () => {
    const f = await fixture();
    try {
      const path = join(f.directory, name), bytes = Buffer.from(JSON.stringify({ pid: 2_147_483_647, acquisitionId: randomUUID() })), before = readFileSync(f.path);
      writeFileSync(path, bytes, { mode: 0o600 });
      assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" }); assert.throws(() => f.store.apply(request()), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(f.path), before);
    } finally { await f.close(); }
  });
it("retains marked identity history without retaining replaced secret payloads", async () => {
  const f = await fixture();
  try {
    for (let sequence = 1; sequence <= 20; sequence++) applied(f.store, request({ commandId: randomUUID(), writeId: randomUUID(), expectedRevision: sequence,
      entries: { ucpathPassword: { set: `private-history-${sequence}-`.padEnd(3900, String(sequence % 10)) } } }));
    const frame = createCanonicalCredentials(f.admission).readRecord("protected"); assert.ok(frame);
    const document = authenticateDocument(frame.value), serialized = JSON.stringify(document), bytes = readFileSync(f.path);
    assert.equal(document.history.length, 20); assert.equal(f.store.read().revision, 21);
    assert.equal(serialized.includes("private-history-1-"), false); assert.equal(serialized.includes("private-history-20-"), true);
    assert.equal(bytes.includes(Buffer.from("private-history-20-")), false); assert.ok(bytes.length < 64_000); assert.ok(bytes.length < 16 * 1024 * 1024);
  } finally { await f.close(); }
});
it("rejects reused generated value IDs, including IDs retained only in retired history", async () => {
  const id = "77777777-7777-4777-8777-777777777777", f = await fixture(undefined, { randomUUID: () => id });
  try {
    applied(f.store, request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    applied(f.store, request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, entries: { ucpathPassword: { clear: true } } }));
    const bytes = readFileSync(f.path);
    assert.throws(() => f.store.apply(request({ commandId: COMMAND_3, writeId: WRITE_3, expectedRevision: 3, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } })), /value identity generation collided/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("rejects schema mismatch and non-editable input without writing", async () => {
  const f = await fixture();
  try {
    const bytes = readFileSync(f.path);
    assert.deepEqual(Reflect.apply(f.store.apply.bind(f.store), f.store, [{ ...request(), protectedSchemaHash: "f".repeat(64) }]), { state: "rejected", code: "schema-mismatch", message: "credential schema does not match the current catalog" });
    assert.deepEqual(Reflect.apply(f.store.apply.bind(f.store), f.store, [{ ...request(), entries: { ucpathPassword: { set: "" } } }]), { state: "rejected", code: "invalid-value", message: "credential request is invalid" });
    const unknown = { ...request(), entries: { ucpathPassword: { set: "secret" }, unsupported: { set: "secret" } } };
    const outcome = f.store.apply(unknown); assert.equal(outcome.state, "rejected"); if (outcome.state === "rejected") assert.equal(outcome.code, "not-editable");
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
it("requires current schema and consistent history for every authenticated payload", () => {
  const initial = initialDocument(); assert.equal(authenticateDocument(initial).record.revision, 1);
  assert.throws(() => authenticateDocument({ ...initial, schemaVersion: 3 }), /malformed/u);
  assert.throws(() => authenticateDocument({ ...initial, historyBaseRevision: 2 }), /identity history/u);
});
it("imports retired historical identities without reviving values or allowing future reuse", async () => {
  const f = await fixture();
  try {
    const first = applied(f.store, request({ entries: { timekeeperName: { set: "retired keeper" } } })), retiredEntry = first.entries.timekeeperName; assert.ok(retiredEntry);
    const retiredValue = retiredEntry.valueId;
    applied(f.store, request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } }));
    const owner = createCanonicalCredentials(f.admission), frame = owner.readRecord("protected"); assert.ok(frame);
    const document = structuredClone(authenticateDocument(frame.value)), retiredOnlyValue = randomUUID(), retiredWrite = randomUUID(), tombstoneOnlyCommand = randomUUID();
    delete document.record.entries.timekeeperName;
    document.retiredLegacy = { commandIds: [COMMAND_1, tombstoneOnlyCommand], writeIds: [retiredWrite], valueIds: [retiredValue, retiredOnlyValue] };
    const next = request({ commandId: COMMAND_3, writeId: WRITE_3, expectedRevision: 3, entries: {}, updatedAt: NOW_2 });
    const receipt = { commandId: next.commandId, commandFingerprint: next.commandFingerprint, writeId: next.writeId,
      expectedRevision: next.expectedRevision, protectedSchemaHash: next.protectedSchemaHash };
    document.history.push({ receipt: { ...receipt, updatedAt: next.updatedAt }, marked: {}, setValueIds: {} });
    document.record.revision = PositiveIntSchema.parse(4); document.record.lastApplied = receipt; document.latestRequest = { kind: "apply", request: next };
    assert.equal(authenticateDocument(document).record.entries.timekeeperName, undefined);
    owner.replaceRecord("protected", frame.revision, document);
    assert.equal(f.store.read().revision, 4); assert.equal(f.store.read().entries.timekeeperName, undefined);
    assert.equal(f.store.ownsCommandId(COMMAND_1), true); assert.equal(f.store.ownsCommandId(tombstoneOnlyCommand), false);
    assert.equal(f.store.acceptedAt(COMMAND_1), undefined); assert.equal(f.store.acceptedAt(tombstoneOnlyCommand), undefined);
    const bytes = readFileSync(f.path);
    for (const reused of [request({ commandId: COMMAND_1, writeId: randomUUID(), expectedRevision: 4 }), request({ commandId: randomUUID(), writeId: retiredWrite, expectedRevision: 4 })]) {
      const result = f.store.apply(reused); assert.equal(result.state, "rejected"); if (result.state === "rejected") assert.equal(result.code, "command-divergent");
      assert.equal(f.store.verifyReplay(reused).state, "rejected");
    }
    const colliding = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, ids: { randomUUID: () => retiredOnlyValue } });
    assert.throws(() => colliding.apply(request({ commandId: randomUUID(), writeId: randomUUID(), expectedRevision: 4, entries: { timekeeperName: { set: "new keeper" } } })), /value identity generation collided/u);
    const revived = structuredClone(document); revived.record.entries.timekeeperName = retiredEntry;
    assert.throws(() => authenticateDocument(revived), /identity history/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { await f.close(); }
});
for (const tamper of ["history-gap", "history-command", "history-value", "frame-revision"] as const)
  it(`refuses authenticated ${tamper} without rewriting or treating it as fresh`, async () => {
    const f = await fixture();
    try {
      applied(f.store, request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
      const owner = createCanonicalCredentials(f.admission), frame = owner.readRecord("protected"); assert.ok(frame);
      const document = structuredClone(authenticateDocument(frame.value));
      if (tamper === "history-gap") document.historyBaseRevision = 2;
    if (tamper === "history-command") { const latest = document.history.at(-1); assert.ok(latest); latest.receipt.commandId = request({ commandId: COMMAND_2 }).commandId; }
      if (tamper === "history-value") { const latest = document.history.at(-1); assert.ok(latest); latest.setValueIds.ucpathPassword = randomUUID(); }
      owner.replaceRecord("protected", frame.revision, document);
      const bytes = readFileSync(f.path);
      assert.throws(() => f.store.read(), tamper === "frame-revision" ? /authenticated revision/u : /identity history/u); assert.throws(() => f.store.apply(request({ commandId: COMMAND_3, writeId: WRITE_3, expectedRevision: 3 })));
      assert.throws(() => f.store.ownsCommandId(COMMAND_1)); assert.throws(() => f.store.acceptedAt(COMMAND_1));
      assert.deepEqual(readFileSync(f.path), bytes);
    } finally { await f.close(); }
  });
it("reports the genuine short canonical writer lease as lock-unavailable without losing its winner", async () => {
  const profile = await freshProfile(), peer = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
  let competing: ReturnType<typeof peer.apply> | undefined;
  const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot, hooks: { afterRename() {
    competing = peer.apply(request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, entries: { timekeeperName: { set: "must not publish" } } }));
  } } });
  try {
    applied(store, request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    assert.deepEqual(competing, { state: "rejected", code: "lock-unavailable", message: "credential store lock is unavailable" });
    assert.equal(peer.read().revision, 2); assert.equal(peer.read().entries.timekeeperName, undefined); assert.equal(peer.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);
  } finally { await profile.close(); }
});
it("admits an owned sticky ancestor while the protected directory and record stay private", async () => {
  const f = await fixture();
  try {
    chmodSync(f.stateRoot, 0o1777);
    assert.equal(f.store.read().revision, 1);
    assert.equal(f.store.apply(request({ entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } })).state, "applied");
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700); assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
  } finally { chmodSync(f.stateRoot, 0o700); await f.close(); }
});
