import assert from "node:assert/strict";
import {
chmodSync,
mkdirSync,
mkdtempSync,
readFileSync,
realpathSync,
rmSync,
unlinkSync,
writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import {
PROTECTED_SETTINGS_SCHEMA_HASH,
ProtectedSettingsApplyInputSchema,
type ProtectedSettingsApplyInput,
type ProtectedSettingsPatch,
} from "../../../../src/models/config/protected-settings.js";
import {
createCredentialStore,
type CredentialStoreHooks
} from "../../../support/helpers/synthetic-storage-admission.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIVATE_VALUE_1 = "credential-store-private-one";
const NOW_1 = "2026-09-06T12:00:00.000Z";
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

describe("independent credential store", () => {

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
});
