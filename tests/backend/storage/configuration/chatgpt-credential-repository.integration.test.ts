import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once, on } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { testProcessImport } from "../../../support/compiled-process.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createChatGptCredentialRepository, verifyChatGptCredentialStore, type ChatGptCredentialRecord, type ChatGptCredentialTransaction } from "../../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { createBoundProfileFixture, createBoundProfileCredentialStore } from "../../../support/helpers/admission-fixture.js";

async function fixture(afterRename?: () => void) {
  const profile = await createBoundProfileFixture(), root = profile.stateRoot, admission = profile.admission;
  const repository = createChatGptCredentialRepository({ admission, stateRoot: root, afterRename });
  const directory = join(root, "credentials"), path = join(directory, "chatgpt-account.json");
  const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`,
    clientId: "oaiapp_fixture", registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
    session: { accessToken: "synthetic-access-secret", refreshToken: "synthetic-refresh-secret", idToken: "synthetic-id-secret",
      expiresAt: IsoInstantSchema.parse("2026-10-12T12:00:00.000Z"), earliestRefreshAt: null, scopes: [], usePlan: false, usage: "available" } };
  return { profile, root, admission, repository, directory, path, record, cleanup: () => profile.close() };
}
it("valid uninitialized account reads create nothing and persistence encrypts private tokens", async () => {
  const f = await fixture();
  try {
    const names = readdirSync(f.directory).sort(), before = names.map(name => readFileSync(join(f.directory, name)));
    assert.equal(f.repository.read(), undefined); assert.ok(names.includes("chatgpt-account.json"));
    assert.deepEqual(readdirSync(f.directory).sort(), names);
    names.forEach((name, index) => assert.deepEqual(readFileSync(join(f.directory, name)), before[index]));
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    assert.deepEqual(f.repository.read(), f.record);
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700); assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
    const bytes = readFileSync(f.path);
    for (const secret of ["synthetic-access-secret", "synthetic-refresh-secret", "synthetic-id-secret", "synthetic@example.com"])
      assert.equal(bytes.includes(Buffer.from(secret)), false);
    verifyChatGptCredentialStore({ admission: f.admission, stateRoot: f.root });
  } finally { await f.cleanup(); }
});
it("stale and skipped revisions refuse without changing confirmed ciphertext", async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    for (const [revision, expectedRevision] of [[2, null], [3, 1]] as const) {
      await assert.rejects(f.repository.withLock(async tx => { tx.replace({ ...f.record, revision }, expectedRevision); }), { code: "CHATGPT_CREDENTIAL_CONFLICT" });
      assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(f.repository.read(), f.record);
    }
  } finally { await f.cleanup(); }
});
it("post-publication uncertainty retains readback and never claims rollback", async () => {
  const f = await fixture(() => { throw new Error("synthetic private value must not escape"); });
  try {
    await assert.rejects(f.repository.withLock(async tx => { tx.replace(f.record, null); }), {
      code: "CHATGPT_CREDENTIAL_UNCERTAIN", message: "The ChatGPT credential change could not be confirmed. Read its current state before trying again.",
    });
    assert.deepEqual(f.repository.read(), f.record);
    const peer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
    await peer.withLock(async tx => { tx.replace({ ...f.record, revision: 2 }, 1); });
    assert.equal(peer.read()?.revision, 2);
  } finally { await f.cleanup(); }
});
it("concurrent repository owners cannot race a rotating-token transaction and reads stay available", async () => {
  const f = await fixture(), release = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let first: Promise<void> | undefined;
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    first = f.repository.withLock(async tx => { started.resolve(); await release.promise; tx.replace({ ...f.record, revision: 2 }, 1); });
    await started.promise;
    const peer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
    await assert.rejects(peer.withLock(async () => undefined), { code: "CHATGPT_CREDENTIAL_BUSY" });
    assert.deepEqual(peer.read(), f.record);
    release.resolve(); await first;
    assert.deepEqual(peer.read(), { ...f.record, revision: 2 });
  } finally { release.resolve(); await first; await f.cleanup(); }
});
it("settled transactions cannot read or replace credentials", async () => {
  const f = await fixture(); let retained: ChatGptCredentialTransaction | undefined;
  try {
    await f.repository.withLock(async tx => { retained = tx; tx.replace(f.record, null); });
    assert.ok(retained); const transaction = retained; const before = readFileSync(f.path);
    assert.throws(() => transaction.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => transaction.replace({ ...f.record, revision: 2 }, 1), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), before);
  } finally { await f.cleanup(); }
});
it("rejected async bodies release exclusion without writing", async () => {
  const f = await fixture(); const error = new Error("synthetic callback failure");
  try {
    await assert.rejects(f.repository.withLock(async () => { await Promise.resolve(); throw error; }), error);
    assert.equal(f.repository.read(), undefined);
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    assert.deepEqual(f.repository.read(), f.record);
  } finally { await f.cleanup(); }
});
for (const unsafe of ["malformed", "oversized", "permission", "hardlink", "symlink", "foreign-file", "tampered", "missing"] as const)
  it(`refuses ${unsafe} established credential authority with safe fixed text`, async () => {
    const f = await fixture();
    try {
      await f.repository.withLock(async tx => { tx.replace(f.record, null); });
      if (unsafe === "malformed") writeFileSync(f.path, '{"private_token":"synthetic-sensitive"');
      if (unsafe === "oversized") writeFileSync(f.path, "x".repeat(64_001));
      if (unsafe === "permission") chmodSync(f.path, 0o644);
      if (unsafe === "hardlink") linkSync(f.path, join(f.root, "copy"));
      if (unsafe === "symlink") { rmSync(f.path); symlinkSync(join(f.root, "target"), f.path); }
      if (unsafe === "foreign-file") writeFileSync(join(f.directory, "unexpected"), "synthetic");
      if (unsafe === "tampered") {
        const frame = z.object({ ciphertext: z.string().min(4) }).passthrough().parse(JSON.parse(readFileSync(f.path, "utf8")));
        frame.ciphertext = `${frame.ciphertext[0] === "A" ? "B" : "A"}${frame.ciphertext.slice(1)}`;
        writeFileSync(f.path, JSON.stringify(frame));
      }
      if (unsafe === "missing") rmSync(f.path);
      const observed = lstatSync(f.path, { throwIfNoEntry: false }), names = readdirSync(f.directory).sort();
      const before = observed?.isFile() ? readFileSync(f.path) : undefined;
      const target = observed?.isSymbolicLink() ? readlinkSync(f.path) : undefined;
      assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE", message: "ChatGPT credentials could not be read or saved safely." });
      await assert.rejects(f.repository.withLock(async tx => { tx.replace({ ...f.record, revision: 2 }, 1); }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readdirSync(f.directory).sort(), names);
      assert.equal(lstatSync(f.path, { throwIfNoEntry: false })?.mode, observed?.mode);
      assert.equal(lstatSync(f.path, { throwIfNoEntry: false })?.nlink, observed?.nlink);
      if (unsafe === "foreign-file") assert.equal(readFileSync(join(f.directory, "unexpected"), "utf8"), "synthetic");
      if (before !== undefined) assert.deepEqual(readFileSync(f.path), before);
      if (target !== undefined) assert.equal(readlinkSync(f.path), target);
    } finally { await f.cleanup(); }
  });
it("foreign person ciphertext cannot be adopted", async () => {
  const first = await fixture(), second = await fixture();
  try {
    await first.repository.withLock(async tx => { tx.replace(first.record, null); });
    await second.repository.withLock(async tx => { tx.replace(second.record, null); });
    const foreign = readFileSync(first.path); writeFileSync(second.path, foreign);
    assert.throws(() => second.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(second.path), foreign); assert.deepEqual(first.repository.read(), first.record);
  } finally { await first.cleanup(); await second.cleanup(); }
});
it("refuses directory replacement and unadmitted roots", async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    rmSync(f.directory, { recursive: true }); mkdirSync(f.directory, { mode: 0o700 });
    assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => createChatGptCredentialRepository({ admission: f.admission, stateRoot: join(f.root, "other") }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
  } finally { await f.cleanup(); }
});
for (const invalid of ["shape", "revision", "size"] as const) it(`refuses authenticated invalid ${invalid} payloads`, async () => {
  const f = await fixture();
  try {
    const owner = createCanonicalCredentials(f.admission);
    await owner.withChatGptOperation(async tx => {
      tx.replace(invalid === "shape" ? { privateToken: "synthetic-private" }
        : invalid === "revision" ? { ...f.record, revision: 2 }
          : { ...f.record, session: { ...f.record.session, accessToken: "x".repeat(16_385) } }, null);
    });
    const before = readFileSync(f.path);
    assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    await assert.rejects(f.repository.withLock(async tx => { tx.replace({ ...f.record, revision: 2 }, 1); }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), before);
  } finally { await f.cleanup(); }
});
function protectedRequest(expectedRevision: number) {
  return ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "1".repeat(64), writeId: randomUUID(), expectedRevision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-10-12T12:00:00.000Z", entries: { ucpathPassword: { set: "synthetic-protected" } } });
}
it("protected saves complete during an awaited account transaction and retain independent revisions", async () => {
  const f = await fixture(), release = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let account: Promise<void> | undefined;
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    const store = createBoundProfileCredentialStore(f.admission, { stateRoot: f.root }), revision = store.read().revision;
    account = f.repository.withLock(async tx => { started.resolve(); await release.promise; assert.deepEqual(tx.read(), f.record); tx.replace({ ...f.record, revision: 2 }, 1); });
    await started.promise;
    assert.equal(store.apply(protectedRequest(revision)).state, "applied");
    assert.equal(store.read().revision, revision + 1); assert.deepEqual(f.repository.read(), f.record);
    release.resolve(); await account;
    assert.equal(store.read().revision, revision + 1); assert.deepEqual(f.repository.read(), { ...f.record, revision: 2 });
    verifyChatGptCredentialStore({ admission: f.admission, stateRoot: f.root });
  } finally { release.resolve(); await account; await f.cleanup(); }
});
it("unknown stage and lock entries refuse without cleanup", async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    for (const name of [`.chatgpt-account.${randomUUID()}.tmp`, ".unexpected-account.lock", `.protected.${randomUUID()}.${randomUUID()}.tmp`]) {
      const path = join(f.directory, name), bytes = Buffer.from("synthetic-unowned-file");
      writeFileSync(path, bytes, { mode: 0o600 });
      try {
        assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
        await assert.rejects(f.repository.withLock(async () => undefined), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
        assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(f.path), before);
      } finally { rmSync(path); }
    }
  } finally { await f.cleanup(); }
});
it("profile epoch invalidation during an awaited transaction prevents publication", async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    await assert.rejects(f.repository.withLock(async tx => {
      await Promise.resolve(); f.admission.release(); tx.replace({ ...f.record, revision: 2 }, 1);
    }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), before);
  } finally { await f.cleanup(); }
});

it("uncertain credential errors retain private unproved-closure ownership", async () => {
  await runCredentialSourceRetentionCase("chatgpt-source");
});
it("safe account projection retains the actual source descriptor and native lifetime after account drain", async () => {
  await runCredentialSourceRetentionCase("account-projection");
});
it("invalid and oversized replacement payloads cannot change confirmed credentials", async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    assert.ok(f.record.session);
    for (const session of [
      { ...f.record.session, accessToken: "" },
      { ...f.record.session, accessToken: "x".repeat(16_384), refreshToken: "y".repeat(16_384), idToken: "z".repeat(16_384), scopes: ["s".repeat(16_384)] },
    ]) {
      await assert.rejects(f.repository.withLock(async tx => { tx.replace({ ...f.record, revision: 2, session }, 1); }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(f.repository.read(), f.record);
    }
  } finally { await f.cleanup(); }
});

const retainedChatGptProcessOwners = new Set<object>();
it("independent processes exclude awaited token rotations and release account authority before child closure", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const repository = createChatGptCredentialRepository({ admission: profile.admission, stateRoot: profile.stateRoot });
  const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
  const child = fork(fileURLToPath(new URL("../../../support/processes/chatgpt-credential-worker.ts", import.meta.url)),
    [profile.workspace, profile.admission.profileBinding.profileId, String(profile.lifetime.port)],
    { execArgv: ["--import", testProcessImport()], env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderrBytes = 0, closing = false;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
  const events = on(child, "message");
  const closed = once(child, "close").then(values => ({ outcome: z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(values) }))
    .catch((error: unknown) => ({ error }));
  const assertClosed = async () => {
    const result = await closed;
    if ("error" in result) throw result.error;
    assert.deepEqual(result.outcome, [0, null]);
  };
  const held = { profile, repository, child, events, closed };
  retainedChatGptProcessOwners.add(held);
  const event = async (): Promise<unknown> => {
    const next = await Promise.race([events.next(), closed.then(() => { throw new Error("chatgpt-child-exited-before-event"); })]);
    assert.equal(next.done, false); return next.value?.[0];
  };
  let primary: { error: unknown } | undefined;
  const cleanup: unknown[] = [];
  try {
    await repository.withLock(async tx => { tx.replace(record, null); });
    await profile.lifetime.share(child);
    assert.deepEqual(await event(), { type: "ready", pid: child.pid });
    child.send("hold"); assert.deepEqual(await event(), { type: "held", revision: 1 });
    await assert.rejects(repository.withLock(async () => undefined), { code: "CHATGPT_CREDENTIAL_BUSY" });
    assert.deepEqual(repository.read(), record);
    child.send("release"); assert.deepEqual(await event(), { type: "released" });
    assert.deepEqual(repository.read(), { ...record, revision: 2 });
    await repository.withLock(async tx => {
      child.send("probe"); assert.deepEqual(await event(), { type: "refused", code: "CHATGPT_CREDENTIAL_BUSY" });
      tx.replace({ ...record, revision: 3 }, 2);
    });
    child.send("probe"); assert.deepEqual(await event(), { type: "entered", revision: 3 });
    closing = true; child.send("close");
    await assertClosed(); assert.equal(child.connected, false); assert.equal(stderrBytes, 0);
    await repository.withLock(async tx => { tx.replace({ ...record, revision: 4 }, 3); });
    assert.deepEqual(repository.read(), { ...record, revision: 4 });
  } catch (error) { primary = { error }; }
  try {
    if (child.exitCode === null && child.signalCode === null) {
      if (!closing) { closing = true; child.send("close"); }
      await assertClosed();
    }
    assert.equal(child.connected, false); assert.equal(stderrBytes, 0);
    await events.return?.();
    await profile.close();
    retainedChatGptProcessOwners.delete(held);
  } catch (error) { cleanup.push(error); }
  if (primary !== undefined && cleanup.length !== 0) throw new AggregateError([primary.error, ...cleanup], "ChatGPT process fixture closure failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (cleanup.length !== 0) throw new AggregateError(cleanup, "ChatGPT process fixture closure failed", { cause: cleanup[0] });
});

for (const pid of [2_147_483_647, process.pid]) it(`refuses unknown old account lock for PID ${pid} without deleting its files`, async () => {
  const f = await fixture();
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); });
    const before = readFileSync(f.path), id = randomUUID(), lockPath = join(f.directory, ".chatgpt-account.lock"), stagePath = join(f.directory, `.chatgpt-account.${id}.tmp`);
    const lock = Buffer.from(JSON.stringify({ id, pid, identity: { platform: "linux", startToken: "synthetic-unissued-owner" } }));
    const stage = Buffer.from("synthetic-unowned-plaintext-stage");
    writeFileSync(lockPath, lock, { mode: 0o600 }); writeFileSync(stagePath, stage, { mode: 0o600 });
    assert.throws(() => f.repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    await assert.rejects(f.repository.withLock(async () => undefined), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(lockPath), lock); assert.deepEqual(readFileSync(stagePath), stage); assert.deepEqual(readFileSync(f.path), before);
  } finally { await f.cleanup(); }
});

it("unbound synthetic admissions cannot read or overwrite registered-person credentials", async () => {
  const f = await fixture(), unbound = RuntimeAdmission.syntheticRoots(f.root, f.admission.artifactRoot);
  try {
    await f.repository.withLock(async tx => { tx.replace(f.record, null); }); const before = readFileSync(f.path);
    assert.throws(() => createChatGptCredentialRepository({ admission: unbound, stateRoot: f.root }).read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    await assert.rejects(async () => createChatGptCredentialRepository({ admission: unbound, stateRoot: f.root }).withLock(async tx => {
      tx.replace({ ...f.record, revision: 2 }, 1);
    }), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(f.repository.read(), f.record);
  } finally { unbound.release(); await f.cleanup(); }
});
