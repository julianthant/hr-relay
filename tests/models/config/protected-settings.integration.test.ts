import { join } from "node:path";
import { createCredentialDoctorWriter } from "../../support/helpers/credential-doctor-fixtures.js";
import { createCredentialDoctorFixtures } from "../../support/helpers/credential-doctor-fixtures.js";
import { createCredentialPersistenceFixtures } from "../../support/helpers/credential-persistence-fixtures.js";
import { default as assert } from "node:assert/strict";





import { readFileSync, unlinkSync } from "node:fs";


import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";



import { isDeepStrictEqual } from "node:util";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { vi } from "vitest";



import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";

import { PROTECTED_SETTINGS_SET_MARKER } from "../../../src/models/config/protected-settings.js";
import { ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { ProtectedSettingsNameSchema } from "../../../src/models/config/protected-settings.js";
import { markProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import type { ProtectedSettingsApplyInput } from "../../../src/models/config/protected-settings.js";

import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { createCredentialStore as createCredentialStore_m2 } from "../../support/helpers/synthetic-storage-admission.js";


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

const { fixture, snapshot } = createCredentialDoctorFixtures(cleanups);

const writeCredentials = createCredentialDoctorWriter(COMMAND_ID, WRITE_ID);



async function unchanged(f: ReturnType<typeof fixture>) {
  const meta = f.database.getMeta();
  const before = snapshot(f.machineRoot), controlBefore = snapshot(join(f.workspace, ".tracker", "control"));
  const report = await doctorAuthorityStorage(f.admission,f.options, undefined, f.credentialStore);
  assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before), "doctor changed profile or machine key/journal bytes");
  assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), controlBefore), "doctor changed control bytes");
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

  it("refuses missing or foreign credential owners without changing authority", async () => {
    const f = fixture(), other = fixture();
    const before = snapshot(f.machineRoot), control = snapshot(join(f.workspace, ".tracker", "control")), meta = f.database.getMeta();
    for (const owner of [undefined, other.credentialStore]) {
      const report = await doctorAuthorityStorage(f.admission, f.options, undefined, owner);
      assert.equal(report.protectedSettings.state, "unavailable");
      assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before));
      assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), control));
      assert.deepEqual(f.database.getMeta(), meta);
    }
  });

  it("refuses a missing established credential document without creating a baseline", async () => {
    const f = fixture();
    unlinkSync(f.credentialPath);
    assert.equal((await unchanged(f)).state, "unavailable");
  });

  it("observes an authenticated empty credential record without creating a baseline", async () => {
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
  releaseFixtures();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

const { fixture, releaseFixtures, crashAfterCredentialRename, crashBeforeCredentialRename, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW_1);







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
