import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createChatGptCredentialRepository, verifyChatGptCredentialStore, type ChatGptCredentialRecord } from "../../../src/backend/accounts/chatgpt-credential-repository.js";
import { fixtureAdmission, initializeAdmissionFixture, releaseAdmissionFixture } from "../../support/helpers/admission-fixture.js";

function fixture(afterRename?: () => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chatgpt-credential-"))), admission = RuntimeAdmission.syntheticRoots(root, root);
  const repository = createChatGptCredentialRepository({ admission, stateRoot: root, afterRename }), directory = join(root, "chatgpt-credentials"), path = join(directory, "account.json");
  const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
  return { root, admission, repository, directory, path, record, cleanup() { admission.release(); rmSync(root, { recursive: true, force: true }); } };
}
it("absence has no write and credential persistence uses owner-only permissions", async () => {
  const f = fixture(); try { assert.equal(f.repository.read(), undefined); assert.equal(existsSync(f.directory), false);
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    assert.deepEqual(f.repository.read(), f.record); assert.equal(lstatSync(f.directory).mode & 0o777, 0o700); assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
    verifyChatGptCredentialStore({ admission: f.admission, stateRoot: f.root });
  } finally { f.cleanup(); }
});
it("stale revision refuses without changing confirmed bytes", async () => {
  const f = fixture(); try { await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    await assert.rejects(f.repository.withLock(async tx => { tx.replace({ ...f.record, revision: 2 }, null); }), { code: "CHATGPT_CREDENTIAL_CONFLICT" }); assert.deepEqual(readFileSync(f.path), before);
  } finally { f.cleanup(); }
});
it("post-rename uncertainty retains readback and never claims rollback", async () => {
  const f = fixture(() => { throw new Error("synthetic private value must not escape"); }); try {
    await assert.rejects(f.repository.withLock(async tx => { tx.replace(f.record, null); }), error => typeof error === "object" && error !== null && "code" in error && error.code === "CHATGPT_CREDENTIAL_UNCERTAIN" && "message" in error && !String(error.message).includes("private value"));
    assert.deepEqual(f.repository.read(), f.record); assert.equal(existsSync(join(f.directory, ".writer")), false);
  } finally { f.cleanup(); }
});
it("concurrent repository owners cannot race a rotating-token transaction", async () => {
  const f = fixture(); try {
    let release: () => void = () => { throw new Error("not initialized"); }, entered: () => void = () => { throw new Error("not initialized"); };
    const wait = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const first = f.repository.withLock(async tx => { entered(); await wait; tx.replace(f.record, null); }); await started;
    const peer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
    await assert.rejects(peer.withLock(async () => undefined), { code: "CHATGPT_CREDENTIAL_BUSY" }); release(); await first;
  } finally { f.cleanup(); }
});
it("shared admission refuses stale lock cleanup without changing credentials", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chatgpt-credential-shared-")));
  try {
    initializeAdmissionFixture(root);
    const admission = fixtureAdmission(root), stateRoot = admission.stateRoot;
    const repository = createChatGptCredentialRepository({ admission, stateRoot });
    const directory = join(stateRoot, "chatgpt-credentials"), path = join(directory, "account.json");
    const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
    await repository.withLock(async tx => { tx.replace(record, null); });
    const id = randomUUID(), lockPath = join(directory, ".writer"), stagePath = join(directory, `.account.${id}.tmp`);
    const lock = Buffer.from(JSON.stringify({ id, pid: 2_147_483_647, identity: { platform: "linux", startToken: "stale" } }));
    const stage = Buffer.from("interrupted account stage"), account = readFileSync(path);
    writeFileSync(lockPath, lock, { mode: 0o600 }); writeFileSync(stagePath, stage, { mode: 0o600 });

    await assert.rejects(repository.withLock(async () => undefined), {
      code: "CHATGPT_CREDENTIAL_UNAVAILABLE",
      message: "ChatGPT credentials could not be read or saved safely.",
    });
    assert.deepEqual(readFileSync(lockPath), lock);
    assert.deepEqual(readFileSync(stagePath), stage);
    assert.deepEqual(readFileSync(path), account);
    assert.deepEqual(repository.read(), record);
  } finally {
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});
it("exclusive runtime admission recovers a stale credential writer and stage", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chatgpt-credential-exclusive-")));
  try {
    mkdirSync(join(root, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
    const admission = acquireEntrypointAdmission(root, "exclusive");
    try {
      admission.assertExclusive();
      const stateRoot = admission.stateRoot, repository = createChatGptCredentialRepository({ admission, stateRoot });
      const directory = join(stateRoot, "chatgpt-credentials"), path = join(directory, "account.json");
      const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
      await repository.withLock(async tx => { tx.replace(record, null); });
      const id = randomUUID(), lockPath = join(directory, ".writer"), stagePath = join(directory, `.account.${id}.tmp`);
      writeFileSync(lockPath, JSON.stringify({ id, pid: 2_147_483_647, identity: { platform: "linux", startToken: "stale" } }), { mode: 0o600 });
      writeFileSync(stagePath, "interrupted account stage", { mode: 0o600 });

      await repository.withLock(async tx => {
        assert.deepEqual(tx.read(), record);
        tx.replace({ ...record, revision: 2 }, record.revision);
      });
      assert.equal(existsSync(lockPath), false);
      assert.equal(existsSync(stagePath), false);
      assert.deepEqual(repository.read(), { ...record, revision: 2 });
    } finally { admission.release(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("reports credential uncertainty when lock cleanup fails after commit", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.repository.withLock(async tx => {
      tx.replace(f.record, null);
      rmSync(join(f.directory, ".writer"));
    }), { code: "CHATGPT_CREDENTIAL_UNCERTAIN", message: "The ChatGPT credential change could not be confirmed. Read its current state before trying again." });
    assert.deepEqual(f.repository.read(), f.record);
  } finally { f.cleanup(); }
});
for (const unsafe of ["malformed", "oversized", "permission", "hardlink", "symlink", "foreign-file"] as const)
  it(`refuses ${unsafe} credential authority with safe fixed text`, async () => {
    const f = fixture(); try {
      await f.repository.withLock(async tx => { tx.replace(f.record, null); });
      if (unsafe === "malformed") writeFileSync(f.path, '{"private_token":"synthetic-sensitive"');
      if (unsafe === "oversized") writeFileSync(f.path, "x".repeat(64_001));
      if (unsafe === "permission") chmodSync(f.path, 0o644);
      if (unsafe === "hardlink") linkSync(f.path, join(f.root, "copy"));
      if (unsafe === "symlink") { rmSync(f.path); symlinkSync(join(f.root, "target"), f.path); }
      if (unsafe === "foreign-file") writeFileSync(join(f.directory, "unexpected"), "synthetic");
      assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE", message: "ChatGPT credentials could not be read or saved safely." });
    } finally { f.cleanup(); }
  });
it("refuses directory replacement and unadmitted roots", async () => {
  const f = fixture(); try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); rmSync(f.directory, { recursive: true }); mkdirSync(f.directory, { mode: 0o700 });
    assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => createChatGptCredentialRepository({ admission: f.admission, stateRoot: join(f.root, "other") }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
  } finally { f.cleanup(); }
});
