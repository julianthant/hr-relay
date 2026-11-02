import assert from "node:assert/strict";
import { Entry } from "@napi-rs/keyring";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import { it, vi } from "vitest";
import { CanonicalCredentialError, CanonicalCredentialHeadSchema, createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createCredentialStore, CredentialStoreCommitUncertainError } from "../../../../src/backend/storage/configuration/credential-store.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

function request(expectedRevision: number) {
  return ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "a".repeat(64),
    expectedRevision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-11-01T12:00:00.000Z",
    entries: { timekeeperName: { set: "contention-proof" } } });
}

async function fixture(kind: "protected" | "counter") {
  const actualEntry: unknown = Entry; assert.equal(actualEntry, FakeKeyringEntry);
  const f = await createBoundProfileFixture();
  try {
    const producer = createCanonicalCredentials(f.admission), peer = createCanonicalCredentials(f.admission);
    const protectedStore = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
    const profileId = f.admission.profileBinding.profileId;
    const protectedPath = join(f.stateRoot, "credentials", "protected.json"), duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`);
    const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    const writerPath = join(dirname(headPath), `.${profileId}.writer.lock`);
    const duo = producer.readRecord("duo"); assert.ok(duo);
    const credential = DuoCredentialRecordSchema.parse(duo.value).credentials.find(row => row.state === "ready"); assert.ok(credential);
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(fs.readFileSync(headPath, "utf8"))); assert.equal(head.state, "active");
    if (head.state !== "active") throw new Error("contention fixture requires active canonical head");
    const protectedRevision = protectedStore.read().revision, count = head.counters.find(row => row.credentialId === credential.credentialId)?.count ?? 0;
    const peerRequest = randomUUID(), producerRequest = randomUUID(), input = request(protectedRevision);
    const target = kind === "protected" ? protectedPath : headPath;
    const sources = [protectedPath, duoPath, headPath];
    const snapshot = (paths: readonly string[]) => paths.map(path => ({ path, bytes: fs.readFileSync(path) }));
    const unchanged = (before: ReturnType<typeof snapshot>) => { for (const source of before) assert.deepEqual(fs.readFileSync(source.path), source.bytes); };
    const publish = () => {
      if (kind === "protected") assert.equal(protectedStore.apply(input).state, "applied");
      else assert.deepEqual(producer.reserveDuoCounter(credential.credentialId, producerRequest), { count: count + 1, revision: head.revision + 1 });
    };
    const assertBusy = () => {
      for (const observe of [() => peer.readRecord("protected"), () => peer.assertCurrent(), () => peer.reserveDuoCounter(credential.credentialId, peerRequest)])
        assert.throws(observe, error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_BUSY");
    };
    const assertPublishedAndPeerCanContinue = () => {
      assert.equal(fs.existsSync(writerPath), false);
      assert.equal(protectedStore.read().revision, protectedRevision + (kind === "protected" ? 1 : 0));
      if (kind === "protected") assert.equal(protectedStore.acceptedAt(input.commandId), input.updatedAt);
      const currentHead = CanonicalCredentialHeadSchema.parse(JSON.parse(fs.readFileSync(headPath, "utf8")));
      assert.ok(currentHead.state === "active");
      assert.equal(currentHead.revision, head.revision + (kind === "counter" ? 1 : 0));
      assert.equal(currentHead.counters.find(row => row.credentialId === credential.credentialId)?.count ?? 0, count + (kind === "counter" ? 1 : 0));
      const fresh = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), revision = fresh.read().revision;
      assert.equal(fresh.apply(request(revision)).state, "applied"); assert.equal(fresh.read().revision, revision + 1);
      assert.deepEqual(peer.reserveDuoCounter(credential.credentialId, peerRequest), {
        count: count + (kind === "counter" ? 2 : 1), revision: head.revision + (kind === "counter" ? 2 : 1),
      });
      assert.throws(() => peer.reserveDuoCounter(credential.credentialId, peerRequest), { code: "CREDENTIAL_CONFLICT" });
    };
    return { f, profileId, producer, peer, credentialId: credential.credentialId, peerRequest, target, writerPath, sources,
      snapshot, unchanged, publish, assertBusy, assertPublishedAndPeerCanContinue };
  } catch (error) { await f.close(); throw error; }
}

for (const kind of ["protected", "counter"] as const) for (const boundary of ["empty", "partial", "full"] as const)
  it(`refuses peer access as busy while the genuine ${kind} stage is ${boundary}, then preserves exact publication and next reservation`, async () => {
    const w = await fixture(kind), write = fs.writeFileSync, stat = fs.fstatSync;
    let fired = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof write>) => {
      const [descriptor, bytes] = args;
      if (fired || typeof descriptor !== "number") return write(...args);
      const opened = stat(descriptor), directory = dirname(w.target);
      const name = fs.readdirSync(directory).find(name => name.startsWith(`.${w.profileId}.`) && name.endsWith(".canonical.tmp")
        && fs.lstatSync(join(directory, name)).dev === opened.dev && fs.lstatSync(join(directory, name)).ino === opened.ino);
      if (name === undefined) return write(...args);
      fired = true; assert.ok(Buffer.isBuffer(bytes));
      const stage = join(directory, name), split = Math.floor(bytes.length / 2); assert.ok(split > 0);
      if (boundary === "partial") write(descriptor, bytes.subarray(0, split));
      else if (boundary === "full") write(...args);
      const before = w.snapshot([...w.sources, w.writerPath, stage]);
      assert.equal(fs.lstatSync(stage).size, boundary === "empty" ? 0 : boundary === "partial" ? split : bytes.length);
      w.assertBusy(); w.unchanged(before);
      if (boundary === "partial") write(descriptor, bytes.subarray(split));
      else if (boundary === "empty") write(...args);
    });
    syncBuiltinESMExports();
    try {
      w.publish(); assert.equal(fired, true);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      w.assertPublishedAndPeerCanContinue();
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const boundary of ["before-open", "before-final-path-stat"] as const)
  it(`refuses a peer reservation as busy when a genuine counter publication replaces its head ${boundary}`, async () => {
    const w = await fixture("counter"), open = fs.openSync, lstat = fs.lstatSync, original = fs.lstatSync(w.target);
    let fired = false, observedHead = false, peerDescriptor: number | undefined, published: ReturnType<typeof w.snapshot> | undefined;
    const interleave = () => {
      fired = true;
      assert.equal(observedHead, true);
      if (boundary === "before-open") assert.equal(peerDescriptor, undefined);
      else { assert.ok(peerDescriptor !== undefined); assert.equal(fs.fstatSync(peerDescriptor).ino, original.ino); }
      w.publish();
      assert.notEqual(lstat(w.target).ino, original.ino);
      published = w.snapshot(w.sources);
    };
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof open>) => {
      if (!fired && boundary === "before-open" && String(args[0]) === w.target) interleave();
      const descriptor = open(...args);
      if (!fired && String(args[0]) === w.target) peerDescriptor = descriptor;
      return descriptor;
    });
    vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof lstat>) => {
      if (!fired && String(args[0]) === w.target) {
        if (boundary === "before-final-path-stat" && observedHead) interleave();
        observedHead = true;
      }
      return lstat(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => w.peer.reserveDuoCounter(w.credentialId, w.peerRequest), error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_BUSY");
      assert.equal(fired, true); assert.ok(published); w.unchanged(published);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      w.assertPublishedAndPeerCanContinue();
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const boundary of ["empty", "partial"] as const)
  it(`refuses peer access as busy while the genuine ChatGPT lock is ${boundary} under its canonical writer`, async () => {
    const w = await fixture("protected"), write = fs.writeFileSync;
    const chatPath = join(dirname(w.writerPath), `.${w.profileId}.chatgpt.lock`), before = w.snapshot(w.sources);
    let fired = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof write>) => {
      const [descriptor, bytes] = args;
      if (fired || typeof descriptor !== "number") return write(...args);
      const opened = fs.fstatSync(descriptor), chat = fs.lstatSync(chatPath, { throwIfNoEntry: false });
      if (chat === undefined || opened.dev !== chat.dev || opened.ino !== chat.ino) return write(...args);
      fired = true; assert.ok(Buffer.isBuffer(bytes));
      const split = Math.floor(bytes.length / 2); assert.ok(split > 0);
      if (boundary === "partial") write(descriptor, bytes.subarray(0, split));
      assert.equal(fs.existsSync(w.writerPath), true);
      assert.equal(fs.lstatSync(chatPath).size, boundary === "empty" ? 0 : split);
      const during = w.snapshot([...w.sources, w.writerPath, chatPath]);
      w.assertBusy(); w.unchanged(during);
      if (boundary === "partial") write(descriptor, bytes.subarray(split)); else write(...args);
    });
    syncBuiltinESMExports();
    try {
      await w.producer.withChatGptOperation(async transaction => { assert.equal(transaction.read(), undefined); });
      assert.equal(fired, true); w.unchanged(before);
      assert.equal(fs.existsSync(chatPath), false); assert.equal(fs.existsSync(w.writerPath), false);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      w.publish(); w.assertPublishedAndPeerCanContinue();
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const boundary of ["empty", "partial"] as const)
  it(`refuses peer access as busy while the genuine writer lock is ${boundary} before any stage exists`, async () => {
    const w = await fixture("protected"), write = fs.writeFileSync;
    let fired = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof write>) => {
      const [descriptor, bytes] = args;
      if (fired || typeof descriptor !== "number") return write(...args);
      const opened = fs.fstatSync(descriptor), lock = fs.lstatSync(w.writerPath, { throwIfNoEntry: false });
      if (lock === undefined || opened.dev !== lock.dev || opened.ino !== lock.ino) return write(...args);
      fired = true; assert.ok(Buffer.isBuffer(bytes));
      const split = Math.floor(bytes.length / 2); assert.ok(split > 0);
      if (boundary === "partial") write(descriptor, bytes.subarray(0, split));
      assert.equal(fs.readdirSync(dirname(w.target)).some(name => name.endsWith(".canonical.tmp")), false);
      assert.equal(fs.lstatSync(w.writerPath).size, boundary === "empty" ? 0 : split);
      const before = w.snapshot([...w.sources, w.writerPath]);
      w.assertBusy(); w.unchanged(before);
      if (boundary === "partial") write(descriptor, bytes.subarray(split)); else write(...args);
    });
    syncBuiltinESMExports();
    try {
      w.publish(); assert.equal(fired, true);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      w.assertPublishedAndPeerCanContinue();
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const kind of ["protected", "counter"] as const)
  it(`refuses a peer's real stale directory listing as busy after the genuine ${kind} stage is renamed`, async () => {
    const w = await fixture(kind), rename = fs.renameSync, readdir = fs.readdirSync;
    let probing = false, renamed = false, stage: string | undefined, before: ReturnType<typeof w.snapshot> | undefined;
    vi.spyOn(fs, "readdirSync").mockImplementation((...args: Parameters<typeof readdir>) => {
      const entries = readdir(...args);
      if (probing && !renamed && String(args[0]) === dirname(w.target)) {
        assert.ok(stage); assert.ok(fs.existsSync(stage));
        rename(stage, w.target); renamed = true;
        before = w.snapshot([...w.sources, w.writerPath]);
      }
      return entries;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target) !== w.target || renamed) return rename(source, target);
      stage = String(source); assert.equal(basename(stage).endsWith(".canonical.tmp"), true);
      probing = true;
      try { assert.throws(() => w.peer.reserveDuoCounter(w.credentialId, w.peerRequest), error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_BUSY"); }
      finally { probing = false; }
      assert.equal(renamed, true); assert.ok(before); w.unchanged(before); assert.equal(fs.existsSync(stage), false);
    });
    syncBuiltinESMExports();
    try {
      w.publish(); assert.equal(renamed, true);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      w.assertPublishedAndPeerCanContinue();
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const kind of ["protected", "counter"] as const)
  it(`keeps a genuine unpublished ${kind} stage on maintenance hold without a writer lock`, async () => {
    const w = await fixture(kind), rename = fs.renameSync, interruption = new Error("contention-test-before-real-rename");
    let stage: string | undefined;
    const before = w.snapshot(w.sources);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target) === w.target) { stage = String(source); throw interruption; }
      rename(source, target);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(w.publish, error => kind === "protected"
        ? error instanceof CredentialStoreCommitUncertainError && error.cause instanceof CanonicalCredentialError
          && error.cause.code === "CREDENTIAL_UNCERTAIN" && error.cause.cause === interruption
        : error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNCERTAIN" && error.cause === interruption);
      vi.restoreAllMocks(); syncBuiltinESMExports();
      assert.ok(stage); assert.equal(basename(stage).endsWith(".canonical.tmp"), true);
      assert.equal(fs.existsSync(w.writerPath), false); w.unchanged(before);
      const retained = w.snapshot([...w.sources, stage]);
      for (const observe of [() => w.peer.readRecord("protected"), () => w.peer.assertCurrent(), () => w.peer.reserveDuoCounter(w.credentialId, w.peerRequest)]) {
        assert.throws(observe, error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNAVAILABLE"
          && error.cause instanceof Error && "code" in error.cause && error.cause.code === "CREDENTIAL_OPERATION_PENDING");
        w.unchanged(retained);
      }
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });

for (const kind of ["protected", "counter"] as const)
  it(`refuses byte-identical ${kind} owned-stage substitution during its native read as unavailable without deleting either inode`, async () => {
    const w = await fixture(kind), open = fs.openSync;
    const before = w.snapshot(w.sources), binding = w.f.admission.profileBinding;
    const entry = new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`), key = entry.getPassword(); assert.ok(key !== null);
    const displaced = join(w.f.workspace, `owned-stage-original-${randomUUID()}`);
    let stage: string | undefined, reads = 0, substituted = false, originalInode: number | undefined, foreignInode: number | undefined;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof open>) => {
      const path = String(args[0]);
      if (!substituted && dirname(path) === dirname(w.target) && basename(path).startsWith(`.${w.profileId}.`)
        && path.endsWith(".canonical.tmp") && args[1] === (fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK) && ++reads === 2) {
        substituted = true; stage = path; originalInode = fs.lstatSync(path).ino;
        fs.renameSync(path, displaced); fs.copyFileSync(displaced, path);
        foreignInode = fs.lstatSync(path).ino;
        assert.notEqual(foreignInode, originalInode); assert.deepEqual(fs.readFileSync(path), fs.readFileSync(displaced));
        assert.equal(fs.existsSync(w.writerPath), true);
      }
      return open(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(w.publish, error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNAVAILABLE");
      vi.restoreAllMocks(); syncBuiltinESMExports();
      assert.equal(substituted, true); assert.equal(reads, 2); assert.ok(stage);
      assert.equal(fs.lstatSync(displaced).ino, originalInode); assert.equal(fs.lstatSync(stage).ino, foreignInode);
      assert.deepEqual(fs.readFileSync(stage), fs.readFileSync(displaced));
      assert.equal(fs.existsSync(w.writerPath), false); assert.equal(entry.getPassword() === key, true); w.unchanged(before);
      const retained = w.snapshot([...w.sources, stage, displaced]);
      assert.throws(() => w.peer.assertCurrent(), error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNAVAILABLE"
        && error.cause instanceof Error && "code" in error.cause && error.cause.code === "CREDENTIAL_OPERATION_PENDING");
      w.unchanged(retained);
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });
