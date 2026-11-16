import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { initializeCanonicalCredentials, eraseCanonicalDraftCredentials, captureCanonicalDraftErasure, CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { forceExactFileMetadata } from "../../../support/helpers/exact-file-metadata.js";
import * as identities from "../../../../src/backend/storage/file-identity.js";
import { initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it.skipIf(process.platform !== "linux")("refuses an adjacent high-ID credential head after publication capture", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  let substituted = false, captured: Buffer | undefined;
  const restore = forceExactFileMetadata(path => path === headPath, (_path, info) => {
    if (substituted) { assert.equal(Number(info.ino), Number(info.ino + 1n)); info.ino += 1n; }
  });
  const observe = identities.fileIdentityObservation;
  vi.spyOn(identities, "fileIdentityObservation").mockImplementation((identity, options) => {
    const value = observe(identity, options);
    if (options?.preserveSafeNumbers && typeof identity.inode === "bigint" && identity.inode > 2n ** 53n && !substituted) {
      captured = fs.readFileSync(headPath); substituted = true;
    }
    return value;
  });
  try {
    await assert.rejects(f.finish(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.ok(captured); assert.deepEqual(fs.readFileSync(headPath), captured);
    substituted = false;
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    assert.equal(fs.existsSync(join(f.workspace, ".tracker", "control", "profile-publication.json")), false);
  } finally { restore(); await f.close(); }
});

for (const target of ["credentials", "pepper", "database"] as const) it.skipIf(process.platform !== "linux")(`finishes signup with exact high-ID ${target} witnesses`, async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const machine = join(f.machine.stateRoot, "machine"), publicationPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
  const restore = forceExactFileMetadata(path => target === "pepper" ? path === join(machine, "profile-pepper")
    : target === "database" ? path.startsWith(f.path) : path.startsWith(join(f.stateRoot, "credentials"))
      || path.startsWith(join(machine, "credential-keys")) || path.startsWith(join(machine, "duo-credentials")));
  const rename = fs.renameSync;
  let witnessed: unknown;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (destination === publicationPath) {
      const value: unknown = JSON.parse(fs.readFileSync(publicationPath, "utf8"));
      if (typeof value === "object" && value !== null && "kind" in value && value.kind === "onboarding-finish") witnessed = value;
    }
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await f.finish()).state, "active");
    assert.ok(witnessed);
    const journal = witnessed as { credentials: { head: { inode: number | string }; files: { inode: number | string }[] }; pepper: { inode: number | string }; databases: { file?: { inode: number | string } }[] };
    const identities = target === "pepper" ? [journal.pepper] : target === "database" ? journal.databases.flatMap(row => row.file === undefined ? [] : [row.file]) : [journal.credentials.head, ...journal.credentials.files];
    assert.ok(identities.length > 0);
    for (const identity of identities) { assert.equal(typeof identity.inode, "string"); assert.ok(BigInt(identity.inode) > 2n ** 53n); }
    assert.ok(restore.observations.some(observation => observation.source === "descriptor" && observation.inode > 2n ** 53n));
  } finally { restore(); syncBuiltinESMExports(); await f.close(); }
});

it.skipIf(process.platform !== "linux")("erases and removes a draft with exact high-ID credential and membership witnesses", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft?.operationId}.json`);
  const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8"))); assert.ok(operation.onboarding);
  const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding, generation: operation.onboarding.generation + 1,
    abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
  f.machine.publishProfileOperation(abort);
  const root = join(f.machine.stateRoot, "machine"), note = join(f.stateRoot, "retained-note");
  fs.writeFileSync(note, "retained draft member", { mode: 0o600 });
  const restore = forceExactFileMetadata(path => path === note || path.startsWith(join(f.stateRoot, "credentials"))
    || path.startsWith(join(root, "credential-keys")) || path.startsWith(join(root, "duo-credentials")));
  try {
    eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
    const head = captureCanonicalDraftErasure(f.machine, f.admission, abort);
    assert.equal(typeof head.inode, "string"); assert.ok(BigInt(head.inode) > 2n ** 53n);
    assert.equal(f.machine.abortUnpublishedProfile(abort, head), true);
    assert.equal(fs.existsSync(f.stateRoot), false); assert.equal(fs.existsSync(operationPath), false);
  } finally { restore(); await f.close(); }
});

it.skipIf(process.platform !== "linux")("preserves an erase plan on adjacent high-ID substitution after native key deletion", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const id = f.admission.profileBinding.profileId, machine = join(f.machine.stateRoot, "machine");
  const operationPath = join(machine, "operations", `${f.draft?.operationId}.json`);
  const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8"))); assert.ok(operation.onboarding);
  const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding, generation: operation.onboarding.generation + 1,
    abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
  f.machine.publishProfileOperation(abort);
  const sourcePath = join(f.stateRoot, "credentials", "protected.json"), planPath = join(machine, "credential-operations", `${id}.json`), headPath = join(machine, "credential-keys", `${id}.json`);
  let substituted = false, deleted = false;
  const restore = forceExactFileMetadata(path => path === sourcePath || path === headPath, (path, info) => {
    if (substituted && path === sourcePath) { assert.equal(Number(info.ino), Number(info.ino + 1n)); info.ino += 1n; }
  });
  const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${id}`), removeKey = entry.deletePassword.bind(entry);
  const failure = new Error("fixture native key deletion interrupted");
  const fault = vi.spyOn(FakeKeyringEntry.prototype, "deletePassword").mockImplementationOnce(() => { removeKey(); deleted = true; throw failure; });
  try {
    assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, abort), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
    fault.mockRestore(); assert.equal(deleted, true);
    const plan = fs.readFileSync(planPath), head = fs.readFileSync(headPath), source = fs.readFileSync(sourcePath);
    substituted = true;
    assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, abort), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(fs.readFileSync(planPath), plan); assert.deepEqual(fs.readFileSync(headPath), head); assert.deepEqual(fs.readFileSync(sourcePath), source);
    substituted = false;
    eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
    assert.equal(fs.existsSync(sourcePath), false); assert.equal(fs.existsSync(planPath), false); assert.equal(entry.getPassword(), null);
  } finally { restore(); await f.close(); }
});

for (const boundary of ["key-set", "protected", "duo", "chatgpt", "head", "create-consumed"] as const) {
  it(`aborts the genuine fresh create prefix after ${boundary} without restoring a key or prior head`, async () => {
    const f = await createBoundProfileFixture({ pending: "storage" });
    const profileId = f.admission.profileBinding.profileId, operations = join(f.machine.stateRoot, "machine", "operations"),
      operationPath = join(f.machine.stateRoot, "machine", "credential-operations", `${profileId}.json`),
      headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    const names = fs.readdirSync(operations); assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(join(operations, name), "utf8")));
    const paths = { protected: join(f.stateRoot, "credentials", "protected.json"),
      duo: join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
      chatgpt: join(f.stateRoot, "credentials", "chatgpt-account.json"), head: headPath };
    const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`),
      set = entry.setPassword.bind(entry), rename = fs.renameSync, unlink = fs.unlinkSync;
    const failure = new Error("synthetic stopped fresh creation"); let fired = false;
    if (boundary === "key-set") vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementationOnce(value => { set(value); fired = true; throw failure; });
    else if (boundary === "create-consumed") vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
      unlink(path); if (path === operationPath) { fired = true; throw failure; }
    });
    else vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination); if (destination === paths[boundary]) { fired = true; throw failure; }
    });
    syncBuiltinESMExports();
    try {
      const initial = initialDocument();
      assert.throws(() => initializeCanonicalCredentials(f.machine, f.admission, operation, { revision: initial.record.revision, value: initial }));
      assert.equal(fired, true); assert.notEqual(entry.getPassword(), null);
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.ok(operation.onboarding);
    const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding,
      generation: operation.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
    f.machine.publishProfileOperation(abort);
    try {
      eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
      const head = CanonicalCredentialHeadSchema.parse(JSON.parse(fs.readFileSync(headPath, "utf8")));
      assert.equal(head.state, "erased"); assert.equal(head.generation, abort.onboarding?.abort?.generation);
      assert.equal(entry.getPassword(), null); assert.equal(fs.existsSync(operationPath), false);
      for (const path of [paths.protected, paths.duo, paths.chatgpt]) assert.equal(fs.existsSync(path), false);
      const final = fs.readFileSync(headPath);
      eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
      assert.deepEqual(fs.readFileSync(headPath), final); assert.equal(entry.getPassword(), null);
    } finally { await f.close(); }
  });
}

it("preserves the prepared create plan when its native key never became available", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  const profileId = f.admission.profileBinding.profileId, directory = join(f.machine.stateRoot, "machine", "operations"), name = fs.readdirSync(directory)[0]; assert.ok(name);
  const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(join(directory, name), "utf8"))), initial = initialDocument();
  vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementationOnce(() => { throw new Error("synthetic native set never happened"); });
  try { assert.throws(() => initializeCanonicalCredentials(f.machine, f.admission, operation, { revision: initial.record.revision, value: initial })); }
  finally { vi.restoreAllMocks(); }
  const planPath = join(f.machine.stateRoot, "machine", "credential-operations", `${profileId}.json`), plan = fs.readFileSync(planPath);
  assert.ok(operation.onboarding);
  const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding,
    generation: operation.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
  f.machine.publishProfileOperation(abort);
  try {
    const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`);
    assert.equal(entry.getPassword(), null);
    assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, abort), { code: "CREDENTIAL_CREATE_KEY_MISSING" });
    assert.deepEqual(fs.readFileSync(planPath), plan); assert.equal(entry.getPassword(), null);
    assert.equal(fs.existsSync(join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`)), false);
    assert.deepEqual(fs.readdirSync(join(f.stateRoot, "credentials")), []);
  } finally { await f.close(); }
});
