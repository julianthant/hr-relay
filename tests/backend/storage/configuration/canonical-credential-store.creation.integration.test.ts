import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { initializeCanonicalCredentials, eraseCanonicalDraftCredentials, CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const boundary of ["key-set", "protected", "duo", "chatgpt", "head", "create-consumed"] as const) {
  it(`aborts the genuine fresh create prefix after ${boundary} without restoring a key or prior head`, async () => {
    const f = await createBoundProfileFixture({ pending: "storage" });
    const profileId = f.admission.profileBinding.profileId, operations = join(f.machine.stateRoot, "machine", "operations"),
      operationPath = join(f.machine.stateRoot, "machine", "credential-operations", `${profileId}.json`),
      headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    const names = fs.readdirSync(operations); assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(join(operations, name), "utf8")));
    const paths = { protected: join(f.stateRoot, "credentials", "protected.json"),
      duo: join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
      chatgpt: join(f.stateRoot, "credentials", "chatgpt-account.json"), head: headPath };
    const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`),
      set = entry.setPassword.bind(entry), rename = fs.renameSync, unlink = fs.unlinkSync;
    const failure = new Error("synthetic stopped fresh creation"); let fired = false;
    if (boundary === "key-set") vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementationOnce(value => { set(value); fired = true; throw failure; });
    else if (boundary === "create-consumed") vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
      unlink(path); if (path === operationPath) { fired = true; throw failure; }
    });
    else vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination); if (destination === paths[boundary]) { fired = true; throw failure; }
    });
    syncBuiltinESMExports();
    try {
      const initial = initialDocument();
      assert.throws(() => initializeCanonicalCredentials(f.machine, f.admission, operation, { revision: initial.record.revision, value: initial }));
      assert.equal(fired, true); assert.notEqual(entry.getPassword(), null);
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.ok(operation.onboarding);
    const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding,
      generation: operation.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
    f.machine.publishProfileOperation(abort);
    try {
      eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
      const head = CanonicalCredentialHeadSchema.parse(JSON.parse(fs.readFileSync(headPath, "utf8")));
      assert.equal(head.state, "erased"); assert.equal(head.generation, abort.onboarding?.abort?.generation);
      assert.equal(entry.getPassword(), null); assert.equal(fs.existsSync(operationPath), false);
      for (const path of [paths.protected, paths.duo, paths.chatgpt]) assert.equal(fs.existsSync(path), false);
      const final = fs.readFileSync(headPath);
      eraseCanonicalDraftCredentials(f.machine, f.admission, abort);
      assert.deepEqual(fs.readFileSync(headPath), final); assert.equal(entry.getPassword(), null);
    } finally { await f.close(); }
  });
}

it("preserves the prepared create plan when its native key never became available", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  const profileId = f.admission.profileBinding.profileId, directory = join(f.machine.stateRoot, "machine", "operations"), name = fs.readdirSync(directory)[0]; assert.ok(name);
  const operation = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(join(directory, name), "utf8"))), initial = initialDocument();
  vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementationOnce(() => { throw new Error("synthetic native set never happened"); });
  try { assert.throws(() => initializeCanonicalCredentials(f.machine, f.admission, operation, { revision: initial.record.revision, value: initial })); }
  finally { vi.restoreAllMocks(); }
  const planPath = join(f.machine.stateRoot, "machine", "credential-operations", `${profileId}.json`), plan = fs.readFileSync(planPath);
  assert.ok(operation.onboarding);
  const abort = SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding,
    generation: operation.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
  f.machine.publishProfileOperation(abort);
  try {
    const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`);
    assert.equal(entry.getPassword(), null);
    assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, abort), { code: "CREDENTIAL_CREATE_KEY_MISSING" });
    assert.deepEqual(fs.readFileSync(planPath), plan); assert.equal(entry.getPassword(), null);
    assert.equal(fs.existsSync(join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`)), false);
    assert.deepEqual(fs.readdirSync(join(f.stateRoot, "credentials")), []);
  } finally { await f.close(); }
});
