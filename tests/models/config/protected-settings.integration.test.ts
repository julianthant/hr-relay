import { default as assert_m0,default as assert_m1,default as assert_m2 } from "node:assert/strict";
import { spawnSync as spawnSync_m2 } from "node:child_process";
import {
chmodSync as chmodSync_m2,
lstatSync as lstatSync_m1,
mkdirSync as mkdirSync_m2,
mkdtempSync as mkdtempSync_m1,
mkdtempSync as mkdtempSync_m2,
readFileSync as readFileSync_m1,
readFileSync as readFileSync_m2,
readdirSync as readdirSync_m1,
realpathSync as realpathSync_m1,
realpathSync as realpathSync_m2,
rmSync as rmSync_m1,
rmSync as rmSync_m2,
writeFileSync as writeFileSync_m2
} from "node:fs";
import { syncBuiltinESMExports as syncBuiltinESMExports_m2 } from "node:module";
import { tmpdir as tmpdir_m1,tmpdir as tmpdir_m2 } from "node:os";
import { join as join_m1,join as join_m2 } from "node:path";
import { pathToFileURL as pathToFileURL_m2 } from "node:url";
import { isDeepStrictEqual as isDeepStrictEqual_m1 } from "node:util";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,afterEach as afterEach_m2,describe as describe_m0,describe as describe_m1,describe as describe_m2,it as it_m0,it as it_m1,it as it_m2,vi } from "vitest";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as createCredentialStore_m1 } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage as doctorAuthorityStorage_m1 } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m1,PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m2,PROTECTED_SETTINGS_SET_MARKER as PROTECTED_SETTINGS_SET_MARKER_m0,ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m1,ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m2,ProtectedSettingsNameSchema as ProtectedSettingsNameSchema_m1,markProtectedSettingsPatch as markProtectedSettingsPatch_m0,type ProtectedSettingsApplyInput as ProtectedSettingsApplyInput_m2,type ProtectedSettingsPatch as ProtectedSettingsPatch_m1,type ProtectedSettingsPatch as ProtectedSettingsPatch_m2 } from "../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0 } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256Hex_m0 } from "../../../src/rules/validation/sha256.js";
import {
createCredentialStore as createCredentialStore_m2,
type CredentialStoreHooks as CredentialStoreHooks_m2
} from "../../support/helpers/synthetic-storage-admission.js";


{

const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };
describe_m0("native settings domain invariants", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("canonicalizes every protected set to the one journal marker", () => {
    const firstValue = "first-synthetic-value";
    const secondValue = "second-distinct-value";
    const first = markProtectedSettingsPatch_m0({
      ucpathPassword: { set: firstValue },
      timekeeperName: { clear: true },
    });
    const second = markProtectedSettingsPatch_m0({
      ucpathPassword: { set: secondValue },
      timekeeperName: { clear: true },
    });

    assert_m0.deepEqual(first, second);
    assert_m0.deepEqual(first, {
      ucpathPassword: { set: PROTECTED_SETTINGS_SET_MARKER_m0 },
      timekeeperName: { clear: true },
    });
    const journalBytes = canonicalJsonStringify_m0(first);
    assert_m0.equal(journalBytes.includes(firstValue), false);
    assert_m0.equal(journalBytes.includes(secondValue), false);
    assert_m0.equal(journalBytes.includes(sha256Hex_m0(firstValue)), false);
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
  const workspace = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync_m1(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission_m1(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join_m1(root,"state.db");
  const database = AuthorityDatabase_m1.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join_m1(root,"credentials");
  const credentialPath = join_m1(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore_m1({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join_m1(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
}

function writeCredentials(f: ReturnType<typeof fixture>, entries: ProtectedSettingsPatch_m1) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema_m1.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m1,
    writeId: WRITE_ID,
    entries,
    updatedAt: "2026-09-06T20:00:00.000Z",
  }));
  assert_m1.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential fixture failed to apply");
  return outcome.record;
}

function snapshot(root: string): unknown {
  return readdirSync_m1(root).sort().map((name) => {
    const path = join_m1(root, name);
    const stat = lstatSync_m1(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync_m1(path);
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
  const report = await doctorAuthorityStorage_m1(f.admission,f.options);
  assert_m1.ok(isDeepStrictEqual_m1(snapshot(f.root), before), "doctor changed source inventory or bytes");
  assert_m1.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe_m1("credential presence doctor", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("reports every name and presence without a credential value or identity", async () => {
    const f = fixture();
    const record = writeCredentials(f, {
      timekeeperName: { set: "Protected Doctor Canary" },
      ucpathPassword: { set: "doctor-private-password" },
    });

    const report = await unchanged(f);

    assert_m1.deepEqual(report, {
      state: "available",
      entries: ProtectedSettingsNameSchema_m1.options.map((name) => ({
        name,
        present: name === "timekeeperName" || name === "ucpathPassword",
      })),
    });
    const serialized = JSON.stringify(report);
    for (const entry of Object.values(record.entries)) {
      assert_m1.equal(serialized.includes(
        typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value),
      ), false);
      assert_m1.equal(serialized.includes(entry.valueId), false);
      assert_m1.equal(serialized.includes(entry.updatedAt), false);
    }
  });

  it_m1("treats an absent credential store as the read-only empty baseline", async () => {
    const f = fixture();
    assert_m1.deepEqual(await unchanged(f), {
      state: "available",
      entries: ProtectedSettingsNameSchema_m1.options.map((name) => ({ name, present: false })),
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
  syncBuiltinESMExports_m2();
  for (const root of roots.splice(0)) rmSync_m2(root, { recursive: true, force: true });
};

function fixture(hooks?: CredentialStoreHooks_m2) {
  const stateRoot = mkdtempSync_m2(join_m2(realpathSync_m2(tmpdir_m2()), "hr-credential-store-"));
  roots.push(stateRoot);
  const tracker = join_m2(stateRoot, ".tracker");
  mkdirSync_m2(tracker, { mode: 0o755 });
  chmodSync_m2(tracker, 0o755);
  const store = createCredentialStore_m2({ stateRoot: tracker, hooks });
  return {
    stateRoot,
    tracker,
    directory: join_m2(tracker, "credentials"),
    path: join_m2(tracker, "credentials", "protected.json"),
    lockPath: join_m2(tracker, "credentials", ".protected.lock"),
    store,
  };
}

function crashAfterCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput_m2) {
  const moduleUrl = pathToFileURL_m2(join_m2(
    process.cwd(),
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
  )).href;
  return spawnSync_m2(process.execPath, [
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

function crashBeforeCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput_m2) {
  const moduleUrl = pathToFileURL_m2(join_m2(
    process.cwd(),
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
  )).href;
  return spawnSync_m2(process.execPath, [
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
  readonly entries: ProtectedSettingsPatch_m2;
  readonly updatedAt?: string;
}): ProtectedSettingsApplyInput_m2 {
  return ProtectedSettingsApplyInputSchema_m2.parse({
    commandId: input.commandId,
    commandFingerprint: input.commandId === COMMAND_1 ? "1".repeat(64) : "2".repeat(64),
    expectedRevision: input.expectedRevision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m2,
    writeId: input.writeId,
    entries: input.entries,
    updatedAt: input.updatedAt ?? NOW_1,
  });
}

function applied(
  store: ReturnType<typeof createCredentialStore_m2>,
  input: ProtectedSettingsApplyInput_m2,
) {
  const outcome = store.apply(input);
  assert_m2.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential test expected an applied outcome");
  return outcome.record;
}

describe_m2("independent credential store", () => {
afterEach_m2(_afterEachFixture0);


  it_m2("validates a request before reading private bytes and keeps diagnostics value-free", () => {
    const f = fixture();
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { timekeeperName: { set: "private-seed" } },
    }));
    writeFileSync_m2(f.path, `malformed ${PRIVATE_VALUE_1}`, { mode: 0o600 });
    const before = readFileSync_m2(f.path);
    const invalid = {
      ...request({
        commandId: COMMAND_1,
        writeId: WRITE_1,
        expectedRevision: 2,
        entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
      }),
      entries: { ucpathPassword: { set: "" } },
    } as ProtectedSettingsApplyInput_m2;

    assert_m2.deepEqual(f.store.apply(invalid), {
      state: "rejected",
      code: "invalid-value",
      message: "credential request is invalid",
    });
    assert_m2.deepEqual(readFileSync_m2(f.path), before);
    assert_m2.throws(
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

  it_m2.each(["before", "after"] as const)("resolves retry time after a SIGKILL %s credential rename", (boundary) => {
    const f = fixture();
    const input = request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } } });
    const child = boundary === "before" ? crashBeforeCredentialRename(f.tracker, input) : crashAfterCredentialRename(f.tracker, input);
    assert_m2.equal(child.signal, "SIGKILL", child.stderr);
    assert_m2.equal(f.store.acceptedAt(COMMAND_1), boundary === "before" ? undefined : NOW_1);
    const retry = ProtectedSettingsApplyInputSchema_m2.parse({ ...input, updatedAt: boundary === "before" ? NOW_2 : NOW_1 });
    assert_m2.equal(f.store.apply(retry).state, "applied");
    const bytes = readFileSync_m2(f.path);
    assert_m2.equal(f.store.acceptedAt(COMMAND_1), retry.updatedAt);
    const refused = f.store.apply({ ...retry, entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } } });
    assert_m2.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert_m2.equal(refused.code, "command-divergent");
    assert_m2.deepEqual(readFileSync_m2(f.path), bytes);
    assert_m2.equal(f.store.acceptedAt(COMMAND_2), undefined);
  });
});
}
