import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH, type ProtectedSettingsApplyInput } from "../../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture, rewriteAuthenticatedCredentialFixture } from "../../../support/helpers/admission-fixture.js";

const SETTINGS = "d".repeat(64), LOGIN = "e".repeat(64);

function applier(store: ReturnType<typeof createCredentialStore>) {
  return (fingerprint: string, entries: ProtectedSettingsApplyInput["entries"]) => assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({
    commandId: randomUUID(), commandFingerprint: fingerprint, expectedRevision: store.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: randomUUID(), updatedAt: "2026-10-21T12:00:00.000Z", entries })).state, "applied");
}

it("names the newest receipt that set or cleared each entry, in history order, unchanged by unrelated saves and free of values", async () => {
  const f = await createBoundProfileFixture(), store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), apply = applier(store);
  try {
    const before = store.lastEntryWriters();
    apply(LOGIN, { ucpathUserId: { set: "synthetic.keeper@ucsd.edu" }, ucpathPassword: { set: "synthetic-entry-writer-secret" } });
    apply(SETTINGS, { sharepointOnboardingRosterUrl: { set: "https://synthetic.example.edu/roster" } });
    assert.deepEqual({ ucpathUserId: store.lastEntryWriters().ucpathUserId, ucpathPassword: store.lastEntryWriters().ucpathPassword },
      { ucpathUserId: { commandFingerprint: LOGIN, operation: "set" }, ucpathPassword: { commandFingerprint: LOGIN, operation: "set" } });
    apply(SETTINGS, { ucpathUserId: { clear: true } });
    const writers = store.lastEntryWriters();
    assert.deepEqual(writers.ucpathUserId, { commandFingerprint: SETTINGS, operation: "clear" });
    assert.deepEqual(writers.ucpathPassword, { commandFingerprint: LOGIN, operation: "set" });
    assert.deepEqual(writers.sharepointOnboardingRosterUrl, { commandFingerprint: SETTINGS, operation: "set" });
    assert.equal(Object.isFrozen(writers), true);
    const serialized = JSON.stringify(writers);
    for (const secret of ["synthetic.keeper", "synthetic-entry-writer-secret", "synthetic.example.edu"]) assert.equal(serialized.includes(secret), false);
    for (const valueId of Object.values(store.read().entries).map(entry => entry.valueId)) assert.equal(serialized.includes(valueId), false);
    assert.equal(Object.keys(before).every(name => name in writers), true);
  } finally { await f.close(); }
});

it("reports an erase mark carried by authenticated history", async () => {
  const f = await createBoundProfileFixture(), store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), apply = applier(store);
  try {
    apply(LOGIN, { ucpathUserId: { set: "synthetic.keeper@ucsd.edu" } });
    apply(SETTINGS, { ucpathUserId: { clear: true } });
    apply(SETTINGS, { sharepointOnboardingRosterUrl: { set: "https://synthetic.example.edu/roster" } });
    const History = z.object({ history: z.array(z.object({ marked: z.record(z.string(), z.unknown()) }).passthrough()) }).passthrough();
    rewriteAuthenticatedCredentialFixture(f.machine.stateRoot, f.admission.profileBinding.profileId, payload => {
      const document = History.parse(payload), cleared = document.history.findLastIndex(entry => "ucpathUserId" in entry.marked);
      return { ...document, history: document.history.map((entry, index) => index === cleared ? { ...entry, marked: { ...entry.marked, ucpathUserId: { erase: true } } } : entry) };
    });
    assert.deepEqual(store.lastEntryWriters().ucpathUserId, { commandFingerprint: SETTINGS, operation: "erase" });
  } finally { await f.close(); }
});

it("fails loud on altered or unreadable history instead of answering an empty map", async () => {
  const f = await createBoundProfileFixture(), store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot }), apply = applier(store);
  const protectedPath = join(f.stateRoot, "credentials", "protected.json");
  const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  try {
    apply(LOGIN, { ucpathPassword: { set: "synthetic-entry-writer-secret" } });
    const protectedBytes = readFileSync(protectedPath), envelope = z.record(z.string(), z.unknown()).parse(JSON.parse(protectedBytes.toString("utf8")));
    const tag = z.string().parse(envelope.tag);
    writeFileSync(protectedPath, JSON.stringify({ ...envelope, tag: `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}` }), { mode: 0o600 });
    assert.throws(() => store.lastEntryWriters(), { code: "CREDENTIAL_UNAVAILABLE" });
    writeFileSync(protectedPath, protectedBytes, { mode: 0o600 });
    const head = readFileSync(headPath);
    unlinkSync(headPath);
    assert.throws(() => store.lastEntryWriters(), { code: "CREDENTIAL_UNAVAILABLE" });
    writeFileSync(headPath, head, { mode: 0o600 });
    assert.deepEqual(store.lastEntryWriters().ucpathPassword, { commandFingerprint: LOGIN, operation: "set" });
  } finally { await f.close(); }
});
