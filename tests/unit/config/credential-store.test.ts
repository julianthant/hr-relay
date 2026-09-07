import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it, vi } from "vitest";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  type ProtectedSettingsApplyInput,
  type ProtectedSettingsPatch,
} from "../../../src/domain/config/protected-settings.js";
import { SecretMissingError, requireSecret } from "../../../src/domain/secrets.js";
import {
  CredentialStoreCommitUncertainError,
  createCredentialStore,
  type CredentialStoreHooks,
} from "../../../src/infra/config/credential-store.js";
import { observeProcessIdentity } from "../../../src/infra/sqlite/runtime-process-locks.js";

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

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(hooks?: CredentialStoreHooks) {
  const stateRoot = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-store-"));
  roots.push(stateRoot);
  const tracker = join(stateRoot, ".tracker");
  mkdirSync(tracker, { mode: 0o755 });
  chmodSync(tracker, 0o755);
  const store = createCredentialStore({ stateRoot: tracker, hooks });
  return {
    stateRoot,
    tracker,
    directory: join(tracker, "credentials"),
    path: join(tracker, "credentials", "protected.json"),
    lockPath: join(tracker, "credentials", ".protected.lock"),
    store,
  };
}

function crashAfterCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "credential-store.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createCredentialStore } from ${JSON.stringify(moduleUrl)};
     createCredentialStore({
       stateRoot: ${JSON.stringify(stateRoot)},
       hooks: { afterRename: () => process.kill(process.pid, "SIGKILL") },
     }).apply(${JSON.stringify(input)});`,
  ], { encoding: "utf8" });
}

function crashBeforeCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "credential-store.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createCredentialStore } from ${JSON.stringify(moduleUrl)};
     createCredentialStore({
       stateRoot: ${JSON.stringify(stateRoot)},
       hooks: { beforeRename: () => process.kill(process.pid, "SIGKILL") },
     }).apply(${JSON.stringify(input)});`,
  ], { encoding: "utf8" });
}

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

function request(input: {
  readonly commandId: string;
  readonly writeId: string;
  readonly expectedRevision: number;
  readonly entries: ProtectedSettingsPatch;
  readonly updatedAt?: string;
}): ProtectedSettingsApplyInput {
  return ProtectedSettingsApplyInputSchema.parse({
    commandId: input.commandId,
    commandFingerprint: input.commandId === COMMAND_1 ? "1".repeat(64) : "2".repeat(64),
    expectedRevision: input.expectedRevision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: input.writeId,
    entries: input.entries,
    updatedAt: input.updatedAt ?? NOW_1,
  });
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

describe("D336 independent credential store", () => {
  it("keeps absent read/replay read-only, then creates one 0700/0600 authority on first apply", () => {
    const f = fixture();
    const baseline = f.store.read();

    assert.equal(baseline.revision, 1);
    assert.deepEqual(baseline.entries, {});
    assert.equal(lstatSync(f.tracker).mode & 0o777, 0o755);
    assert.equal(existsSync(f.directory), false);
    const absentReplay = f.store.verifyReplay(request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert.equal(absentReplay.state, "rejected");
    assert.equal(existsSync(f.directory), false);

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

  it("clears a value and makes the sole reader observe missing and later next-use values", () => {
    const f = fixture();
    const secretSource = { read: () => f.store.read() };
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert.equal(requireSecret("ucpathPassword", secretSource), PRIVATE_VALUE_1);

    applied(f.store, request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { ucpathPassword: { clear: true } },
      updatedAt: NOW_2,
    }));
    assert.throws(
      () => requireSecret("ucpathPassword", secretSource),
      (error: unknown) => error instanceof SecretMissingError
        && error.message === "ucpathPassword is missing from registered source protected-store",
    );

    applied(f.store, request({
      commandId: COMMAND_3,
      writeId: WRITE_3,
      expectedRevision: 3,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
    }));
    assert.equal(requireSecret("ucpathPassword", secretSource), PRIVATE_VALUE_2);
  });

  it("validates a request before reading private bytes and keeps diagnostics value-free", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { timekeeperName: { set: "private-seed" } },
    }));
    writeFileSync(f.path, `malformed ${PRIVATE_VALUE_1}`, { mode: 0o600 });
    const before = readFileSync(f.path);
    const invalid = {
      ...request({
        commandId: COMMAND_1,
        writeId: WRITE_1,
        expectedRevision: 2,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      }),
      entries: { ucpathPassword: { set: "" } },
    } as ProtectedSettingsApplyInput;

    assert.deepEqual(f.store.apply(invalid), {
      state: "rejected",
      code: "invalid-value",
      message: "credential request is invalid",
    });
    assert.deepEqual(readFileSync(f.path), before);
    assert.throws(
      () => f.store.apply(request({
        commandId: COMMAND_2,
        writeId: WRITE_2,
        expectedRevision: 2,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      })),
      (error: unknown) => error instanceof Error
        && error.message === "credential store protected.json is malformed"
        && !error.message.includes(PRIVATE_VALUE_1)
        && !error.message.includes(PRIVATE_VALUE_2),
    );
  });

  it("refuses insecure permissions, malformed identity history, foreign entries, and lock contention", () => {
    const f = fixture();
    const first = request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    });
    const record = applied(f.store, first);
    const settled = readFileSync(f.path, "utf8");

    chmodSync(f.path, 0o640);
    assert.throws(() => f.store.read(), /protected\.json permissions or identity are invalid/u);
    chmodSync(f.path, 0o600);

    const originalValueId = record.entries.ucpathPassword?.valueId;
    assert.ok(originalValueId);
    const divergentValueId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const firstOccurrence = settled.indexOf(originalValueId);
    assert.notEqual(firstOccurrence, -1);
    writeFileSync(
      f.path,
      `${settled.slice(0, firstOccurrence)}${divergentValueId}${settled.slice(firstOccurrence + originalValueId.length)}`,
      { mode: 0o600 },
    );
    assert.throws(
      () => f.store.read(),
      /credential store protected\.json disagrees with its identity history/u,
    );
    writeFileSync(f.path, settled, { mode: 0o600 });

    writeFileSync(join(f.directory, "foreign.json"), "{}", { mode: 0o600, flag: "wx" });
    assert.throws(() => f.store.read(), /credential directory contains unsettled entries/u);
    unlinkSync(join(f.directory, "foreign.json"));

    const processObservation = observeProcessIdentity(process.pid);
    assert.equal(processObservation.state, "alive");
    if (processObservation.state !== "alive") throw new Error("test process identity is unavailable");
    writeFileSync(f.lockPath, `${JSON.stringify({
      schemaVersion: 1,
      kind: "writer",
      pid: process.pid,
      processIdentity: processObservation.identity,
      acquisitionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })}\n`, { mode: 0o600, flag: "wx" });
    const blocked = f.store.apply(request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { timekeeperName: { set: "lock-contention" } },
    }));
    assert.deepEqual(blocked, {
      state: "rejected",
      code: "lock-unavailable",
      message: "credential store lock is unavailable",
    });
    assert.equal(f.store.read().revision, 2, "a live writer lock does not make read-only observation mutate");
    assert.equal(readFileSync(f.path, "utf8"), settled);
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
    const physicalTracker = join(root, "physical-tracker");
    const linkedTracker = join(root, "linked-tracker");
    mkdirSync(physicalTracker, { mode: 0o700 });
    symlinkSync(physicalTracker, linkedTracker);
    const linkedStore = createCredentialStore({ stateRoot: linkedTracker });
    assert.throws(
      () => linkedStore.read(),
      /credential path ancestry contains a symbolic link/u,
    );
    assert.equal(existsSync(join(physicalTracker, "credentials")), false);
  });

  it("refuses writable non-sticky ancestors before creating credential authority", () => {
    const f = fixture();
    chmodSync(f.stateRoot, 0o777);
    try {
      assert.throws(() => f.store.read(), /group\/world-writable/u);
      assert.throws(() => f.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1,
        expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } })), /group\/world-writable/u);
      assert.equal(existsSync(f.directory), false);
    } finally { chmodSync(f.stateRoot, 0o700); }
    chmodSync(f.stateRoot, 0o1777);
    assert.equal(f.store.read().revision, 1, "trusted sticky ancestors are admitted");
    assert.equal(existsSync(f.directory), false);
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
    assert.throws(() => createCredentialStore({ stateRoot: `${f.stateRoot}/pivot/../.tracker` }), /raw credential path/u);
    assert.equal(existsSync(f.directory), false);
  });

  it("pins ancestor identity across reads even when the credential directory itself is unchanged", () => {
    const f = fixture();
    applied(f.store, request({ commandId: COMMAND_1, writeId: WRITE_1,
      expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } }));
    const bytes = readFileSync(f.path);
    const moved = `${f.stateRoot}-moved`; roots.push(moved);
    renameSync(f.stateRoot, moved); mkdirSync(f.stateRoot, { mode: 0o700 });
    renameSync(join(moved, ".tracker"), f.tracker);
    assert.throws(() => f.store.read(), /ancestor identity changed/u);
    assert.deepEqual(readFileSync(f.path), bytes);
  });

  it("rechecks ancestors after staging and refuses a replacement before rename", () => {
    let replace = false;
    const f = fixture({ beforeRename() {
      if (!replace) return;
      const moved = `${f.stateRoot}-moved`; roots.push(moved);
      renameSync(f.stateRoot, moved); mkdirSync(f.stateRoot, { mode: 0o700 });
      renameSync(join(moved, ".tracker"), f.tracker);
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

  it("recovers a SIGKILL during private upgrade binding without applying a credential", () => {
    const f = fixture();
    const upgradeId = "a".repeat(64);
    const entries = { ucpathPassword: { set: PRIVATE_VALUE_1 } };
    const moduleUrl = pathToFileURL(join(process.cwd(), "src/infra/config/credential-store.ts")).href;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `import { createCredentialStore } from ${JSON.stringify(moduleUrl)};
       createCredentialStore({ stateRoot: ${JSON.stringify(f.tracker)},
         hooks: { beforeRename: () => process.kill(process.pid, "SIGKILL") }
       }).bindUpgrade(${JSON.stringify(upgradeId)}, ${JSON.stringify(entries)});`], { encoding: "utf8" });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(readdirSync(f.directory).filter((name) => name.endsWith(".tmp")).length, 1);
    assert.throws(() => f.store.read(), /unsettled entries/u);
    f.store.bindUpgrade(upgradeId, entries);
    assert.equal(f.store.read().revision, 1);
    assert.deepEqual(f.store.read().entries, {});
    const bytes = readFileSync(f.path);
    const reopened = createCredentialStore({ stateRoot: f.tracker });
    reopened.verifyUpgradeBinding(upgradeId, entries);
    reopened.bindUpgrade(upgradeId, entries);
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.throws(() => reopened.bindUpgrade(upgradeId, { ucpathPassword: { set: PRIVATE_VALUE_2 } }), /credential-import-refused/u);
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(readdirSync(f.directory), ["protected.json"]);
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

  it("recovers a dead pre-rename writer after retained private history exceeds 64 KiB", () => {
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
    assert.ok(retainedBytes.byteLength > 64_000);
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
    assert.ok(settledBytes.byteLength > 64_000);

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
