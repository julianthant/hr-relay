import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { createCredentialStore, authenticateDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const tamper of ["ciphertext", "nonce", "tag", "installationId", "profileId", "keyId", "generation", "revision", "kind", "algorithm"] as const)
  it(`authenticates protected history without SQLite and refuses altered ${tamper}`, async () => {
    const f = await createBoundProfileFixture(), store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
    const path = join(f.stateRoot, "credentials", "protected.json");
    try {
      const first = store.read();
      const request = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "d".repeat(64), expectedRevision: first.revision,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: "2026-10-21T12:00:00.000Z",
        entries: { timekeeperName: { set: "Synthetic Keeper" }, sharepointOnboardingRosterUrl: { set: "https://synthetic.example.edu/roster" } } });
      assert.equal(store.apply(request).state, "applied");
      const partial = ProtectedSettingsApplyInputSchema.parse({ ...request, commandId: randomUUID(), writeId: randomUUID(), expectedRevision: first.revision + 1,
        entries: { timekeeperName: { set: "Synthetic Replacement" } } });
      assert.equal(store.apply(partial).state, "applied");
      assert.equal(store.read().entries.sharepointOnboardingRosterUrl?.value, "https://synthetic.example.edu/roster");
      assert.equal(store.verifyReplay(partial).state, "applied");
      assert.equal(store.verifyReplay({ ...partial, entries: { timekeeperName: { set: "Synthetic Divergence" } } }).state, "rejected");
      const frame = createCanonicalCredentials(f.admission).readRecord("protected"); assert.ok(frame);
      assert.equal(authenticateDocument(frame.value).schemaVersion, 4);
      const before = readFileSync(path), envelope = z.record(z.string(), z.unknown()).parse(JSON.parse(before.toString("utf8")));
      assert.equal(envelope.schemaVersion, 1);
      for (const value of ["Synthetic Replacement", "https://synthetic.example.edu/roster", "disposable-fixture-password"]) assert.equal(before.includes(Buffer.from(value)), false);
      if (tamper === "algorithm") envelope.algorithm = "synthetic-unsupported";
      else if (tamper === "generation" || tamper === "revision") envelope[tamper] = z.number().int().parse(envelope[tamper]) + 1;
      else {
        const value = z.string().parse(envelope[tamper]);
        envelope[tamper] = tamper === "installationId" || tamper === "profileId" || tamper === "keyId" ? randomUUID()
          : tamper === "kind" ? "chatgpt" : `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
      }
      writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 }); const altered = readFileSync(path);
      assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.throws(() => store.apply(ProtectedSettingsApplyInputSchema.parse({ ...partial, commandId: randomUUID(), writeId: randomUUID(), expectedRevision: first.revision + 2 })), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(path), altered);
      writeFileSync(path, before, { mode: 0o600 });
      assert.equal(store.read().entries.timekeeperName?.value, "Synthetic Replacement");
    } finally { await f.close(); }
  });

it("requires the current person/key head without regenerating missing or adopting foreign authority", async () => {
  const f = await createBoundProfileFixture(), other = await createBoundProfileFixture();
  const path = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  try {
    const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), before = store.read(), bytes = readFileSync(path);
    const ciphertextPath = join(f.stateRoot, "credentials", "protected.json"), ciphertext = readFileSync(ciphertextPath);
    unlinkSync(path); assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "d".repeat(64), expectedRevision: before.revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: "2026-10-21T12:00:00.000Z", entries: {} })), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(ciphertextPath), ciphertext);
    const foreign = readFileSync(join(other.machine.stateRoot, "machine", "credential-keys", `${other.admission.profileBinding.profileId}.json`));
    writeFileSync(path, foreign, { mode: 0o600 }); assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(path), foreign); assert.deepEqual(readFileSync(ciphertextPath), ciphertext);
    writeFileSync(path, bytes, { mode: 0o600 }); assert.deepEqual(store.read(), before);
  } finally { await f.close(); await other.close(); }
});

it("requires authenticated external key metadata and never repairs it on read", async () => {
  const f = await createBoundProfileFixture();
  const path = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), before = readFileSync(path);
  try {
    const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), record = store.read();
    const head = z.record(z.string(), z.unknown()).parse(JSON.parse(before.toString("utf8"))); delete head.key;
    writeFileSync(path, JSON.stringify(head), { mode: 0o600 }); const missing = readFileSync(path);
    assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" }); assert.deepEqual(readFileSync(path), missing);
    writeFileSync(path, before, { mode: 0o600 }); assert.deepEqual(store.read(), record);
  } finally { writeFileSync(path, before, { mode: 0o600 }); await f.close(); }
});
