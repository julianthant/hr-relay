import { createCredentialPersistenceFixtures } from "../../support/helpers/credential-persistence-fixtures.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { randomUUID } from "node:crypto";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import { manualClock, capturedInstantClock } from "../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { default as assert } from "node:assert/strict";

import { copyFileSync, readFileSync } from "node:fs";
import { rmSync } from "node:fs";

import { join } from "node:path";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { vi } from "vitest";

import { createCredentialSecretSource } from "../../../src/backend/runtime/settings/settings-runtime.js";

import { requireSecret } from "../../../src/models/config/secrets.js";

import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";

import { syncBuiltinESMExports } from "node:module";
import { RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../../../src/models/config/catalog.js";

import type { ProtectedSettingsApplyInput } from "../../../src/models/config/protected-settings.js";

import { SECRET_SPECS } from "../../../src/models/config/secrets.js";
import { SecretMissingError } from "../../../src/models/config/secrets.js";
import { assertNoMigratedEnvironmentKeys } from "../../../src/models/config/secrets.js";
import { inspectSecret } from "../../../src/models/config/secrets.js";
import { optionalSecret } from "../../../src/models/config/secrets.js";
import { retiredTestTargetEnvironmentRefusal } from "../../../src/models/config/secrets.js";

import { protectedSecretSource } from "../../support/helpers/protected-secret-source.js";

describe("SQLite settings authority", () => {
  it("database restore leaves credential revision, availability and next-use value intact", async () => {
    const profile = await createBoundProfileFixture(), clock = manualClock(new Date("2026-09-06T12:00:00Z"));
    const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
    const options = { path: profile.path, busyTimeoutMs: 250, migrationOwner: "restore-proof" };
    const pair = { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot };
    const database = AuthorityDatabase.open(profile.admission, options, clock, undefined, undefined, undefined, store);
    let restored: AuthorityDatabase | undefined;
    try {
      seedInitialSettingsRuntimeConfig(database, capturedInstantClock(NOW), pair);
      const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock, pair), store);
      const snapshot = join(profile.stateRoot, "prior.sqlite");
      await database.onlineBackupTo(snapshot);
      const revision = store.read().revision;
      const request = { family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z",
        requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision },
        payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
      assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings }, request).state, "applied");
      const credentialPath = join(profile.stateRoot, "credentials", "protected.json"), credentialBytes = readFileSync(credentialPath);
      database.close(); copyFileSync(snapshot, profile.path);
      restored = AuthorityDatabase.open(profile.admission, options, clock, undefined, undefined, undefined, store);
      assert.equal(restored.authority.commands.get(request.commandId), undefined);
      assert.equal(store.read().revision, revision + 1);
      assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(store)), "synthetic-private-value");
      assert.equal(executeSettingsCommand({ authority: restored, clock, ids: { uuid: randomUUID }, settings }, request).state, "applied");
      assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    } finally { restored?.close(); database.close(); await profile.close(); }
  });
});

{

describe("closed secret access", () => {
  it("resolves only registered names and fails loud at the requested scope", () => {
    const source = protectedSecretSource({ ucpathUserId: "operator" });
    assert.equal(optionalSecret("ucpathUserId", source), "operator");
    assert.equal(requireSecret("ucpathUserId", source), "operator");
    assert.throws(() => requireSecret("ucpathPassword", source), /ucpathPassword/);
  });

  it("reads protected Settings on every use and distinguishes present, missing, and unknown without values", () => {
    let delegate = protectedSecretSource({ ucpathUserId: "first-private-value" });
    let reads = 0;
    const source = { read: () => {
      reads += 1;
      return delegate.read();
    } };
    assert.equal(optionalSecret("ucpathUserId", source), "first-private-value");
    delegate = protectedSecretSource({ ucpathUserId: "second-private-value" });
    assert.equal(optionalSecret("ucpathUserId", source), "second-private-value");
    assert.equal(reads, 2);

    assert.deepEqual(inspectSecret("ucpathPassword", source), {
      name: "ucpathPassword",
      source: "protected-store",
      state: "missing",
      diagnostic: "ucpathPassword is missing from protected-store",
    });
    const privateCorruption = "CANARY_PROTECTED_CORRUPTION";
    delegate = { read: () => ({ privateCorruption }) };
    const unknown = inspectSecret("ucpathPassword", source);
    assert.equal(unknown.state, "unknown");
    assert.equal(JSON.stringify(unknown).includes(privateCorruption), false);
    assert.match(unknown.state === "unknown" ? unknown.diagnostic : "", /could not be resolved from protected-store/u);
  });

  it("keeps protected registry names one-to-one", () => {
    assert.equal(new Set(SECRET_SPECS.map(({ name }) => name)).size, SECRET_SPECS.length);
    assert.equal(SECRET_SPECS.every(({ source }) => source === "protected-store"), true);

    for (const retired of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert.equal(SECRET_SPECS.some(({ name }) => (name as string) === retired), false, retired);
    }
  });

  it("refuses the retired test-target environment keys by name, independently of the catalog", () => {

    assert.deepEqual([...RETIRED_TEST_TARGET_ENVIRONMENT_KEYS], [
      "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      "HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID",
    ]);
    for (const key of RETIRED_TEST_TARGET_ENVIRONMENT_KEYS) {
      const value = "CANARY_RETIRED_ENV_VALUE";
      assert.throws(
        () => assertNoMigratedEnvironmentKeys({ [key]: value }),
        (error: unknown) => {
          const diagnostic = String(error);
          assert.match(diagnostic, new RegExp(`retired test-target environment key ${key} is refused`, "u"));
          assert.match(diagnostic, /config\/test-data\.local\.json, so remove it/u);
          assert.equal(diagnostic.includes(value), false);
          return true;
        },
        key,
      );
      assert.equal(retiredTestTargetEnvironmentRefusal(key), `retired test-target environment key ${key} is refused; test-target inputs live in config/test-data.local.json, so remove it`);
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

const _afterEachFixture0 = async () => {
  await releaseFixtures();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

const { fixture, releaseFixtures, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW_1);

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
afterEach(_afterEachFixture0);

  it("clears a value and makes the sole reader observe missing and later next-use values", async () => {
    const f = await fixture();
    const secretSource = { read: () => f.store.read() };
    const revision = f.store.read().revision;
    applied(f.store, request({
      commandId: COMMAND_1,
      writeId: WRITE_1,
      expectedRevision: revision,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_1 } },
    }));
    assert.equal(requireSecret("ucpathPassword", secretSource), PRIVATE_VALUE_1);

    applied(f.store, request({
      commandId: COMMAND_2,
      writeId: WRITE_2,
      expectedRevision: revision + 1,
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
      expectedRevision: revision + 2,
      entries: { ucpathPassword: { set: PRIVATE_VALUE_2 } },
    }));
    assert.equal(requireSecret("ucpathPassword", secretSource), PRIVATE_VALUE_2);
  });
});
}
