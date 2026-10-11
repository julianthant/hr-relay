import assert_m0 from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import { copyFileSync as copyFileSync_m0,mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,vi } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0 } from "../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand as executeSettingsCommand_m0,type CommandAuthority as CommandAuthority_m0 } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor as createSettingsApplicationExecutor_m0 } from "../../../src/backend/runs/commands/settings-service.js";
import { createCredentialSecretSource as createCredentialSecretSource_m0 } from "../../../src/backend/runtime/settings/settings-runtime.js";
import type { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0 } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore_m0 } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase_m0 } from "../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0 } from "../../../src/models/config/protected-settings.js";
import { requireSecret as requireSecret_m0 } from "../../../src/models/config/secrets.js";
import { manualClock as manualClock_m0 } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0,createCredentialStore as createCredentialStore_m0,type CredentialStoreHooks as CredentialStoreHooks_m0 } from "../../support/helpers/synthetic-storage-admission.js";

import { default as assert_m1,default as assert_m2 } from "node:assert/strict";
import {
chmodSync as chmodSync_m2,
mkdirSync as mkdirSync_m2,
mkdtempSync as mkdtempSync_m2,
realpathSync as realpathSync_m2,
rmSync as rmSync_m2
} from "node:fs";
import { syncBuiltinESMExports as syncBuiltinESMExports_m2 } from "node:module";
import { tmpdir as tmpdir_m2 } from "node:os";
import { join as join_m2 } from "node:path";
import { afterEach as afterEach_m2,describe as describe_m1,describe as describe_m2,it as it_m1,it as it_m2 } from "vitest";
import { RETIRED_TEST_TARGET_ENVIRONMENT_KEYS as RETIRED_TEST_TARGET_ENVIRONMENT_KEYS_m1 } from "../../../src/models/config/catalog.js";
import {
PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m2,
ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m2,
type ProtectedSettingsApplyInput as ProtectedSettingsApplyInput_m2,
type ProtectedSettingsPatch as ProtectedSettingsPatch_m2
} from "../../../src/models/config/protected-settings.js";
import { SECRET_SPECS as SECRET_SPECS_m1,SecretMissingError as SecretMissingError_m2,assertNoMigratedEnvironmentKeys as assertNoMigratedEnvironmentKeys_m1,inspectSecret as inspectSecret_m1,optionalSecret as optionalSecret_m1,requireSecret as requireSecret_m1,requireSecret as requireSecret_m2,retiredTestTargetEnvironmentRefusal as retiredTestTargetEnvironmentRefusal_m1 } from "../../../src/models/config/secrets.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../support/fixtures/operator-command-fixtures.js";
import { protectedSecretSource as protectedSecretSource_m1 } from "../../support/helpers/protected-secret-source.js";
import {
createCredentialStore as createCredentialStore_m2,
type CredentialStoreHooks as CredentialStoreHooks_m2
} from "../../support/helpers/synthetic-storage-admission.js";


{


const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];
const admissions: RuntimeAdmission_m0[] = [];
const _afterEachFixture0 = () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true }); };
function fixture(hooks?: CredentialStoreHooks_m0, exclusive = false) {
  const repoRoot = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission_m0(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join_m0(repoRoot, rebuildRuntimeIsolation_m0.stateRoot); mkdirSync_m0(root, { recursive: true, mode: 0o700 });
  writeFileSync_m0(join_m0(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock_m0(new Date("2026-09-06T12:00:00Z"));
  const path = join_m0(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase_m0.open(options, clock) : NativeAuthorityDatabase_m0.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig_m0(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore_m0(credentialOptions) : nativeCredentialStore_m0({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor_m0((value) => resolveConfigWithProvenance_m0(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority_m0 = database) => executeSettingsCommand_m0({ authority, clock, ids: { uuid: randomUUID_m0 }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function protectedCommand() {
  return { family: "settings", type: "apply-protected-settings", commandId: randomUUID_m0(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0, writeId: randomUUID_m0(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
}

describe_m0("SQLite settings authority", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("database restore leaves credential revision, availability and next-use value intact", async () => {
    const f = fixture(); const snapshot = join_m0(f.root, "prior.sqlite");
    await f.database.onlineBackupTo(snapshot);
    const request = protectedCommand(); f.execute(request);
    f.database.close(); copyFileSync_m0(snapshot, f.path);
    const restored = AuthorityDatabase_m0.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-proof" }, f.clock); databases.push(restored);
    assert_m0.equal(restored.authority.commands.get(request.commandId), undefined);
    assert_m0.equal(f.store.read().revision, 2);
    assert_m0.equal(requireSecret_m0("ucpathPassword", createCredentialSecretSource_m0(f.store)), "synthetic-private-value");
    assert_m0.equal(f.execute(request, restored).state, "applied");
  });
});
}

{


describe_m1("closed secret access", () => {
  it_m1("resolves only registered names and fails loud at the requested scope", () => {
    const source = protectedSecretSource_m1({ ucpathUserId: "operator" });
    assert_m1.equal(optionalSecret_m1("ucpathUserId", source), "operator");
    assert_m1.equal(requireSecret_m1("ucpathUserId", source), "operator");
    assert_m1.throws(() => requireSecret_m1("ucpathPassword", source), /ucpathPassword/);
  });

  it_m1("reads protected Settings on every use and distinguishes present, missing, and unknown without values", () => {
    let delegate = protectedSecretSource_m1({ ucpathUserId: "first-private-value" });
    let reads = 0;
    const source = { read: () => {
      reads += 1;
      return delegate.read();
    } };
    assert_m1.equal(optionalSecret_m1("ucpathUserId", source), "first-private-value");
    delegate = protectedSecretSource_m1({ ucpathUserId: "second-private-value" });
    assert_m1.equal(optionalSecret_m1("ucpathUserId", source), "second-private-value");
    assert_m1.equal(reads, 2);

    assert_m1.deepEqual(inspectSecret_m1("ucpathPassword", source), {
      name: "ucpathPassword",
      source: "protected-store",
      state: "missing",
      diagnostic: "ucpathPassword is missing from protected-store",
    });
    const privateCorruption = "CANARY_PROTECTED_CORRUPTION";
    delegate = { read: () => ({ privateCorruption }) };
    const unknown = inspectSecret_m1("ucpathPassword", source);
    assert_m1.equal(unknown.state, "unknown");
    assert_m1.equal(JSON.stringify(unknown).includes(privateCorruption), false);
    assert_m1.match(unknown.state === "unknown" ? unknown.diagnostic : "", /could not be resolved from protected-store/u);
  });

  it_m1("keeps protected registry names one-to-one", () => {
    assert_m1.equal(new Set(SECRET_SPECS_m1.map(({ name }) => name)).size, SECRET_SPECS_m1.length);
    assert_m1.equal(SECRET_SPECS_m1.every(({ source }) => source === "protected-store"), true);

    for (const retired of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert_m1.equal(SECRET_SPECS_m1.some(({ name }) => (name as string) === retired), false, retired);
    }
  });

  it_m1("refuses the retired test-target environment keys by name, independently of the catalog", () => {

    assert_m1.deepEqual([...RETIRED_TEST_TARGET_ENVIRONMENT_KEYS_m1], [
      "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      "HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID",
    ]);
    for (const key of RETIRED_TEST_TARGET_ENVIRONMENT_KEYS_m1) {
      const value = "CANARY_RETIRED_ENV_VALUE";
      assert_m1.throws(
        () => assertNoMigratedEnvironmentKeys_m1({ [key]: value }),
        (error: unknown) => {
          const diagnostic = String(error);
          assert_m1.match(diagnostic, new RegExp(`retired test-target environment key ${key} is refused`, "u"));
          assert_m1.match(diagnostic, /config\/test-data\.local\.json, so remove it/u);
          assert_m1.equal(diagnostic.includes(value), false);
          return true;
        },
        key,
      );
      assert_m1.equal(retiredTestTargetEnvironmentRefusal_m1(key), `retired test-target environment key ${key} is refused; test-target inputs live in config/test-data.local.json, so remove it`);
    }
  });
});
}

{


const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const COMMAND_3 = "33333333-3333-4333-8333-333333333333";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WRITE_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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


  it_m2("clears a value and makes the sole reader observe missing and later next-use values", () => {
    const f = fixture();
    const secretSource = { read: () => f.store.read() };
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: 1,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert_m2.equal(requireSecret_m2("ucpathPassword", secretSource), PRIVATE_VALUE_1);

    applied(f.store, request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: 2,
      entries: { ucpathPassword: { clear: true } },
      updatedAt: NOW_2,
    }));
    assert_m2.throws(
      () => requireSecret_m2("ucpathPassword", secretSource),
      (error: unknown) => error instanceof SecretMissingError_m2
        && error.message === "ucpathPassword is missing from registered source protected-store",
    );

    applied(f.store, request({
      commandId: COMMAND_3,
      writeId: WRITE_3,
      expectedRevision: 3,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
    }));
    assert_m2.equal(requireSecret_m2("ucpathPassword", secretSource), PRIVATE_VALUE_2);
  });
});
}
