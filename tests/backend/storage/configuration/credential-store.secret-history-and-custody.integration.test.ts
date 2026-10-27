import { createCredentialStore as createOwnedCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createCredentialPersistenceFixtures } from "../../../support/helpers/credential-persistence-fixtures.js";
import assert from "node:assert/strict";

import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,describe,it,vi } from "vitest";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { type ProtectedSettingsApplyInput } from "../../../../src/models/config/protected-settings.js";
import { CredentialStoreCommitUncertainError, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const COMMAND_3 = "33333333-3333-4333-8333-333333333333";
const COMMAND_4 = "44444444-4444-4444-8444-444444444444";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WRITE_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WRITE_4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRIVATE_VALUE_1 = "credential-store-private-one";
const PRIVATE_VALUE_2 = "credential-store-private-two";
const NOW_1 = "2026-09-06T12:00:00.000Z";
const NOW_2 = "2026-09-06T12:01:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await releaseFixtures();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const { fixture, releaseFixtures, crashAfterCredentialRename, crashBeforeCredentialRename, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW_1);





function deadLockRecord(kind: "writer" | "reaper", acquisitionId: string) {
  const observation = observeProcessIdentity(process.pid);
  assert.equal(observation.state, "alive");
  if (observation.state !== "alive") throw new Error("test process identity is unavailable");
  return {
    schemaVersion: 1,
    kind,
    pid: 2_147_483_647,
    processIdentity: observation.identity,
    acquisitionId,
  } as const;
}



function applied(
  store: ReturnType<typeof createCredentialStore>,
  input: ProtectedSettingsApplyInput,
) {
  const outcome = store.apply(input);
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential test expected an applied outcome");
  return outcome.record;
}

describe("independent credential store", () => {
  it.each(["directory permissions", "key permissions", "unexpected companion"] as const)(
    "revalidates command ownership after %s change with an unchanged credential file",
    (change) => {
      const f = fixture();
      applied(f.store, request({
        commandId: COMMAND_1,
        writeId: WRITE_1,
        expectedRevision: 1,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
      }));
      assert.equal(f.store.ownsCommandId(COMMAND_1), true);
      assert.equal(f.store.ownsCommandId(COMMAND_1), true);
      const bytes = readFileSync(f.path);
      const key = join(f.machine.stateRoot, "machine", "credential-keys", `${f.operation.profileId}.json`);
      const companion = join(f.directory, "unexpected-companion.json");
      const permissionPath = change === "directory permissions" ? f.directory : key;
      const originalMode = lstatSync(permissionPath).mode & 0o777;
      try {
        if (change === "unexpected companion") writeFileSync(companion, "{}", { mode: 0o600 });
        else chmodSync(permissionPath, 0o755);
        assert.deepEqual(readFileSync(f.path), bytes);
        assert.throws(() => f.store.ownsCommandId(COMMAND_1));
      } finally {
        if (change === "unexpected companion") unlinkSync(companion);
        else chmodSync(permissionPath, originalMode);
      }
      assert.equal(f.store.ownsCommandId(COMMAND_1), true);
      assert.equal(f.store.ownsCommandId(COMMAND_2), false);
    },
  );

  it("keeps admitted initialized read/replay read-only, then atomically advances one 0700/0600 authority", () => {
    const f = fixture();
    const initialBytes = readFileSync(f.path);
    const baseline = f.store.read();

    assert.equal(baseline.revision, 1);
    assert.equal(f.store.ownsCommandId(COMMAND_1), false);
    assert.deepEqual(baseline.entries, {});
    assert.equal(lstatSync(f.tracker).mode & 0o777, 0o700);
    assert.equal(existsSync(f.directory), true);
    const absentReplay = f.store.verifyReplay(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert.equal(absentReplay.state, "rejected");
    assert.deepEqual(readFileSync(f.path), initialBytes);
    assert.equal(existsSync(f.directory), true);

    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
  });

  it("enforces CAS, exact direct replay, and divergent last-command or write identities", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    const firstRecord = applied(f.store, first);
    const settledBytes = readFileSync(f.path);

    assert.equal(firstRecord.revision, 2);
    assert.deepEqual(f.store.apply(first), { state: "applied", record: firstRecord });
    assert.deepEqual(f.store.verifyReplay(first), { state: "applied", record: firstRecord });
    assert.deepEqual(readFileSync(f.path), settledBytes);

    const stale = f.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 1,
      entries: { timekeeperName: { set: "stale-unrelated" } },
    }));
    assert.deepEqual(stale, {
      state: "conflict",
      currentRevision: 2,
      message: "credential revision 1 is stale; current revision is 2",
    });

    for (const divergent of [
      request({
        commandId: COMMAND_1,
        writeId: WRITE_2,
        expectedRevision: 1,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      }),
      request({
        commandId: COMMAND_2,
        writeId: WRITE_1,
        expectedRevision: 1,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      }),
    ]) {
      const outcome = f.store.apply(divergent);
      if (divergent.commandId === COMMAND_2) {
        assert.equal(outcome.state, "conflict");
      } else {
        assert.deepEqual(outcome, {
          state: "rejected",
          code: "command-divergent",
          message: "credential command or write identity differs from its persisted request",
        });
      }
    }
    assert.deepEqual(readFileSync(f.path), settledBytes);
  });

  it("retains every command/write identity while refusing success for an older exact request", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    applied(f.store, first);
    applied(f.store, request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      updatedAt: NOW_2,
    }));

    const historyBytes = readFileSync(f.path);
    assert.equal(f.store.ownsCommandId(COMMAND_1), true);
    assert.equal(f.store.ownsCommandId(COMMAND_2), true);
    assert.equal(f.store.ownsCommandId(COMMAND_3), false);
    assert.deepEqual(readFileSync(f.path), historyBytes);
    assert.equal(f.store.apply(first).state, "conflict");
    const staleDivergent = f.store.apply(request({
      commandId: COMMAND_1,
      writeId: WRITE_3,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: "stale-divergent" } },
    }));
    assert.equal(staleDivergent.state, "conflict");

    for (const reused of [
      request({
        commandId: COMMAND_1,
        writeId: WRITE_3,
        expectedRevision: 3,
        entries: { ucpathPassword: { set: "older-command-reused" } },
      }),
      request({
        commandId: COMMAND_3,
        writeId: WRITE_1,
        expectedRevision: 3,
        entries: { ucpathPassword: { set: "older-write-reused" } },
      }),
    ]) {
      const outcome = f.store.apply(reused);
      assert.equal(outcome.state, "rejected");
      if (outcome.state === "rejected") assert.equal(outcome.code, "command-divergent");
    }
    assert.equal(f.store.read().revision, 3);
  });

  it("rejects an insecure credential directory and a symlink anywhere at the state-root boundary", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));

    chmodSync(f.directory, 0o755);
    assert.throws(() => f.store.read(), /credential directory permissions must be 0700/u);
    chmodSync(f.directory, 0o700);

    const root = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-symlink-"));
    roots.push(root);
    const beforeSymlink = readFileSync(f.path);
    const linkedTracker = f.tracker, physicalTracker = join(root, "physical-tracker");
    renameSync(linkedTracker, physicalTracker);
    symlinkSync(physicalTracker, linkedTracker);
    assert.throws(
      () => createOwnedCredentialStore({ admission: f.admission, stateRoot: linkedTracker, erasureJournalAdmission: f.machine, erasureJournalPath: f.journalPath }),
      /symbolic link/u,
    );
    assert.equal(readFileSync(join(physicalTracker, "credentials", "protected.json")).equals(beforeSymlink), true);
  });

  it.each((["mode", "uid", "nlink"] as const).flatMap((field) => [{ field, lock: false }, { field, lock: true }]))("refuses changed post-read $field metadata (lock=$lock)", ({ field, lock }) => {
    const f = fixture();
    applied(f.store, request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    const path = lock ? f.lockPath : f.path;
    if (lock) writeFileSync(path, `${JSON.stringify(deadLockRecord("writer", "55555555-5555-4555-8555-555555555555"))}\n`, { mode: 0o600 });
    const before = readFileSync(path);
    const inode = lstatSync(path).ino;
    const realFstat = fs.fstatSync;
    let observations = 0;
    vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
      const status = realFstat(descriptor, options);
      if (Number(status.ino) === inode && ++observations === 2) {
        Object.defineProperty(status, field, { value: Number(status[field]) + 1 });
      }
      return status;
    });
    syncBuiltinESMExports();
    const observe = () => lock
      ? f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, entries: { ucpathPassword: { clear: true } } }))
      : f.store.read();
    try { assert.throws(observe, lock ? /credential lock moved while it was read/u : /protected.json moved while it was read/u); }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.equal(observations, 2);
    assert.deepEqual(readFileSync(path), before);
  });

  it("refuses unsafe ancestor mutations without rewriting established credential authority", () => {
    const f = fixture();
    chmodSync(f.stateRoot, 0o777);
    try {
      assert.throws(() => f.store.read(), /group\/world-writable/u);
      assert.throws(() => f.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
        expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } })), /group\/world-writable/u);
      assert.equal(existsSync(f.directory), true);
    } finally { chmodSync(f.stateRoot, 0o700); }
    chmodSync(f.stateRoot, 0o1777);
    assert.equal(f.store.read().revision, 1, "trusted sticky ancestors are admitted");
    assert.equal(existsSync(f.directory), true);
    assert.equal(f.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } })).state, "applied");
    assert.throws(() => f.store.migrateHistory({ operation: f.operation }), /profile-credential-initialization-changed/u);
    assert.equal(existsSync(f.directory), true);
  });

  it("refuses foreign-owned ancestors and raw dot-dot aliases without changing files", () => {
    const f = fixture();
    const realLstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
      const status = realLstat(path, options);
      if (status !== undefined && path === f.stateRoot) status.uid = (process.getuid?.() ?? 1000) + 1;
      return status;
    });
    syncBuiltinESMExports();
    try { assert.throws(() => f.store.read(), /untrusted owner/u); }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.throws(() => createOwnedCredentialStore({ admission: f.admission, stateRoot: `${f.stateRoot}/pivot/../.tracker`, erasureJournalAdmission: f.machine, erasureJournalPath: f.journalPath }), /raw credential path/u);
    assert.equal(existsSync(f.directory), true);
  });

  it("pins ancestor identity across reads even when the credential directory itself is unchanged", () => {
    const f = fixture();
    applied(f.store, request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    const bytes = readFileSync(f.path);
    const moved = `${f.tracker}-moved`; roots.push(moved);
    renameSync(f.tracker, moved); mkdirSync(f.tracker, { mode: 0o700 });
    renameSync(join(moved, "credentials"), f.directory);
    assert.throws(() => f.store.read(), /ancestor identity changed/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  });

  it("rechecks ancestors after staging and refuses a replacement before rename", () => {
    let replace = false;
    const f = fixture({ beforeRename() {
      if (!replace) return;
      const moved = `${f.tracker}-moved`; roots.push(moved);
      renameSync(f.tracker, moved); mkdirSync(f.tracker, { mode: 0o700 });
      renameSync(join(moved, "credentials"), f.directory);
    } });
    applied(f.store, request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    const bytes = readFileSync(f.path); replace = true;
    assert.throws(() => f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2,
      expectedRevision: 2, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } })), /directory-integrity/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  });

  it("keeps a post-rename credential commit and settles its exact retry without rewriting", () => {
    let failAfterRename = true;
    const f = fixture({
      afterRename() {
        if (failAfterRename) {
          failAfterRename = false;
          throw new Error("injected post-rename interruption");
        }
      },
    });
    const first = request({
      commandId: COMMAND_4,
      writeId: WRITE_4,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });

    assert.throws(
      () => f.store.apply(first),
      (error: unknown) => error instanceof CredentialStoreCommitUncertainError
        && error.message === "credential-commit-uncertain: credential commit reached protected.json but completion is uncertain"
        && !error.message.includes(PRIVATE_VALUE_1),
    );
    const committedBytes = readFileSync(f.path);
    assert.equal(f.store.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);

    const retried = f.store.apply(first);
    assert.equal(retried.state, "applied");
    assert.equal(f.store.verifyReplay(first).state, "applied");
    assert.deepEqual(readFileSync(f.path), committedBytes);

    const divergent = f.store.apply(request({
      commandId: COMMAND_4,
      writeId: WRITE_4,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
    }));
    assert.equal(divergent.state, "rejected");
    if (divergent.state === "rejected") assert.equal(divergent.code, "command-divergent");
    assert.deepEqual(readFileSync(f.path), committedBytes);
  });

  it("reports a post-commit lock-release failure as commit-uncertain and exactly retries", () => {
    let ownedLockPath = "";
    const f = fixture({
      afterRename() {
        unlinkSync(ownedLockPath);
      },
    });
    ownedLockPath = f.lockPath;
    const first = request({
      commandId: COMMAND_4,
      writeId: WRITE_4,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });

    assert.throws(
      () => f.store.apply(first),
      (error: unknown) => error instanceof CredentialStoreCommitUncertainError
        && error.message === "credential-commit-uncertain: credential commit reached protected.json but lock release is uncertain",
    );
    const committedBytes = readFileSync(f.path);
    assert.equal(f.store.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);
    assert.equal(f.store.apply(first).state, "applied");
    assert.deepEqual(readFileSync(f.path), committedBytes);
  });

  it("recovers only the authenticated next document left by its dead pre-rename writer", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    const child = crashBeforeCredentialRename(f.tracker, first);

    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(existsSync(f.lockPath), true);
    const stagedNames = readdirSync(f.directory).filter((name) => name.endsWith(".tmp"));
    assert.equal(stagedNames.length, 1);
    assert.throws(() => f.store.read(), /credential directory contains unsettled entries/u);
    assert.equal(readdirSync(f.directory).some((name) => name.endsWith(".tmp")), true);

    const retried = f.store.apply(first);
    assert.equal(retried.state, "applied");
    assert.equal(f.store.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
  });

  it("recovers a dead pre-rename writer without retaining replaced secrets", () => {
    const f = fixture();
    const historyUuid = (prefix: "8" | "9", sequence: number): string => (
      `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`
    );
    const historyValue = (sequence: number): string => (
      `private-history-${String(sequence)}-`.padEnd(3_900, String(sequence % 10))
    );
    const historyLength = 20;
    for (let sequence = 1; sequence <= historyLength; sequence += 1) {
      applied(f.store, request({
        commandId: historyUuid("9", sequence),
        writeId: historyUuid("8", sequence),
        expectedRevision: sequence,
        entries: { ucpathPassword: { set: historyValue(sequence) } },
      }));
    }
    const retainedBytes = readFileSync(f.path);
    assert.equal(retainedBytes.includes(historyValue(1)), false);
    assert.equal(retainedBytes.includes(historyValue(historyLength)), false);
    assert.ok(retainedBytes.byteLength < 64_000);
    assert.ok(retainedBytes.byteLength < 16 * 1024 * 1024);
    assert.equal(f.store.read().revision, historyLength + 1);

    const interrupted = request({
      commandId: historyUuid("9", historyLength + 1),
      writeId: historyUuid("8", historyLength + 1),
      expectedRevision: historyLength + 1,
      entries: { ucpathPassword: { set: historyValue(historyLength + 1) } },
    });
    const child = crashBeforeCredentialRename(f.tracker, interrupted);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(existsSync(f.lockPath), true);
    assert.equal(readdirSync(f.directory).filter((name) => name.endsWith(".tmp")).length, 1);
    assert.deepEqual(readFileSync(f.path), retainedBytes);

    const retried = f.store.apply(interrupted);
    assert.equal(retried.state, "applied");
    assert.equal(f.store.verifyReplay(interrupted).state, "applied");
    assert.equal(f.store.read().revision, historyLength + 2);
    assert.equal(f.store.read().entries.ucpathPassword?.value, historyValue(historyLength + 1));
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
    const settledBytes = readFileSync(f.path);
    assert.equal(settledBytes.includes(historyValue(1)), false);
    assert.equal(settledBytes.includes(historyValue(historyLength + 1)), false);
    assert.ok(settledBytes.byteLength < 64_000);

    const divergent = f.store.apply(request({
      commandId: interrupted.commandId,
      writeId: interrupted.writeId,
      expectedRevision: interrupted.expectedRevision,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
    }));
    assert.equal(divergent.state, "rejected");
    if (divergent.state === "rejected") assert.equal(divergent.code, "command-divergent");

    const staleReusedWrite = f.store.apply(request({
      commandId: historyUuid("9", historyLength + 2),
      writeId: interrupted.writeId,
      expectedRevision: historyLength + 1,
      entries: { timekeeperName: { set: "stale-must-conflict-first" } },
    }));
    assert.equal(staleReusedWrite.state, "conflict");

    for (const reused of [
      request({
        commandId: historyUuid("9", 1),
        writeId: historyUuid("8", historyLength + 2),
        expectedRevision: historyLength + 2,
        entries: { timekeeperName: { set: "old-command-retained" } },
      }),
      request({
        commandId: historyUuid("9", historyLength + 3),
        writeId: historyUuid("8", 1),
        expectedRevision: historyLength + 2,
        entries: { timekeeperName: { set: "old-write-retained" } },
      }),
    ]) {
      const outcome = f.store.apply(reused);
      assert.equal(outcome.state, "rejected");
      if (outcome.state === "rejected") assert.equal(outcome.code, "command-divergent");
    }
    assert.deepEqual(readFileSync(f.path), settledBytes);
  });

  it("preserves and refuses a dead writer staged document with another acquisition identity", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    const child = crashBeforeCredentialRename(f.tracker, first);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const temporaryName = readdirSync(f.directory).find((name) => name.endsWith(".tmp"));
    assert.ok(temporaryName);
    const renamed = temporaryName.replace(
      /^\.protected\.[^.]+\./u,
      ".protected.88888888-8888-4888-8888-888888888888.",
    );
    renameSync(join(f.directory, temporaryName), join(f.directory, renamed));

    assert.throws(
      () => f.store.apply(first),
      /staged credential document is not owned by the dead writer/u,
    );
    assert.equal(existsSync(join(f.directory, renamed)), true);
    assert.equal(existsSync(f.lockPath), true);
  });

  it("fails closed on an interrupted same-inode stale-reaper claim", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    const reaperPath = join(f.directory, ".protected.reaper");
    const claimPath = join(f.directory, ".protected.reaper-claim");
    writeFileSync(f.lockPath, `${JSON.stringify(deadLockRecord(
      "writer",
      "55555555-5555-4555-8555-555555555555",
    ))}\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(reaperPath, `${JSON.stringify(deadLockRecord(
      "reaper",
      "66666666-6666-4666-8666-666666666666",
    ))}\n`, { mode: 0o600, flag: "wx" });
    linkSync(reaperPath, claimPath);

    const outcome = f.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { timekeeperName: { set: "settled-reaper-claim" } },
    }));
    assert.deepEqual(outcome, {
      state: "rejected",
      code: "lock-unavailable",
      message: "credential store lock is unavailable",
    });
    assert.equal(existsSync(reaperPath), true);
    assert.equal(existsSync(claimPath), true);
    assert.equal(lstatSync(reaperPath).ino, lstatSync(claimPath).ino);
    assert.equal(f.store.read().revision, 2);
  });

  it("claims and reaps an unclaimed dead reaper without touching the credential commit", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    const reaperPath = join(f.directory, ".protected.reaper");
    writeFileSync(f.lockPath, `${JSON.stringify(deadLockRecord(
      "writer",
      "55555555-5555-4555-8555-555555555555",
    ))}\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(reaperPath, `${JSON.stringify(deadLockRecord(
      "reaper",
      "66666666-6666-4666-8666-666666666666",
    ))}\n`, { mode: 0o600, flag: "wx" });

    const outcome = f.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { timekeeperName: { set: "reaped-stale-reaper" } },
    }));
    assert.equal(outcome.state, "applied");
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
    assert.equal(f.store.read().revision, 3);
  });

  it("preserves a replacement reaper when an interrupted stale-inode claim disagrees", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    const reaperPath = join(f.directory, ".protected.reaper");
    const claimPath = join(f.directory, ".protected.reaper-claim");
    writeFileSync(f.lockPath, `${JSON.stringify(deadLockRecord(
      "writer",
      "55555555-5555-4555-8555-555555555555",
    ))}\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(reaperPath, `${JSON.stringify(deadLockRecord(
      "reaper",
      "66666666-6666-4666-8666-666666666666",
    ))}\n`, { mode: 0o600, flag: "wx" });
    linkSync(reaperPath, claimPath);
    unlinkSync(reaperPath);
    const replacementBytes = `${JSON.stringify(deadLockRecord(
      "reaper",
      "77777777-7777-4777-8777-777777777777",
    ))}\n`;
    writeFileSync(reaperPath, replacementBytes, { mode: 0o600, flag: "wx" });

    assert.throws(
      () => f.store.apply(request({
        commandId: COMMAND_2,
        writeId: WRITE_2,
        expectedRevision: 2,
        entries: { timekeeperName: { set: "replacement-race" } },
      })),
      /credential reaper changed while its stale inode was claimed/u,
    );
    assert.equal(readFileSync(reaperPath, "utf8"), replacementBytes);
    assert.equal(existsSync(claimPath), true);
    assert.equal(f.store.read().revision, 2);
  });

  it("reaps a SIGKILL-left PID/start-identity lock and exactly retries the renamed commit", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    const child = crashAfterCredentialRename(f.tracker, first);

    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(existsSync(f.lockPath), true);
    assert.equal(f.store.read().entries.ucpathPassword?.value, PRIVATE_VALUE_1);
    assert.equal(f.store.verifyReplay(first).state, "applied");
    assert.equal(existsSync(f.lockPath), true, "read and replay verification leave stale evidence untouched");

    const retried = f.store.apply(first);
    assert.equal(retried.state, "applied");
    assert.equal(existsSync(f.lockPath), false);
    assert.equal(existsSync(join(f.directory, ".protected.reaper")), false);
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
  });
});
