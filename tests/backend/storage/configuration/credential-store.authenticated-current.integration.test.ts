import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const tamper of ["ciphertext", "nonce", "tag", "installationId", "profileId", "keyId", "algorithm"] as const) it(`authenticates every current field with SQLite closed and refuses altered ${tamper}`, async () => {
  const f = await createBoundProfileFixture(), store = boundProfileCredentials(f.admission);
  const path = join(f.stateRoot, "credentials", "protected.json");
  try {
    const first = store.read();
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "d".repeat(64),
      expectedRevision: first.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: "2026-10-21T12:00:00.000Z",
      entries: { timekeeperName: { set: "Synthetic Keeper" }, sharepointOnboardingRosterUrl: { set: "https://synthetic.example.edu/roster" } } });
    assert.equal(store.apply(request).state, "applied");
    const partial = ProtectedSettingsApplyInputSchema.parse({ ...request, commandId: randomUUID(), writeId: randomUUID(), expectedRevision: first.revision + 1,
      entries: { timekeeperName: { set: "Synthetic Replacement" } } });
    assert.equal(store.apply(partial).state, "applied");
    assert.equal(store.read().entries.sharepointOnboardingRosterUrl?.value, "https://synthetic.example.edu/roster");
    assert.equal(store.verifyReplay(partial).state, "applied");
    assert.equal(store.verifyReplay({ ...partial, entries: { timekeeperName: { set: "Synthetic Divergence" } } }).state, "rejected");
    const before = readFileSync(path), envelope = JSON.parse(before.toString("utf8")) as Record<string, unknown>;
    assert.equal(envelope.schemaVersion, 4);
    for (const value of ["Synthetic Replacement", "https://synthetic.example.edu/roster", "disposable-fixture-password"]) assert.equal(before.includes(Buffer.from(value)), false);
    const value = envelope[tamper];
    if (typeof value !== "string") throw new Error("fixture current envelope field is missing");
    envelope[tamper] = tamper === "installationId" || tamper === "profileId" || tamper === "keyId" ? randomUUID() : `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
    writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
    assert.throws(() => store.read());
    writeFileSync(path, before, { mode: 0o600 });
    assert.equal(store.read().entries.timekeeperName?.value, "Synthetic Replacement");
  } finally { await f.close(); }
});

it("requires the exact machine-issued child and established key without regeneration", async () => {
  const f = await createBoundProfileFixture(), other = await createBoundProfileFixture();
  try {
    const store = boundProfileCredentials(f.admission), before = store.read();
    assert.throws(() => createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: other.machine,
      erasureJournalPath: join(other.machine.stateRoot, "machine", "erasures", `${f.admission.profileBinding.profileId}.json`) }));
    const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), bytes = readFileSync(keyPath);
    unlinkSync(keyPath); assert.throws(() => store.read(), /credential-key-required/u);
    assert.throws(() => store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "d".repeat(64),
      expectedRevision: before.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: "2026-10-21T12:00:00.000Z", entries: {} })));
    writeFileSync(keyPath, bytes, { mode: 0o600 }); assert.throws(() => store.read(), /credential-key-custody-changed/u);
  } finally { await f.close(); await other.close(); }
});

it("requires the durable key anchor for current-format ordinary reads without creating one", async () => {
  const f = await createBoundProfileFixture();
  const path = join(f.workspace, ".tracker", "control", "profile-registry.json"), before = readFileSync(path);
  try {
    const store = boundProfileCredentials(f.admission), record = store.read();
    const continuity = JSON.parse(before.toString("utf8")) as { erasures: { profileId: string; credentialKey?: unknown }[] };
    const row = continuity.erasures.find(entry => entry.profileId === f.admission.profileBinding.profileId);
    assert.ok(row?.credentialKey !== undefined);
    delete row.credentialKey;
    writeFileSync(path, JSON.stringify(continuity), { mode: 0o600 });
    const missing = readFileSync(path);
    assert.throws(() => store.read(), /profile-credential-key-unowned/u);
    assert.equal(readFileSync(path).equals(missing), true);
    writeFileSync(path, before, { mode: 0o600 });
    assert.equal(store.read().revision, record.revision);
  } finally { writeFileSync(path, before, { mode: 0o600 }); await f.close(); }
});
