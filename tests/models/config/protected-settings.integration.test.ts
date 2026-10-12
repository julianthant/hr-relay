import { default as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { lstatSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { realpathSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import { PROTECTED_SETTINGS_SET_MARKER } from "../../../src/models/config/protected-settings.js";
import { ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { ProtectedSettingsNameSchema } from "../../../src/models/config/protected-settings.js";
import { markProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import type { ProtectedSettingsApplyInput } from "../../../src/models/config/protected-settings.js";
import type { ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { createCredentialStore as createCredentialStore_m2 } from "../../support/helpers/synthetic-storage-admission.js";
import type { CredentialStoreHooks } from "../../support/helpers/synthetic-storage-admission.js";

{

const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };
describe("native settings domain invariants", () => {
afterEach(_afterEachFixture0);

  it("canonicalizes every protected set to the one journal marker", () => {
    const firstValue = "first-synthetic-value";
    const secondValue = "second-distinct-value";
    const first = markProtectedSettingsPatch({
      ucpathPassword: { set: firstValue },
      timekeeperName: { clear: true },
    });
    const second = markProtectedSettingsPatch({
      ucpathPassword: { set: secondValue },
      timekeeperName: { clear: true },
    });

    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      ucpathPassword: { set: PROTECTED_SETTINGS_SET_MARKER },
      timekeeperName: { clear: true },
    });
    const journalBytes = canonicalJsonStringify(first);
    assert.equal(journalBytes.includes(firstValue), false);
    assert.equal(journalBytes.includes(secondValue), false);
    assert.equal(journalBytes.includes(sha256Hex(firstValue)), false);
  });
});
}

{

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

function fixture() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join(root,"state.db");
  const database = AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join(root,"credentials");
  const credentialPath = join(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
}

function writeCredentials(f: ReturnType<typeof fixture>, entries: ProtectedSettingsPatch) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: WRITE_ID,
    entries,
    updatedAt: "2026-09-06T20:00:00.000Z",
  }));
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential fixture failed to apply");
  return outcome.record;
}

function snapshot(root: string): unknown {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync(path);
    return {
      name,
      mode: stat.mode,
      uid: stat.uid,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      content: stat.isDirectory() ? snapshot(path) : bytes?.toString("base64"),
    };
  });
}

async function unchanged(f: ReturnType<typeof fixture>) {
  const meta = f.database.getMeta();
  const before = snapshot(f.root);
  const report = await doctorAuthorityStorage(f.admission,f.options);
  assert.ok(isDeepStrictEqual(snapshot(f.root), before), "doctor changed source inventory or bytes");
  assert.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe("credential presence doctor", () => {
afterEach(_afterEachFixture0);

  it("reports every name and presence without a credential value or identity", async () => {
    const f = fixture();
    const record = writeCredentials(f, {
      timekeeperName: { set: "Protected Doctor Canary" },
      ucpathPassword: { set: "doctor-private-password" },
    });

    const report = await unchanged(f);

    assert.deepEqual(report, {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({
        name,
        present: name === "timekeeperName" || name === "ucpathPassword",
      })),
    });
    const serialized = JSON.stringify(report);
    for (const entry of Object.values(record.entries)) {
      assert.equal(serialized.includes(
        typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value),
      ), false);
      assert.equal(serialized.includes(entry.valueId), false);
      assert.equal(serialized.includes(entry.updatedAt), false);
    }
  });

  it("treats an absent credential store as the read-only empty baseline", async () => {
    const f = fixture();
    assert.deepEqual(await unchanged(f), {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({ name, present: false })),
    });
  });
});
}

{

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIVATE_VALUE_1 = "credential-store-private-one";
const PRIVATE_VALUE_2 = "credential-store-private-two";
const NOW_1 = "2026-09-06T12:00:00.000Z";
const NOW_2 = "2026-09-06T12:01:00.000Z";
const roots: string[] = [];

const _afterEachFixture0 = () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

function fixture(hooks?: CredentialStoreHooks) {
  const stateRoot = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-store-"));
  roots.push(stateRoot);
  const tracker = join(stateRoot, ".tracker");
  mkdirSync(tracker, { mode: 0o755 });
  chmodSync(tracker, 0o755);
  const store = createCredentialStore_m2({ stateRoot: tracker, hooks });
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
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
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
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
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
  store: ReturnType<typeof createCredentialStore_m2>,
  input: ProtectedSettingsApplyInput,
) {
  const outcome = store.apply(input);
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential test expected an applied outcome");
  return outcome.record;
}

describe("independent credential store", () => {
afterEach(_afterEachFixture0);

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

  it.each(["before", "after"] as const)("resolves retry time after a SIGKILL %s credential rename", (boundary) => {
    const f = fixture();
    const input = request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } });
    const child = boundary === "before" ? crashBeforeCredentialRename(f.tracker, input) : crashAfterCredentialRename(f.tracker, input);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(f.store.acceptedAt(COMMAND_1), boundary === "before" ? undefined : NOW_1);
    const retry = ProtectedSettingsApplyInputSchema.parse({ ...input, updatedAt: boundary === "before" ? NOW_2 : NOW_1 });
    assert.equal(f.store.apply(retry).state, "applied");
    const bytes = readFileSync(f.path);
    assert.equal(f.store.acceptedAt(COMMAND_1), retry.updatedAt);
    const refused = f.store.apply({ ...retry, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } });
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "command-divergent");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.equal(f.store.acceptedAt(COMMAND_2), undefined);
  });
});
}
